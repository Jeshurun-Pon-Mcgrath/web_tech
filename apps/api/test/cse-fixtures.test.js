import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureTestMongo } from '../../../scripts/test-mongo.js';
configureTestMongo();
process.env.NODE_ENV = 'test';
process.env.EMAIL_ADAPTER = 'preview';
process.env.LOG_LEVEL = 'silent';
process.env.CSRF_SECRET = randomBytes(32).toString('hex');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-cse-tests';
const { env } = await import('../src/config/env.js');
const {
  models,
  User,
  Cohort,
  Question,
  QuestionVersion,
  Exam,
  Assignment,
  Attempt,
  IntegrityDecision,
  EmailOutbox,
} = await import('../src/modules/models.js');
const { seedCseFixtures, csePrefix, cseEmail } =
  await import('../src/modules/maintenance/cse-fixtures.js');
const { grade } = await import('../src/modules/attempts/grading.js');
const { result, readiness, startAttempt } =
  await import('../src/modules/attempts/attempts.service.js');
const passwords = Array.from({ length: 20 }, () => randomBytes(18).toString('hex'));
let repl, admin;
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('cse_fixture_tests'));
  for (const model of models) await model.init();
});
beforeEach(async () => {
  for (const model of models) await model.deleteMany({});
  admin = await User.create({
    name: 'Existing admin',
    email: 'admin@cse-test.invalid',
    role: 'admin',
    active: true,
    passwordHash: await bcrypt.hash(passwords[0], 12),
  });
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

it('creates labelled CSE records, graded receipts, reviews and runnable exams; repeat runs preserve all existing data', async () => {
  const existing = await Cohort.create({ name: 'Existing class', description: 'Keep this record' });
  const summary = await seedCseFixtures(passwords);
  assert.deepEqual(summary.created, {
    students: 20,
    cohorts: 20,
    subjects: 20,
    questions: 60,
    exams: 20,
    attempts: 20,
  });
  assert.equal(summary.totals.assignments, 23);
  assert.equal(summary.totals.submittedAttempts, 20);
  assert.equal(await QuestionVersion.countDocuments(), 60);
  assert.equal(await IntegrityDecision.countDocuments(), 20);
  assert.equal(await EmailOutbox.countDocuments(), 0);
  for (const type of ['single', 'multiple', 'true-false'])
    assert.equal(await Question.countDocuments({ type }), 20);
  assert.equal(await Question.countDocuments({ contentHash: { $exists: true } }), 60);
  assert.equal(await Exam.countDocuments({ status: 'draft' }), 1);
  assert.equal(await Exam.countDocuments({ resultsReleased: true }), 16);
  const attempts = await Attempt.find().lean();
  assert.equal(new Set(attempts.map((attempt) => String(attempt._id))).size, 20);
  assert.ok(new Set(attempts.map((attempt) => attempt.score)).size > 1);
  for (const attempt of attempts) {
    const calculated = grade(attempt.selectedQuestions, attempt.answers);
    assert.equal(attempt.score, calculated.score);
    assert.equal(attempt.maxScore, calculated.maxScore);
    assert.equal(
      (await result(String(attempt._id), String(attempt.student))).score,
      calculated.score,
    );
    assert.ok(attempt.submittedAt <= attempt.deadline);
  }
  const student = await User.findOne({ email: cseEmail(0) }).select('+passwordHash');
  assert.equal(await bcrypt.compare(passwords[0], student.passwordHash), true);
  const available = await Exam.findOne({ fixtureKey: csePrefix + 'exam-16' });
  await readiness(String(available._id), String(student._id));
  const active = await startAttempt(String(available._id), String(student._id));
  assert.equal(active.status, 'active');
  assert.equal(active.questions.length, 3);
  assert.equal(active.attemptControls.requireFullscreen, true);
  assert.equal(JSON.stringify(active).includes('correctChoice'), false);
  await assert.rejects(
    result(active.id, String(student._id)),
    (error) => error.code === 'RESULT_UNRELEASED',
  );
  await User.updateOne(
    { _id: student._id },
    { $set: { name: 'Edited demo student', active: false, status: 'deactivated' } },
  );
  await Question.updateOne(
    { fixtureKey: csePrefix + 'question-0-0' },
    { $set: { prompt: 'Edited question to preserve' } },
  );
  const previous = await Promise.all(
    models.map((model) => model.find().select('+passwordHash').sort({ _id: 1 }).lean()),
  );
  const repeated = await seedCseFixtures(passwords.map(() => randomBytes(18).toString('hex')));
  assert.ok(Object.values(repeated.created).every((count) => count === 0));
  const afterRepeat = await Promise.all(
    models.map((model) => model.find().select('+passwordHash').sort({ _id: 1 }).lean()),
  );
  assert.ok(
    JSON.stringify(previous) === JSON.stringify(afterRepeat),
    'Reruns must not change users, grades, active attempts, versions, assignments or reviews',
  );
  assert.equal((await Cohort.findById(existing._id)).description, 'Keep this record');
  assert.equal((await User.findById(admin._id)).name, 'Existing admin');
  assert.equal(await Assignment.countDocuments(), 23);
});

it('refuses production and invalid configuration before any fixture mutation', async () => {
  env.NODE_ENV = 'production';
  try {
    await assert.rejects(seedCseFixtures(passwords), (error) => error.code === 'DEVELOPMENT_ONLY');
  } finally {
    env.NODE_ENV = 'test';
  }
  await assert.rejects(seedCseFixtures(['short']), (error) => error.code === 'SEED_CONFIG');
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Cohort.countDocuments(), 0);
});

it('refuses natural-key collisions instead of adopting or overwriting existing records', async () => {
  const existing = await Cohort.create({
    name: '[CSE DEMO] Year 1 - Section A',
    description: 'Existing unowned record',
  });
  await assert.rejects(seedCseFixtures(passwords), (error) => error.code === 11000);
  const retained = await Cohort.findById(existing._id);
  assert.equal(retained.description, 'Existing unowned record');
  assert.equal(retained.fixtureKey, undefined);
  assert.equal(await User.countDocuments(), 1);
});
