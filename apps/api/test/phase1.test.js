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
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-phase1';
const { createApp } = await import('../src/app.js');
const { models, User, Cohort, Subject, Question, Exam, Assignment, Attempt } =
  await import('../src/modules/models.js');
const { seedDevelopmentFixtures } =
  await import('../src/modules/maintenance/development-fixtures.js');
const { migrateLegacyQuestions } = await import('../src/modules/maintenance/legacy-migration.js');
const { env } = await import('../src/config/env.js');
const { grade } = await import('../src/modules/attempts/grading.js');
let repl, app, admin, eligible, unassigned, fixtures, bank, passwordHash;
const passwords = { a: randomBytes(18).toString('hex'), b: randomBytes(18).toString('hex') };
const ok = (response) => {
  assert.equal(response.status, 200, response.body.error?.code || 'Unexpected API response');
  return response.body.data;
};
async function client(email, password, portal) {
  const agent = request.agent(app);
  const token = ok(await agent.get('/api/v1/auth/csrf')).token;
  ok(
    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', token)
      .send({ email, password, portal }),
  );
  return {
    get: (path) => agent.get('/api/v1' + path),
    post: (path, body = {}) =>
      agent
        .post('/api/v1' + path)
        .set('x-csrf-token', token)
        .send(body),
    put: (path, body) =>
      agent
        .put('/api/v1' + path)
        .set('x-csrf-token', token)
        .send(body),
  };
}
async function start() {
  ok(
    await eligible.post(`/student/exams/${fixtures.publishedExam}/readiness`, {
      acknowledged: true,
      connectionChecked: true,
    }),
  );
  return ok(await eligible.post(`/student/exams/${fixtures.publishedExam}/start`));
}
const answer = (index, choiceIds) => ({ questionId: String(bank[index].questionId), choiceIds });
function noKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(
      ![
        'correctChoiceId',
        'correctChoiceIds',
        'explanation',
        'points',
        'penalty',
        'awardedPoints',
        'score',
        'maxScore',
        'passwordHash',
        'fixtureKey',
      ].includes(key),
      `Privileged metadata exposed: ${key}`,
    );
    noKeys(child);
  }
}
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('phase1_tests'));
  for (const model of models) await model.init();
  app = createApp();
  passwordHash = await bcrypt.hash(passwords.a, 12);
  await User.create({
    name: '[TEST FICTIONAL] Administrator',
    email: 'phase1-admin@examledger.invalid',
    passwordHash,
    role: 'admin',
  });
  admin = await client('phase1-admin@examledger.invalid', passwords.a, 'admin');
});
beforeEach(async () => {
  app = createApp();
  for (const Model of [Assignment, Attempt, Exam, Question, Subject, Cohort])
    await Model.deleteMany({});
  await User.deleteMany({ role: 'student' });
  fixtures = await seedDevelopmentFixtures(passwords);
  eligible = await client('phase1-student-a@examledger.invalid', passwords.a, 'student');
  unassigned = await client('phase1-student-b@examledger.invalid', passwords.b, 'student');
  bank = (await Exam.findById(fixtures.publishedExam)).questions;
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

describe('explicit fictional fixtures and data safety', () => {
  it('seeds the requested data idempotently without resetting edits, counters or snapshots', async () => {
    assert.equal(fixtures.created, 16);
    assert.equal(await User.countDocuments({ role: 'student' }), 2);
    assert.equal(await Cohort.countDocuments(), 2);
    assert.equal(await Subject.countDocuments(), 2);
    assert.equal(await Question.countDocuments(), 8);
    assert.equal(await Exam.countDocuments({ status: 'draft' }), 1);
    assert.equal(await Exam.countDocuments({ status: 'published' }), 1);
    const originalSnapshot = JSON.stringify(
      (await Exam.findById(fixtures.publishedExam)).questions,
    );
    await Question.updateOne(
      { _id: fixtures.questions[0] },
      { $set: { prompt: '[DEV FICTIONAL] User edit retained' } },
    );
    await start();
    const repeated = await seedDevelopmentFixtures(passwords);
    assert.equal(repeated.created, 0);
    assert.equal((await Assignment.findOne({ exam: fixtures.publishedExam })).attemptsUsed, 1);
    assert.equal(
      (await Question.findById(fixtures.questions[0])).prompt,
      '[DEV FICTIONAL] User edit retained',
    );
    assert.equal(
      JSON.stringify((await Exam.findById(fixtures.publishedExam)).questions),
      originalSnapshot,
    );
  });
  it('refuses production seeding before adding or changing records', async () => {
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      await assert.rejects(
        seedDevelopmentFixtures(passwords),
        (error) => error.code === 'DEVELOPMENT_ONLY',
      );
    } finally {
      env.NODE_ENV = previous;
    }
    assert.equal(await User.countDocuments({ role: 'student' }), 2);
  });
  it('refuses collisions with non-fixture data instead of overwriting it', async () => {
    await Cohort.deleteMany({});
    const existing = await Cohort.create({
      name: '[DEV FICTIONAL] Cohort A',
      description: 'Existing real record retained',
    });
    await assert.rejects(seedDevelopmentFixtures(passwords), (error) => error.code === 11000);
    assert.equal(
      (await Cohort.findById(existing._id)).description,
      'Existing real record retained',
    );
  });
});
describe('all supported question types and server grading', () => {
  it('enforces assignment, exact-set full credit, penalties and release across the complete API lifecycle', async () => {
    assert.equal(
      (await unassigned.post(`/student/exams/${fixtures.publishedExam}/start`)).status,
      404,
    );
    assert.equal(
      (
        await unassigned.post(`/student/exams/${fixtures.publishedExam}/readiness`, {
          acknowledged: true,
          connectionChecked: true,
        })
      ).status,
      404,
    );
    const a = await start();
    noKeys(a);
    noKeys(ok(await eligible.get('/student/exams')));
    assert.deepEqual(
      a.questions.map((q) => q.type),
      ['single', 'multiple', 'true-false', 'single'],
    );
    const answers = [
      answer(0, ['a']),
      answer(1, ['section', 'article']),
      answer(2, ['true']),
      answer(3, ['server']),
    ];
    ok(await eligible.put(`/student/attempts/${a.id}/answers`, { version: 0, answers }));
    const recovered = ok(await eligible.get(`/student/attempts/${a.id}`));
    noKeys(recovered);
    assert.deepEqual(
      recovered.answers,
      answers.map((a) => ({ ...a, choiceIds: [...a.choiceIds].sort() })),
    );
    assert.equal(recovered.deadline, a.deadline);
    assert.equal(
      (await eligible.put(`/student/attempts/${a.id}/answers`, { version: 0, answers: [] })).body
        .error.code,
      'VERSION_CONFLICT',
    );
    const receipts = (
      await Promise.all([
        eligible.post(`/student/attempts/${a.id}/submit`),
        eligible.post(`/student/attempts/${a.id}/submit`),
      ])
    ).map(ok);
    noKeys(receipts[0]);
    assert.equal(receipts[0].submittedAt, receipts[1].submittedAt);
    assert.equal(await Attempt.countDocuments({ _id: a.id }), 1);
    assert.equal((await Attempt.findById(a.id)).score, 10);
    assert.equal((await eligible.get(`/student/attempts/${a.id}/result`)).status, 403);
    const originalScore = (await Attempt.findById(a.id)).score;
    await Question.updateOne(
      { _id: bank[1].questionId },
      { $set: { correctChoiceIds: ['div'], explanation: 'Later bank edit' } },
    );
    await Exam.updateOne(
      { _id: fixtures.publishedExam },
      { $set: { closesAt: new Date(Date.now() - 1000) } },
    );
    ok(await admin.post(`/admin/exams/${fixtures.publishedExam}/release`));
    const released = ok(await eligible.get(`/student/attempts/${a.id}/result`));
    assert.equal(released.score, originalScore);
    assert.deepEqual(released.questions[1].correctChoiceIds, ['article', 'section']);
    assert.ok(released.questions[1].explanation.includes('semantic'));
    assert.equal((await unassigned.get(`/student/attempts/${a.id}/result`)).status, 404);
  });
  it('rejects partial/extra/duplicate/unknown selections appropriately for every question type', async () => {
    const a = await start();
    for (const invalid of [
      answer(0, ['a', 'b']),
      answer(1, ['article', 'article']),
      answer(1, ['unknown']),
      answer(2, ['true', 'false']),
      answer(2, ['a']),
    ]) {
      const r = await eligible.put(`/student/attempts/${a.id}/answers`, {
        version: 0,
        answers: [invalid],
      });
      assert.equal(r.status, 422);
    }
    const saved = [answer(0, ['b']), answer(1, ['article']), answer(2, ['false'])];
    ok(await eligible.put(`/student/attempts/${a.id}/answers`, { version: 0, answers: saved }));
    ok(await eligible.post(`/student/attempts/${a.id}/submit`));
    assert.equal((await Attempt.findById(a.id)).score, -2.5);
    assert.deepEqual(grade(bank, []), { score: 0, maxScore: 10 });
    assert.deepEqual(grade(bank, [answer(1, ['article', 'section', 'div'])]), {
      score: -1,
      maxScore: 10,
    });
  });
  it('validates stable options, correct-set cardinality and bounded penalties at authoring', async () => {
    const input = {
      subject: fixtures.subjects[0],
      type: 'multiple',
      prompt: '[TEST FICTIONAL] Multiple-answer authoring',
      choices: [
        { id: 'stable-one', text: 'First' },
        { id: 'stable-two', text: 'Second' },
      ],
      correctChoiceIds: ['stable-one', 'stable-two'],
      points: 2,
      penalty: 0.25,
    };
    const q = ok(await admin.post('/admin/questions', input));
    assert.deepEqual(q.correctChoiceIds, ['stable-one', 'stable-two']);
    for (const change of [
      { correctChoiceIds: ['unknown'] },
      { correctChoiceIds: ['stable-one', 'stable-one'] },
      { type: 'single' },
      { penalty: 3 },
      { penalty: -1 },
      { choices: [input.choices[0], input.choices[0]] },
      { type: 'true-false' },
    ])
      assert.equal((await admin.post('/admin/questions', { ...input, ...change })).status, 422);
  });
  it('uses last accepted multiple-answer state when a late save triggers server expiry', async () => {
    const a = await start();
    ok(
      await eligible.put(`/student/attempts/${a.id}/answers`, {
        version: 0,
        answers: [answer(1, ['article', 'section'])],
      }),
    );
    await Attempt.updateOne({ _id: a.id }, { $set: { deadline: new Date(Date.now() - 1000) } });
    const late = ok(
      await eligible.put(`/student/attempts/${a.id}/answers`, {
        version: 1,
        answers: [answer(1, ['div'])],
      }),
    );
    assert.equal(late.submissionReason, 'deadline');
    assert.equal((await Attempt.findById(a.id)).score, 4);
    noKeys(late);
  });
  it('preserves answers, events and targeted review updates under concurrent requests', async () => {
    const a = await start();
    const responses = await Promise.all([
      eligible.put(`/student/attempts/${a.id}/answers`, {
        version: 0,
        answers: [answer(1, ['article', 'section'])],
      }),
      eligible.post(`/student/attempts/${a.id}/events`, { type: 'visibility-hidden' }),
      admin.put(`/admin/attempts/${a.id}/review`, {
        status: 'cleared',
        note: '[TEST FICTIONAL] Reviewed in context.',
      }),
    ]);
    responses.forEach(ok);
    const doc = await Attempt.findById(a.id);
    assert.equal(doc.answers.length, 1);
    assert.equal(doc.events.length, 1);
    assert.equal(doc.reviewStatus, 'cleared');
  });
});
describe('server pagination, allowlisted queries and stable ordering', () => {
  it('paginates in MongoDB, filters students by cohort/status and searches literal text', async () => {
    const date = new Date('2026-01-01T00:00:00Z');
    await User.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        name: `[TEST FICTIONAL] Page ${String(i).padStart(2, '0')}`,
        email: `page-${i}@examledger.invalid`,
        passwordHash,
        role: 'student',
        cohort: fixtures.cohorts[0],
        active: i % 2 === 0,
        createdAt: date,
      })),
    );
    const p1 = ok(await admin.get('/admin/students?page=1&pageSize=10&sort=createdAt&order=asc'));
    const p2 = ok(await admin.get('/admin/students?page=2&pageSize=10&sort=createdAt&order=asc'));
    assert.equal(p1.items.length, 10);
    assert.equal(p1.pagination.total, 27);
    assert.equal(p1.pagination.totalPages, 3);
    assert.equal(new Set([...p1.items, ...p2.items].map((row) => row.id)).size, 20);
    assert.deepEqual(
      p1.items,
      ok(await admin.get('/admin/students?page=1&pageSize=10&sort=createdAt&order=asc')).items,
    );
    const filtered = ok(
      await admin.get(`/admin/students?cohort=${fixtures.cohorts[0]}&active=false`),
    );
    assert.equal(filtered.pagination.total, 12);
    assert.ok(filtered.items.every((row) => !row.active));
    assert.equal(ok(await admin.get('/admin/students?search=.*')).pagination.total, 0);
    const clamped = ok(await admin.get('/admin/students?page=999&pageSize=10'));
    assert.equal(clamped.pagination.page, 3);
    assert.equal(clamped.items.length, 7);
    const empty = ok(await admin.get('/admin/students?page=999&search=absent-name'));
    assert.equal(empty.pagination.page, 1);
    assert.equal(empty.pagination.total, 0);
    assert.equal(empty.pagination.hasNext, false);
  });
  it('bounds page sizes and rejects arbitrary filters, invalid IDs and unsupported sorts', async () => {
    for (const path of [
      '/admin/students?pageSize=51',
      '/admin/students?page=0',
      '/admin/students?sort=passwordHash',
      '/admin/questions?subject=bad',
      '/admin/exams?status=unknown',
      '/admin/attempts?filter[$ne]=x',
      '/admin/integrity?reviewStatus=unknown',
    ])
      assert.equal((await admin.get(path)).status, 422, path);
    assert.equal((await eligible.get('/admin/students')).status, 403);
  });
  it('filters question types, exams, scores and integrity reviews with consistent metadata', async () => {
    for (const type of ['single', 'multiple', 'true-false']) {
      const page = ok(
        await admin.get(`/admin/questions?type=${type}&subject=${fixtures.subjects[0]}`),
      );
      assert.ok(page.items.every((q) => q.type === type));
      assert.equal(page.pagination.total, type === 'single' ? 2 : 1);
    }
    assert.equal(ok(await admin.get('/admin/exams?status=draft')).pagination.total, 1);
    const a = await start();
    ok(await eligible.post(`/student/attempts/${a.id}/events`, { type: 'visibility-hidden' }));
    ok(await eligible.post(`/student/attempts/${a.id}/submit`));
    const scores = ok(
      await admin.get(
        `/admin/attempts?status=submitted&exam=${fixtures.publishedExam}&search=Student%20A`,
      ),
    );
    assert.equal(scores.items.length, 1);
    assert.equal(scores.items[0].score, 0);
    ok(
      await admin.put(`/admin/attempts/${a.id}/review`, {
        status: 'flagged',
        note: '[TEST FICTIONAL] Context needed.',
      }),
    );
    const reviews = ok(await admin.get('/admin/integrity?reviewStatus=flagged&hasEvents=true'));
    assert.equal(reviews.items.length, 1);
    assert.equal(reviews.items[0].eventCount, 1);
    assert.equal(ok(await admin.get('/admin/integrity?hasEvents=false')).pagination.total, 0);
    for (const endpoint of [
      'students',
      'questions',
      'exams',
      'attempts',
      'integrity',
      'assignments',
    ]) {
      const data = ok(await admin.get(`/admin/${endpoint}?pageSize=1`));
      assert.ok(data.items.length <= 1);
      assert.deepEqual(Object.keys(data.pagination).sort(), [
        'hasNext',
        'hasPrevious',
        'page',
        'pageSize',
        'total',
        'totalPages',
      ]);
    }
  });
});
describe('safe additive legacy migration', () => {
  it('supports dry-run, preserves legacy snapshots/answers/grades and applies only once', async () => {
    const a = await start();
    await Question.collection.updateOne(
      { _id: bank[0].questionId },
      { $set: { correctChoiceId: 'a' }, $unset: { type: '', penalty: '', correctChoiceIds: '' } },
    );
    await Exam.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(fixtures.publishedExam) },
      {
        $set: { 'questions.0.correctChoiceId': 'a' },
        $unset: {
          'questions.0.type': '',
          'questions.0.penalty': '',
          'questions.0.correctChoiceIds': '',
        },
      },
    );
    const submittedAt = new Date('2026-01-02T00:00:00Z');
    await Attempt.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(a.id) },
      {
        $set: {
          answers: [{ questionId: String(bank[0].questionId), choiceId: 'a' }],
          status: 'submitted',
          score: 3,
          maxScore: 10,
          version: 7,
          submittedAt,
        },
      },
    );
    const before = await Attempt.collection.findOne({ _id: new mongoose.Types.ObjectId(a.id) });
    const dry = await migrateLegacyQuestions(mongoose.connection, { dryRun: true });
    assert.deepEqual(dry, { dryRun: true, questions: 1, exams: 1, attempts: 1 });
    assert.deepEqual(await Attempt.collection.findOne({ _id: before._id }), before);
    const applied = await migrateLegacyQuestions(mongoose.connection, { dryRun: false });
    assert.equal(applied.attempts, 1);
    const after = await Attempt.collection.findOne({ _id: before._id });
    assert.equal(after.score, before.score);
    assert.equal(after.version, 7);
    assert.deepEqual(after.submittedAt, submittedAt);
    assert.deepEqual(after.updatedAt, before.updatedAt);
    assert.equal(after.answers[0].choiceId, 'a');
    assert.deepEqual(after.answers[0].choiceIds, ['a']);
    assert.deepEqual(await migrateLegacyQuestions(mongoose.connection, { dryRun: false }), {
      dryRun: false,
      questions: 0,
      exams: 0,
      attempts: 0,
    });
    const snapshot = (await Exam.findById(fixtures.publishedExam)).questions;
    assert.deepEqual(grade(snapshot, after.answers), { score: 3, maxScore: 10 });
  });
});
