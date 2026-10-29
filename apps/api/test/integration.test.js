import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureTestMongo } from '../../../scripts/test-mongo.js';
configureTestMongo();
process.env.NODE_ENV = 'test';
process.env.EMAIL_ADAPTER = 'preview';
process.env.CSRF_SECRET = randomBytes(32).toString('hex');
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused';
const { createApp } = await import('../src/app.js');
const { User, Session, Cohort, Subject, Question, Exam, Assignment, Attempt, models } =
  await import('../src/modules/models.js');
const { expireDueAttempts } = await import('../src/jobs/expire-attempts.js');
const { grade } = await import('../src/modules/attempts/attempts.service.js');
let repl, app, admin, student, other, studentUser, subject, question, exam;
const password = randomBytes(16).toString('hex');
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
};
async function client(email, portal) {
  const agent = request.agent(app);
  const csrf = ok(await agent.get('/api/v1/auth/csrf')).token;
  ok(
    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email, password, portal }),
  );
  return {
    agent,
    csrf,
    get: (path) => agent.get('/api/v1' + path),
    post: (path, body = {}) =>
      agent
        .post('/api/v1' + path)
        .set('x-csrf-token', csrf)
        .send(body),
    put: (path, body) =>
      agent
        .put('/api/v1' + path)
        .set('x-csrf-token', csrf)
        .send(body),
  };
}
const questionInput = () => ({
  subject: subject.id,
  prompt: 'Which protocol secures web transport?',
  choices: [
    { id: 'a', text: 'HTTPS' },
    { id: 'b', text: 'FTP' },
    { id: 'c', text: 'Telnet' },
    { id: 'd', text: 'HTTP' },
  ],
  correctChoiceId: 'a',
  explanation: 'HTTPS uses TLS to secure transport.',
  points: 3,
});
const examInput = (overrides = {}) => ({
  title: 'Web Technology examination',
  subject: subject.id,
  instructions: 'Choose one answer.',
  durationMinutes: 10,
  opensAt: new Date(Date.now() - 60000).toISOString(),
  closesAt: new Date(Date.now() + 3600000).toISOString(),
  maxAttempts: 1,
  questionIds: [question.id],
  ...overrides,
});
async function start() {
  ok(
    await student.post(`/student/exams/${exam.id}/readiness`, {
      acknowledged: true,
      connectionChecked: true,
    }),
  );
  return ok(await student.post(`/student/exams/${exam.id}/start`));
}
function assertNoKeys(data) {
  const value = JSON.stringify(data);
  for (const field of [
    'correctChoiceId',
    'correctChoiceIds',
    'penalty',
    'awardedPoints',
    'explanation',
    'points',
    'score',
    'maxScore',
    'passwordHash',
  ])
    assert.equal(value.includes(`"${field}"`), false, `Leaked ${field}`);
}
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('examledger_tests'));
  for (const m of models) await m.init();
  app = createApp();
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({
    name: 'Test Administrator',
    email: 'admin@test.edu',
    passwordHash,
    role: 'admin',
  });
  studentUser = await User.create({
    name: 'Test Student',
    email: 'student@test.edu',
    passwordHash,
    role: 'student',
  });
  await User.create({
    name: 'Other Student',
    email: 'other@test.edu',
    passwordHash,
    role: 'student',
  });
  admin = await client('admin@test.edu', 'admin');
  student = await client('student@test.edu', 'student');
  other = await client('other@test.edu', 'student');
});
beforeEach(async () => {
  for (const m of [Cohort, Subject, Question, Exam, Assignment, Attempt]) await m.deleteMany({});
  subject = ok(await admin.post('/admin/subjects', { name: 'Web Technology', code: 'WT401' }));
  question = ok(await admin.post('/admin/questions', questionInput()));
  exam = ok(await admin.post('/admin/exams', examInput()));
  ok(await admin.post(`/admin/exams/${exam.id}/publish`));
  ok(await admin.post(`/admin/exams/${exam.id}/assign`, { studentIds: [String(studentUser._id)] }));
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
describe('authorization and security', () => {
  it('requires authentication and server-assigned roles', async () => {
    assert.equal((await request(app).get('/api/v1/admin/catalog')).status, 401);
    assert.equal((await student.get('/admin/catalog')).status, 403);
    assert.equal((await admin.get('/student/exams')).status, 403);
    assert.equal(
      (
        await admin.post('/admin/students', {
          name: 'Forged',
          email: 'forged@test.edu',
          password,
          role: 'admin',
        })
      ).status,
      422,
    );
  });
  it('rejects missing CSRF and foreign origins', async () => {
    assert.equal(
      (await admin.agent.post('/api/v1/admin/subjects').send({ name: 'Forged', code: 'X' })).status,
      403,
    );
    assert.equal(
      (
        await admin.agent
          .post('/api/v1/admin/subjects')
          .set('x-csrf-token', admin.csrf)
          .set('origin', 'https://foreign.test')
          .send({ name: 'Forged', code: 'X' })
      ).status,
      403,
    );
  });
  it('uses HttpOnly SameSite cookies and stable CSRF across tabs', async () => {
    const csrf = await student.agent.get('/api/v1/auth/csrf');
    assert.equal(csrf.body.data.token, student.csrf);
    assert.match(csrf.headers['set-cookie'][0], /HttpOnly/);
    assert.match(csrf.headers['set-cookie'][0], /SameSite=Lax/);
    assert.equal(
      (
        await other.agent
          .post('/api/v1/auth/login')
          .set('x-csrf-token', other.csrf)
          .send({ email: 'other@test.edu', password, portal: 'admin' })
      ).status,
      401,
    );
  });
  it('enforces assignment and attempt ownership on every student operation', async () => {
    const a = await start();
    assert.equal((await other.post(`/student/exams/${exam.id}/start`)).status, 404);
    for (const r of [
      await other.get(`/student/attempts/${a.id}`),
      await other.put(`/student/attempts/${a.id}/answers`, { version: 0, answers: [] }),
      await other.post(`/student/attempts/${a.id}/submit`),
      await other.get(`/student/attempts/${a.id}/result`),
      await other.post(`/student/attempts/${a.id}/events`, { type: 'visibility-hidden' }),
    ])
      assert.equal(r.status, 404);
  });
  it('rejects arbitrary queries, client scores, timestamps and malformed IDs', async () => {
    const a = await start();
    assert.equal(
      (
        await student.put(`/student/attempts/${a.id}/answers`, {
          version: 0,
          answers: [],
          score: 100,
          submittedAt: '2040-01-01',
        })
      ).status,
      422,
    );
    assert.equal((await student.get('/student/attempts/invalid')).status, 422);
    assert.equal(
      (await admin.post('/admin/subjects', { name: { $ne: '' }, code: 'X' })).status,
      422,
    );
  });
});
describe('exam lifecycle and grading', () => {
  it('connects cohort creation, student management, assignment, submission, review and release', async () => {
    const cohort = ok(await admin.post('/admin/cohorts', { name: 'Final Year A' }));
    const created = ok(
      await admin.post('/admin/students', {
        name: 'New Student',
        email: 'new@test.edu',
        password,
        cohort: cohort.id,
      }),
    );
    ok(
      await admin.put(`/admin/students/${created.id}`, {
        name: 'Edited Student',
        email: created.email,
        cohort: cohort.id,
        active: true,
      }),
    );
    assert.equal(
      ok(await admin.post(`/admin/exams/${exam.id}/assign`, { cohortIds: [cohort.id] })).assigned,
      1,
    );
    assert.equal(
      ok(await admin.post(`/admin/exams/${exam.id}/assign`, { cohortIds: [cohort.id] })).assigned,
      0,
    );
    assert.equal(ok(await admin.get('/admin/assignments')).items.length, 2);
    const a = await start();
    ok(
      await student.put(`/student/attempts/${a.id}/answers`, {
        version: 0,
        answers: [{ questionId: question.id, choiceId: 'a' }],
      }),
    );
    ok(await student.post(`/student/attempts/${a.id}/events`, { type: 'visibility-hidden' }));
    const receipt = ok(await student.post(`/student/attempts/${a.id}/submit`));
    assert.equal(receipt.status, 'submitted');
    assertNoKeys(receipt);
    assert.equal(ok(await admin.get('/admin/attempts')).items[0].score, 3);
    ok(
      await admin.put(`/admin/attempts/${a.id}/review`, {
        status: 'cleared',
        note: 'Reviewed in context.',
      }),
    );
    assert.equal(ok(await admin.get(`/admin/attempts/${a.id}/integrity`)).events.length, 1);
    assert.equal((await student.get(`/student/attempts/${a.id}/result`)).status, 403);
    assert.equal((await admin.post(`/admin/exams/${exam.id}/release`)).status, 409);
    await Exam.updateOne({ _id: exam.id }, { $set: { closesAt: new Date(Date.now() - 1000) } });
    ok(await admin.post(`/admin/exams/${exam.id}/release`));
    const result = ok(await student.get(`/student/attempts/${a.id}/result`));
    assert.equal(result.score, 3);
    assert.equal(result.maxScore, 3);
    assert.equal(result.questions[0].correctChoiceId, 'a');
    await User.deleteOne({ _id: created.id });
  });
  it('never leaks grading metadata in assigned or active responses', async () => {
    assertNoKeys(ok(await student.get('/student/exams')));
    const a = await start();
    assertNoKeys(a);
    assertNoKeys(ok(await student.get(`/student/attempts/${a.id}`)));
  });
  it('locks published exams and preserves the question snapshot after bank edits', async () => {
    assert.equal(
      (await admin.put(`/admin/exams/${exam.id}`, examInput({ title: 'Changed' }))).status,
      409,
    );
    ok(
      await admin.put(`/admin/questions/${question.id}`, {
        ...questionInput(),
        correctChoiceId: 'b',
        prompt: 'Changed',
        expectedVersion: question.revision,
      }),
    );
    const a = await start();
    assert.equal(a.questions[0].prompt, question.prompt);
    ok(
      await student.put(`/student/attempts/${a.id}/answers`, {
        version: 0,
        answers: [{ questionId: question.id, choiceId: 'a' }],
      }),
    );
    ok(await student.post(`/student/attempts/${a.id}/submit`));
    assert.equal((await Attempt.findById(a.id)).score, 3);
  });
  it('grades incorrect/unanswered questions as zero and validates answers', async () => {
    assert.deepEqual(
      grade(
        [
          { questionId: '1', correctChoiceId: 'a', points: 3 },
          { questionId: '2', correctChoiceId: 'b', points: 2 },
        ],
        [{ questionId: '1', choiceId: 'd' }],
      ),
      { score: 0, maxScore: 5 },
    );
    const a = await start();
    const answer = { questionId: question.id, choiceId: 'a' };
    assert.equal(
      (
        await student.put(`/student/attempts/${a.id}/answers`, {
          version: 0,
          answers: [answer, answer],
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await student.put(`/student/attempts/${a.id}/answers`, {
          version: 0,
          answers: [{ questionId: String(new mongoose.Types.ObjectId()), choiceId: 'a' }],
        })
      ).status,
      422,
    );
    const s = ok(await admin.post('/admin/subjects', { name: 'Other subject', code: 'OTHER' }));
    assert.equal((await admin.post('/admin/exams', examInput({ subject: s.id }))).status, 422);
  });
});
describe('timing, concurrency and recovery', () => {
  it('requires readiness and enforces opening windows', async () => {
    assert.equal(
      (await student.post(`/student/exams/${exam.id}/start`)).body.error.code,
      'READINESS_REQUIRED',
    );
    await Exam.updateOne({ _id: exam.id }, { $set: { opensAt: new Date(Date.now() + 3600000) } });
    assert.equal(
      (
        await student.post(`/student/exams/${exam.id}/readiness`, {
          acknowledged: true,
          connectionChecked: true,
        })
      ).status,
      409,
    );
  });
  it('rejects expired readiness and caps deadlines at exam closing', async () => {
    await Assignment.updateOne(
      { exam: exam.id },
      { $set: { readinessAt: new Date(Date.now() - 31 * 60000) } },
    );
    assert.equal((await student.post(`/student/exams/${exam.id}/start`)).status, 409);
    const close = new Date(Date.now() + 30000);
    await Exam.updateOne({ _id: exam.id }, { $set: { closesAt: close } });
    const a = await start();
    assert.equal(new Date(a.deadline).getTime(), close.getTime());
  });
  it('serializes concurrent starts and consumes a single attempt slot', async () => {
    ok(
      await student.post(`/student/exams/${exam.id}/readiness`, {
        acknowledged: true,
        connectionChecked: true,
      }),
    );
    const attempts = (
      await Promise.all(
        Array.from({ length: 6 }, () => student.post(`/student/exams/${exam.id}/start`)),
      )
    ).map(ok);
    assert.equal(new Set(attempts.map((a) => a.id)).size, 1);
    assert.equal(await Attempt.countDocuments(), 1);
    assert.equal((await Assignment.findOne({ exam: exam.id })).attemptsUsed, 1);
  });
  it('accepts one concurrent save and rejects the stale version', async () => {
    const a = await start();
    const responses = await Promise.all(
      ['a', 'b'].map((choiceId) =>
        student.put(`/student/attempts/${a.id}/answers`, {
          version: 0,
          answers: [{ questionId: question.id, choiceId }],
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await Attempt.findById(a.id)).version, 1);
  });
  it('recovers saved answers, version and deadline across refresh and retry', async () => {
    const a = await start();
    const body = { version: 0, answers: [{ questionId: question.id, choiceId: 'a' }] };
    ok(await student.put(`/student/attempts/${a.id}/answers`, body));
    const recovered = ok(await student.get(`/student/attempts/${a.id}`));
    assert.deepEqual(recovered.answers, body.answers);
    assert.equal(recovered.deadline, a.deadline);
    assert.equal(recovered.version, 1);
    assert.equal(
      (await student.put(`/student/attempts/${a.id}/answers`, body)).body.error.code,
      'VERSION_CONFLICT',
    );
    assert.equal(ok(await student.post(`/student/exams/${exam.id}/start`)).id, a.id);
  });
  it('makes concurrent submission idempotent and enforces attempt limits', async () => {
    const a = await start();
    const receipts = (
      await Promise.all([
        student.post(`/student/attempts/${a.id}/submit`),
        student.post(`/student/attempts/${a.id}/submit`),
      ])
    ).map(ok);
    assert.equal(receipts[0].submittedAt, receipts[1].submittedAt);
    assert.equal(
      (await student.post(`/student/exams/${exam.id}/start`)).body.error.code,
      'ATTEMPT_LIMIT',
    );
  });
  it('rejects late answers and expires abandoned attempts using last saved answers', async () => {
    const a = await start();
    ok(
      await student.put(`/student/attempts/${a.id}/answers`, {
        version: 0,
        answers: [{ questionId: question.id, choiceId: 'a' }],
      }),
    );
    await Attempt.updateOne({ _id: a.id }, { $set: { deadline: new Date(Date.now() - 1000) } });
    const late = ok(
      await student.put(`/student/attempts/${a.id}/answers`, {
        version: 1,
        answers: [{ questionId: question.id, choiceId: 'b' }],
      }),
    );
    assert.equal(late.submissionReason, 'deadline');
    assert.equal((await Attempt.findById(a.id)).score, 3);
    await Attempt.updateOne({ _id: a.id }, { $set: { status: 'active', score: null } });
    await expireDueAttempts();
    assert.equal((await Attempt.findById(a.id)).status, 'submitted');
  });
  it('invalidates sessions on student deactivation', async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const u = await User.create({
      name: 'Deactivate',
      email: 'disabled@test.edu',
      passwordHash,
      role: 'student',
    });
    const agent = await client(u.email, 'student');
    ok(
      await admin.put(`/admin/students/${u.id}`, {
        name: u.name,
        email: u.email,
        cohort: null,
        active: false,
      }),
    );
    assert.equal((await agent.get('/student/exams')).status, 401);
    assert.equal(await Session.countDocuments({ user: u._id }), 0);
    await User.deleteOne({ _id: u.id });
  });
});
