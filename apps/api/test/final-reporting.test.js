import { before, beforeEach, after, describe, it } from 'node:test';
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
process.env.LOG_LEVEL = 'silent';
process.env.CSRF_SECRET = randomBytes(32).toString('hex');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-reporting';
const { createApp } = await import('../src/app.js');
const { models, User, Cohort, Subject, Exam, Assignment, Attempt, IntegrityDecision } =
  await import('../src/modules/models.js');
let repl, app, admin, student, adminUser, a, b, cohort, exam, latest;
const password = randomBytes(20).toString('hex');
let passwordHash;
const ok = (response) => {
  assert.equal(response.status, 200, response.body.error?.code || 'Unexpected status');
  return response.body.data;
};
async function client(email, role = 'student') {
  const agent = request.agent(app);
  const csrf = ok(await agent.get('/api/v1/auth/csrf')).token;
  const result = {
    get: (path) => agent.get('/api/v1' + path),
    put: (path, body) =>
      agent
        .put('/api/v1' + path)
        .set('x-csrf-token', csrf)
        .send(body),
  };
  if (email)
    ok(
      await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrf)
        .send({ email, password, portal: role }),
    );
  return result;
}
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('final_reporting'));
  for (const model of models) await model.init();
  passwordHash = await bcrypt.hash(password, 12);
});
beforeEach(async () => {
  for (const model of models) await model.deleteMany({});
  app = createApp();
  cohort = await Cohort.create({ name: 'Current cohort A' });
  const other = await Cohort.create({ name: 'Current cohort B' });
  adminUser = await User.create({
    name: 'Test administrator',
    email: 'admin@report.invalid',
    role: 'admin',
    passwordHash,
  });
  a = await User.create({
    name: '=Formula student',
    email: 'a@report.invalid',
    role: 'student',
    cohort: cohort._id,
    passwordHash,
  });
  b = await User.create({
    name: 'Other student',
    email: 'b@report.invalid',
    role: 'student',
    cohort: other._id,
    passwordHash,
  });
  const c = await User.create({
    name: 'Not started',
    email: 'c@report.invalid',
    role: 'student',
    cohort: cohort._id,
    passwordHash,
  });
  const subject = await Subject.create({ name: 'Reporting', code: 'REPORT' });
  const q1 = {
    questionId: new mongoose.Types.ObjectId(),
    subject: subject._id,
    type: 'single',
    prompt: 'Single question',
    choices: [
      { id: 'a', text: 'First' },
      { id: 'b', text: 'Second' },
    ],
    correctChoiceIds: ['a'],
    points: 10,
    explanation: 'PRIVATE explanation',
  };
  const q2 = {
    questionId: new mongoose.Types.ObjectId(),
    subject: subject._id,
    type: 'multiple',
    prompt: 'Legacy multiple question',
    choices: [
      { id: 'x', text: 'X' },
      { id: 'y', text: 'Y' },
    ],
    correctChoiceIds: ['x', 'y'],
    points: 10,
  };
  exam = await Exam.create({
    title: 'Released assessment',
    subject: subject._id,
    createdBy: adminUser._id,
    status: 'published',
    opensAt: new Date(Date.now() - 3600000),
    closesAt: new Date(Date.now() - 1000),
    durationMinutes: 10,
    maxAttempts: 3,
    resultsReleased: true,
    questions: [q1, q2],
  });
  const assignments = await Assignment.create(
    [a, b, c].map((user) => ({ exam: exam._id, student: user._id })),
  );
  const snapshot = exam.questions.map((question) => question.toObject());
  snapshot[1] = {
    ...snapshot[1],
    revision: 2,
    prompt: 'Frozen variant multiple question',
    choices: [...snapshot[1].choices, { id: 'z', text: 'Z' }],
    correctChoiceIds: ['x', 'z'],
  };
  const common = {
    exam: exam._id,
    status: 'submitted',
    maxScore: 20,
    submittedAt: new Date(),
    deadline: new Date(Date.now() - 1000),
    startedAt: new Date(Date.now() - 600000),
  };
  await Attempt.create({
    ...common,
    assignment: assignments[0]._id,
    student: a._id,
    number: 1,
    score: 10,
    answers: [
      { questionId: String(q1.questionId), choiceIds: ['a'] },
      { questionId: String(q2.questionId), choiceIds: ['x'] },
    ],
  });
  latest = await Attempt.create({
    ...common,
    assignment: assignments[0]._id,
    student: a._id,
    number: 2,
    score: 20,
    selectedQuestions: snapshot,
    answers: [
      { questionId: String(q1.questionId), choiceIds: ['a'] },
      { questionId: String(q2.questionId), choiceIds: ['x', 'z'] },
    ],
    events: [{ type: 'offline', receivedAt: new Date() }],
  });
  await Attempt.create({
    ...common,
    assignment: assignments[1]._id,
    student: b._id,
    number: 1,
    score: 0,
    answers: [],
  });
  for (const settings of [
    { title: 'UNRELEASED SECRET', resultsReleased: false, closesAt: new Date(Date.now() - 1000) },
    { title: 'PREMATURE SECRET', resultsReleased: true, closesAt: new Date(Date.now() + 3600000) },
  ]) {
    const hidden = await Exam.create({
      title: settings.title,
      ...settings,
      subject: subject._id,
      createdBy: adminUser._id,
      status: 'published',
      opensAt: new Date(Date.now() - 3600000),
      durationMinutes: 10,
      maxAttempts: 1,
      questions: [q1],
    });
    const assignment = await Assignment.create({ exam: hidden._id, student: a._id });
    await Attempt.create({
      ...common,
      exam: hidden._id,
      assignment: assignment._id,
      student: a._id,
      number: 1,
      maxScore: 10,
      score: 10,
    });
  }
  admin = await client(adminUser.email, 'admin');
  student = await client(a.email);
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
describe('final reporting and integrity audit', () => {
  it('uses finalized samples, exact mean/median, explicit denominators and latest/all retake policies', async () => {
    const latestReport = ok(await admin.get(`/admin/analytics?exam=${exam.id}`));
    assert.deepEqual(
      [
        latestReport.summary.assigned,
        latestReport.summary.participated,
        latestReport.summary.completed,
        latestReport.summary.finalizedAttempts,
        latestReport.summary.sampleSize,
      ],
      [3, 2, 2, 3, 2],
    );
    assert.equal(latestReport.summary.mean, 50);
    assert.equal(latestReport.summary.median, 50);
    assert.equal(latestReport.summary.passRate, 50);
    const all = ok(await admin.get(`/admin/analytics?exam=${exam.id}&attempts=all`));
    assert.equal(all.summary.sampleSize, 3);
    assert.equal(all.summary.median, 50);
    assert.equal(all.summary.passed, 2);
    const assigned = await Assignment.findOne({
      exam: exam._id,
      student: { $nin: [a._id, b._id] },
    });
    await Attempt.create({
      exam: exam._id,
      assignment: assigned._id,
      student: assigned.student,
      number: 1,
      status: 'active',
      deadline: new Date(Date.now() - 1),
    });
    const pending = ok(await admin.get(`/admin/analytics?exam=${exam.id}`));
    assert.equal(pending.summary.participated, 3);
    assert.equal(pending.summary.completed, 2);
    assert.equal(pending.summary.sampleSize, 2);
  });
  it('calculates exact-set accuracy from frozen selected versions, with legacy fallback and blank denominators', async () => {
    const result = ok(await admin.get(`/admin/analytics?exam=${exam.id}`));
    assert.equal(result.questions.items.length, 3);
    const variant = result.questions.items.find((row) => row.revision === 2);
    assert.equal(variant.sampleSize, 1);
    assert.equal(variant.correct, 1);
    const single = result.questions.items.find((row) => row.prompt === 'Single question');
    assert.equal(single.sampleSize, 2);
    assert.equal(single.correct, 1);
    for (const key of ['correctChoiceIds', 'explanation', 'selectedQuestions'])
      assert.equal(JSON.stringify(result).includes(`"${key}"`), false);
    const csv = ok(await admin.get(`/admin/analytics/export?exam=${exam.id}&kind=questions`));
    assert.equal(csv.page.total, 3);
    assert.equal(csv.content.includes('PRIVATE explanation'), false);
  });
  it('filters current cohorts before counting, clamps pages, and exports bounded formula-safe authorized rows', async () => {
    const selected = ok(
      await admin.get(`/admin/analytics?exam=${exam.id}&cohort=${cohort.id}&pageSize=1&page=99`),
    );
    assert.equal(selected.summary.assigned, 2);
    assert.equal(selected.summary.sampleSize, 1);
    assert.equal(selected.pagination.page, 1);
    const page = ok(await admin.get(`/admin/analytics?exam=${exam.id}&pageSize=1&page=2`));
    assert.equal(page.items.length, 1);
    assert.equal(page.pagination.total, 2);
    const csv = ok(await admin.get(`/admin/analytics/export?exam=${exam.id}&cohort=${cohort.id}`));
    assert.equal(csv.page.total, 1);
    assert.equal(csv.content.includes("'=Formula student"), true);
    for (const query of [
      'student=other',
      'pageSize=51',
      'sort=score',
      'cohort[$ne]=x',
      'passPercent=101',
    ])
      assert.equal((await admin.get(`/admin/analytics?${query}`)).status, 422);
    assert.equal((await student.get('/admin/analytics')).status, 403);
    assert.equal((await (await client()).get('/admin/analytics/export')).status, 401);
  });
  it('restricts student summaries and exports to owned, closed, explicitly released scores', async () => {
    const data = ok(await student.get('/student/performance'));
    assert.equal(data.summary.sampleSize, 1);
    assert.equal(data.summary.mean, 100);
    assert.equal(data.items[0].id, latest.id);
    const csv = ok(await student.get('/student/performance/export'));
    assert.equal(csv.content.includes('SECRET'), false);
    assert.equal(csv.content.includes('Other student'), false);
    assert.equal((await student.get(`/student/performance?student=${b.id}`)).status, 422);
    assert.equal((await student.get(`/student/performance?cohort=${cohort.id}`)).status, 422);
    assert.equal(
      ok(await student.get(`/student/performance?exam=${new mongoose.Types.ObjectId()}`)).summary
        .sampleSize,
      0,
    );
    await Exam.updateOne({ _id: exam._id }, { $set: { resultsReleased: false } });
    assert.equal(ok(await student.get('/student/performance')).items.length, 0);
    assert.equal((await student.get(`/student/attempts/${latest.id}/result`)).status, 403);
  });
  it('audits decisions atomically, rejects stale reviewers and never changes grades, answers or attempt versions', async () => {
    const before = await Attempt.findById(latest.id);
    const responses = await Promise.all(
      ['cleared', 'flagged'].map((status) =>
        admin.put(`/admin/attempts/${latest.id}/review`, {
          status,
          note: `Context: ${status}`,
          expectedReviewVersion: 0,
        }),
      ),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(await IntegrityDecision.countDocuments({ attempt: latest._id }), 1);
    ok(
      await admin.put(`/admin/attempts/${latest.id}/review`, {
        status: 'pending',
        note: 'Needs further context',
        expectedReviewVersion: 1,
      }),
    );
    const history = ok(
      await admin.get(`/admin/attempts/${latest.id}/integrity?pageSize=1&historyPage=2`),
    );
    assert.equal(history.history.pagination.total, 2);
    assert.equal(history.history.items.length, 1);
    assert.equal(history.reviewVersion, 2);
    const after = await Attempt.findById(latest.id);
    assert.equal(after.score, before.score);
    assert.equal(after.version, before.version);
    assert.ok(
      JSON.stringify(after.answers) === JSON.stringify(before.answers),
      'Reviews preserve accepted responses',
    );
    assert.equal((await student.get(`/admin/attempts/${latest.id}/integrity`)).status, 403);
    assert.equal(
      (
        await request(app)
          .put(`/api/v1/admin/attempts/${latest.id}/review`)
          .send({ status: 'cleared', note: 'Denied' })
      ).status,
      403,
    );
  });
  it('preserves a pre-audit reviewer note as a labelled legacy baseline', async () => {
    await Attempt.updateOne(
      { _id: latest._id },
      {
        $set: {
          reviewStatus: 'flagged',
          reviewNote: 'Legacy preserved note',
          reviewedBy: adminUser._id,
          reviewedAt: new Date(Date.now() - 10000),
        },
      },
    );
    ok(
      await admin.put(`/admin/attempts/${latest.id}/review`, {
        status: 'cleared',
        note: 'Reviewed context',
        expectedReviewVersion: 0,
      }),
    );
    const data = ok(await admin.get(`/admin/attempts/${latest.id}/integrity`));
    assert.equal(data.history.items.length, 2);
    assert.equal(data.history.items.find((row) => row.legacy).note, 'Legacy preserved note');
  });
});
