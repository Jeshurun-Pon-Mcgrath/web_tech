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
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-phase3';
const { createApp } = await import('../src/app.js');
const {
  models,
  User,
  Subject,
  Cohort,
  Question,
  QuestionVersion,
  QuestionImport,
  Exam,
  Assignment,
  Attempt,
} = await import('../src/modules/models.js');
const { fictionalQuestions, formatQuestions, commitImport } =
  await import('../src/modules/admin/question-imports.service.js');
const { questionData } = await import('../src/modules/admin/questions.service.js');
const { expireDueAttempts } = await import('../src/jobs/expire-attempts.js');
const { backfillQuestionFingerprints } =
  await import('../src/modules/maintenance/question-fingerprints.js');
const { selectAttemptQuestions, boundedSnapshots } =
  await import('../src/modules/admin/pools.service.js');
let repl, app, admin, student, adminUser, studentUser, subject, cohort, passwordHash;
const password = randomBytes(20).toString('hex');
const ok = (response) => {
  assert.equal(response.status, 200, response.body.error?.code || 'Unexpected response');
  return response.body.data;
};
async function client(email, portal = 'student') {
  const agent = request.agent(app);
  const csrf = ok(await agent.get('/api/v1/auth/csrf')).token;
  const client = {
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
  if (email) ok(await client.post('/auth/login', { email, password, portal }));
  return client;
}
const external = () =>
  fictionalQuestions.map((question) => ({
    ...structuredClone(question),
    subjectCode: subject.code,
  }));
const document = (rows) =>
  JSON.stringify({ format: 'examledger.questions', version: 1, questions: rows });
const decisions = (preview, action = 'import') => ({
  digest: preview.digest,
  decisions: preview.rows.map((row) => ({ row: row.row, action })),
});
async function preview(rows = external()) {
  return ok(
    await admin.post('/admin/question-imports/preview', {
      format: 'json',
      content: document(rows),
    }),
  );
}
async function commit(batch, action = 'import') {
  return ok(
    await admin.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch, action)),
  );
}
async function bank() {
  const result = [];
  for (const [index, row] of external().entries()) {
    const { subjectCode: _code, ...data } = row;
    result.push(
      ok(
        await admin.post('/admin/questions', {
          ...data,
          subject: String(subject._id),
          topic: 'transport',
          difficulty: index < 2 ? 'easy' : 'hard',
        }),
      ),
    );
  }
  return result;
}
async function draft(questions, overrides = {}) {
  return ok(
    await admin.post('/admin/exams', {
      title: '[TEST FICTIONAL] Phase 3',
      subject: String(subject._id),
      durationMinutes: 10,
      opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      maxAttempts: 2,
      questionIds: questions.map((question) => question.id),
      ...overrides,
    }),
  );
}
async function publish(exam) {
  ok(await admin.post(`/admin/exams/${exam.id}/publish`));
  ok(
    await admin.post(`/admin/exams/${exam.id}/assign`, {
      studentIds: [String(studentUser._id)],
      cohortIds: [String(cohort._id)],
    }),
  );
  return exam;
}
async function start(exam, actor = student) {
  ok(
    await actor.post(`/student/exams/${exam.id}/readiness`, {
      acknowledged: true,
      connectionChecked: true,
    }),
  );
  return ok(await actor.post(`/student/exams/${exam.id}/start`));
}
function noKeys(value) {
  for (const field of [
    'correctChoiceId',
    'correctChoiceIds',
    'explanation',
    'points',
    'penalty',
    'score',
    'maxScore',
    'selectedQuestions',
    'candidateIds',
  ])
    assert.equal(
      JSON.stringify(value).includes(`"${field}"`),
      false,
      `Privileged field exposed: ${field}`,
    );
}
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('phase3_tests'));
  for (const model of models) await model.init();
  passwordHash = await bcrypt.hash(password, 12);
});
beforeEach(async () => {
  for (const model of models) await model.deleteMany({});
  app = createApp();
  subject = await Subject.create({ name: '[TEST FICTIONAL] Subject', code: 'P3' });
  cohort = await Cohort.create({ name: '[TEST FICTIONAL] Cohort' });
  adminUser = await User.create({
    name: '[TEST FICTIONAL] Admin',
    email: 'admin@phase3.invalid',
    role: 'admin',
    passwordHash,
  });
  studentUser = await User.create({
    name: '[TEST FICTIONAL] Student',
    email: 'student@phase3.invalid',
    role: 'student',
    cohort: cohort._id,
    passwordHash,
  });
  admin = await client(adminUser.email, 'admin');
  student = await client(studentUser.email);
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
describe('administrator-selected attempt controls', () => {
  it('validates, freezes, duplicates and recovers controls without exposing answer keys or allowing student changes', async () => {
    const questions = await bank();
    const legacy = await draft(questions);
    assert.deepEqual(legacy.attemptControls, {
      requireFullscreen: false,
      disableCopyPaste: false,
      disableContextMenu: false,
    });
    const controls = { requireFullscreen: true, disableCopyPaste: true, disableContextMenu: true };
    const exam = await draft(questions, { attemptControls: controls });
    assert.deepEqual(exam.attemptControls, controls);
    const payload = {
      title: exam.title,
      subject: exam.subject,
      durationMinutes: exam.durationMinutes,
      opensAt: exam.opensAt,
      closesAt: exam.closesAt,
      maxAttempts: exam.maxAttempts,
      questionIds: exam.questionIds,
      attemptControls: controls,
    };
    assert.equal(
      (
        await admin.post('/admin/exams', {
          ...payload,
          attemptControls: { requireFullscreen: 'true' },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await admin.post('/admin/exams', {
          ...payload,
          attemptControls: { preventScreenshots: true },
        })
      ).status,
      422,
    );
    assert.equal((await student.put(`/admin/exams/${exam.id}`, payload)).status, 403);
    await publish(exam);
    assert.equal(
      (await admin.put(`/admin/exams/${exam.id}`, { ...payload, attemptControls: {} })).status,
      409,
    );
    const listing = ok(await student.get(`/student/exams/${exam.id}`));
    assert.deepEqual(listing.attemptControls, controls);
    const attempt = await start(exam);
    assert.deepEqual(attempt.attemptControls, controls);
    noKeys(attempt);
    const resumed = ok(await student.get(`/student/attempts/${attempt.id}`));
    assert.deepEqual(resumed.attemptControls, controls);
    assert.equal(resumed.deadline, attempt.deadline);
    noKeys(resumed);
    const copy = ok(await admin.post(`/admin/exams/${exam.id}/duplicate`));
    assert.deepEqual(copy.attemptControls, controls);
    assert.equal(copy.status, 'draft');
  });
});

describe('versioned, validated and atomic question exchange', () => {
  it('round-trips all types through JSON and CSV without changing options, keys, organization or explanations', async () => {
    const batch = await preview();
    const summary = await commit(batch);
    assert.equal(summary.imported, 3);
    for (const format of ['json', 'csv']) {
      const file = ok(
        await admin.post('/admin/questions/export', { format, ids: summary.importedIds }),
      );
      const imported = ok(
        await admin.post('/admin/question-imports/preview', { format, content: file.content }),
      );
      assert.equal(imported.valid, true);
      assert.equal(imported.rows.length, 3);
      assert.ok(
        imported.rows.every(
          (row, index) => JSON.stringify(row.data) === JSON.stringify(batch.rows[index].data),
        ),
        'Round-trip preserves canonical question data',
      );
      assert.ok(imported.rows.every((row) => row.existingDuplicates.length === 1));
      assert.equal((await commit(imported, 'skip')).skipped, 3);
    }
    assert.equal(await Question.countDocuments(), 3);
    assert.equal(await QuestionVersion.countDocuments(), 3);
  });
  it('escapes spreadsheet formulas and apostrophes while preserving quoted commas, newlines and literal HTML as text', async () => {
    const rows = external();
    rows[0].prompt = ' =SUM(1,2)';
    rows[0].explanation = "'Literal comma, newline\n<img src=x>";
    const file = formatQuestions(rows, 'csv');
    assert.equal(/'\s*=SUM/.test(file.content), true);
    const batch = ok(
      await admin.post('/admin/question-imports/preview', { format: 'csv', content: file.content }),
    );
    assert.equal(batch.valid, true);
    assert.ok(batch.rows[0].data.prompt === rows[0].prompt.trim());
    assert.ok(batch.rows[0].data.explanation === rows[0].explanation);
    const template = ok(await admin.get('/admin/questions/templates/json'));
    assert.ok(template.content.includes('FICTIONAL TEMPLATE'));
  });
  it('rejects malformed formats, unsupported versions, unknown fields, duplicate/unknown answers and excessive rows/sizes', async () => {
    for (const [format, content] of [
      ['json', '{'],
      [
        'json',
        JSON.stringify({ format: 'examledger.questions', version: 2, questions: external() }),
      ],
      ['csv', 'wrong,headers\n1,2'],
      ['csv', 'schemaVersion,"unterminated'],
    ])
      assert.equal(
        (await admin.post('/admin/question-imports/preview', { format, content })).status,
        422,
      );
    assert.equal(
      (
        await admin.post('/admin/question-imports/preview', {
          format: 'json',
          content: 'x'.repeat(262145),
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await admin.post('/admin/question-imports/preview', {
          format: 'json',
          content: document(Array.from({ length: 101 }, () => external()[0])),
        })
      ).status,
      422,
    );
    const rows = external();
    rows[0].correctChoiceIds = ['unknown'];
    rows[1].correctChoiceIds = ['a', 'a'];
    rows[2].role = 'admin';
    const result = await preview(rows);
    assert.equal(result.valid, false);
    assert.equal(result.errorRows, 3);
    assert.equal(result.id, undefined);
    assert.ok(result.rows.every((row) => row.errors.length));
    assert.equal(await Question.countDocuments(), 0);
    assert.equal(
      (
        await admin.post('/admin/question-imports/preview', {
          format: 'json',
          content: document([{ ...external()[0], prompt: 'x'.repeat(4001) }]),
        })
      ).body.data.valid,
      false,
    );
  });
  it('requires explicit row decisions and makes concurrent commit retries idempotent with a durable audit', async () => {
    const rows = external();
    rows.push(structuredClone(rows[0]));
    const batch = await preview(rows);
    assert.deepEqual(batch.rows[0].duplicateRows, [4]);
    assert.equal(
      (
        await admin.post(`/admin/question-imports/${batch.id}/commit`, {
          digest: batch.digest,
          decisions: [],
        })
      ).status,
      422,
    );
    const body = decisions(batch);
    body.decisions[3].action = 'skip';
    const responses = await Promise.all([
      admin.post(`/admin/question-imports/${batch.id}/commit`, body),
      admin.post(`/admin/question-imports/${batch.id}/commit`, body),
    ]);
    const first = ok(responses[0]),
      second = ok(responses[1]);
    assert.ok(
      JSON.stringify(first) === JSON.stringify(second),
      'Concurrent retries share one import receipt',
    );
    assert.equal(await Question.countDocuments(), 3);
    assert.equal(ok(await admin.get('/admin/question-imports')).items.length, 1);
    assert.equal(
      (await admin.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch, 'skip')))
        .status,
      409,
    );
  });
  it('binds previews to their administrator/content and revalidates subjects, expiry and permissions', async () => {
    const batch = await preview();
    await User.create({
      name: 'Other admin',
      email: 'other-admin@phase3.invalid',
      role: 'admin',
      passwordHash,
    });
    const other = await client('other-admin@phase3.invalid', 'admin');
    assert.equal(
      (await other.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch))).status,
      404,
    );
    assert.equal(
      (
        await admin.post(`/admin/question-imports/${batch.id}/commit`, {
          ...decisions(batch),
          digest: '0'.repeat(64),
        })
      ).status,
      409,
    );
    await Subject.updateOne({ _id: subject._id }, { $set: { code: 'RENAMED' } });
    assert.equal(
      (await admin.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch))).status,
      409,
    );
    await Subject.updateOne({ _id: subject._id }, { $set: { code: 'P3' } });
    await QuestionImport.updateOne(
      { _id: batch.id },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    assert.equal(
      (await admin.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch))).status,
      410,
    );
    await User.updateOne({ _id: adminUser._id }, { $set: { active: false } });
    await assert.rejects(
      commitImport(batch.id, decisions(batch), adminUser._id),
      (error) => error.status === 403,
    );
    assert.equal(await Question.countDocuments(), 0);
  });
  it('rolls back a mid-batch storage failure and can retry the same preview without partial questions or versions', async () => {
    const batch = await preview();
    const original = QuestionVersion.create;
    let calls = 0;
    QuestionVersion.create = function (...args) {
      if (++calls === 2) throw new Error('Mocked persistence failure');
      return original.apply(this, args);
    };
    try {
      assert.equal(
        (await admin.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch))).status,
        500,
      );
    } finally {
      QuestionVersion.create = original;
    }
    assert.equal(await Question.countDocuments(), 0);
    assert.equal(await QuestionVersion.countDocuments(), 0);
    assert.equal((await QuestionImport.findById(batch.id)).status, 'preview');
    assert.equal((await commit(batch)).imported, 3);
  });
  it('detects duplicates introduced after preview and never exposes exchange endpoints to students or guests', async () => {
    const batch = await preview();
    await bank();
    assert.equal(
      (await admin.post(`/admin/question-imports/${batch.id}/commit`, decisions(batch))).body.error
        .code,
      'DUPLICATES_CHANGED',
    );
    const again = await preview();
    assert.ok(again.rows.every((row) => row.existingDuplicates.length === 1));
    assert.equal((await student.get('/admin/questions/templates/csv')).status, 403);
    assert.equal(
      (
        await student.post('/admin/question-imports/preview', {
          format: 'json',
          content: document(external()),
        })
      ).status,
      403,
    );
    const guest = await client();
    assert.equal((await guest.get('/admin/question-imports')).status, 401);
    assert.equal(
      (
        await student.post('/admin/questions/export', {
          format: 'json',
          ids: [(await Question.findOne()).id],
        })
      ).status,
      403,
    );
  });
});
describe('question organization, history and concurrency', () => {
  it('rejects stale concurrent edits and preserves an immutable version history and comparison', async () => {
    const [question] = await bank();
    const input = questionData(await Question.findById(question.id));
    assert.equal((await admin.put(`/admin/questions/${question.id}`, input)).status, 428);
    const results = await Promise.all(
      ['First edit', 'Second edit'].map((prompt) =>
        admin.put(`/admin/questions/${question.id}`, { ...input, prompt, expectedVersion: 1 }),
      ),
    );
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await Question.findById(question.id)).revision, 2);
    const history = ok(
      await admin.get(`/admin/questions/${question.id}/history?pageSize=1&page=2`),
    );
    assert.equal(history.items[0].revision, 1);
    assert.equal(history.pagination.total, 2);
    const comparison = ok(await admin.get(`/admin/questions/${question.id}/compare?from=1&to=2`));
    assert.ok(comparison.changes.some((change) => change.field === 'prompt'));
    assert.equal((await student.get(`/admin/questions/${question.id}/history`)).status, 403);
  });
  it('atomically bulk-tags/archives with version checks and keeps published snapshots and completed grades', async () => {
    const questions = await bank();
    const exam = await publish(await draft(questions));
    const attempt = await start(exam);
    ok(await student.post(`/student/attempts/${attempt.id}/submit`));
    const original = await Attempt.findById(attempt.id);
    const snapshot = JSON.stringify((await Exam.findById(exam.id)).questions);
    const items = questions.map((question) => ({ id: question.id, expectedVersion: 1 }));
    assert.equal(
      (
        await admin.post('/admin/questions/bulk', {
          operation: 'tag',
          items: [{ ...items[0] }, { ...items[1], expectedVersion: 99 }],
          tags: ['bulk'],
        })
      ).status,
      409,
    );
    assert.ok((await Question.find()).every((question) => question.revision === 1));
    ok(await admin.post('/admin/questions/bulk', { operation: 'tag', items, tags: ['bulk'] }));
    assert.equal(
      ok(await admin.get('/admin/questions?tag=bulk&topic=transport&difficulty=easy&sort=revision'))
        .pagination.total,
      2,
    );
    ok(
      await admin.post('/admin/questions/bulk', {
        operation: 'archive',
        items: items.map((item) => ({ ...item, expectedVersion: 2 })),
        archived: true,
      }),
    );
    assert.equal(ok(await admin.get('/admin/questions?archived=true')).pagination.total, 3);
    assert.ok(
      JSON.stringify((await Exam.findById(exam.id)).questions) === snapshot,
      'Bank archive preserves published snapshots',
    );
    const saved = await Attempt.findById(attempt.id);
    assert.equal(saved.score, original.score);
    assert.equal(saved.submittedAt.getTime(), original.submittedAt.getTime());
    assert.equal(ok(await admin.get(`/admin/questions/${questions[0].id}`)).publishedExamCount, 1);
  });
  it('captures a legacy baseline without rewriting its existing published or attempt records', async () => {
    const question = await Question.create({
      ...questionData({ ...external()[0], subject: subject._id }),
      subject: subject._id,
    });
    assert.ok(ok(await admin.get(`/admin/questions/${question.id}/history`)).legacyBaseline);
    ok(
      await admin.put(`/admin/questions/${question.id}`, {
        ...questionData(question),
        expectedVersion: 1,
        topic: 'legacy edit',
      }),
    );
    assert.equal(await QuestionVersion.countDocuments({ question: question._id }), 2);
  });
  it('backfills only missing fingerprints with a safe dry-run and idempotent apply', async () => {
    const question = await Question.create({
      ...questionData({ ...external()[0], subject: subject._id }),
      subject: subject._id,
    });
    const before = await Question.collection.findOne({ _id: question._id });
    assert.equal((await backfillQuestionFingerprints()).found, 1);
    assert.equal((await Question.collection.findOne({ _id: question._id })).contentHash, undefined);
    assert.equal((await backfillQuestionFingerprints({ apply: true })).changed, 1);
    const after = await Question.collection.findOne({ _id: question._id });
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    assert.equal(after.revision, before.revision);
    assert.equal((await backfillQuestionFingerprints({ apply: true })).changed, 0);
  });
});
describe('frozen pools, variants and exam lifecycle', () => {
  const rules = () => [
    { id: 'general', subject: String(subject._id), count: 1, points: 3, penalty: 1 },
    {
      id: 'easy',
      subject: String(subject._id),
      difficulty: 'easy',
      count: 2,
      points: 2,
      penalty: 0.5,
    },
  ];
  it('rejects insufficient and overlapping unsatisfiable pools with a failed publication checklist', async () => {
    assert.throws(
      () => boundedSnapshots([{ prompt: '界'.repeat(3000000) }]),
      (error) => error.code === 'SNAPSHOT_BUDGET',
    );
    await bank();
    const exam = await draft([], { mode: 'pool', poolRules: [{ ...rules()[0], count: 4 }] });
    assert.equal(ok(await admin.get(`/admin/exams/${exam.id}/publication-checklist`)).ready, false);
    assert.equal(
      (await admin.post(`/admin/exams/${exam.id}/publish`)).body.error.code,
      'POOL_INSUFFICIENT',
    );
    const overlap = await draft([], {
      mode: 'pool',
      poolRules: [
        { ...rules()[0], count: 2 },
        { ...rules()[0], id: 'overlap', count: 2 },
      ],
    });
    assert.equal(
      (await admin.post(`/admin/exams/${overlap.id}/publish`)).body.error.code,
      'POOL_UNSATISFIABLE',
    );
  });
  it('selects unique persisted versions/order with consistent marks across variants and survives later bank changes', async () => {
    const questions = await bank();
    for (let i = 0; i < 2; i++)
      ok(
        await admin.post('/admin/questions', {
          ...questionData(await Question.findById(questions[2].id)),
          prompt: `Extra frozen candidate ${i}`,
        }),
      );
    const exam = await publish(await draft([], { mode: 'pool', poolRules: rules() }));
    const frozen = await Exam.findById(exam.id);
    for (let i = 0; i < 20; i++) {
      const variant = selectAttemptQuestions(frozen);
      assert.equal(new Set(variant.map((question) => String(question.questionId))).size, 3);
      assert.equal(
        variant.reduce((sum, question) => sum + question.points, 0),
        7,
      );
    }
    const checklist = ok(await admin.get(`/admin/exams/${exam.id}/publication-checklist`));
    assert.equal(checklist.totalMarks, 7);
    const first = await start(exam);
    noKeys(first);
    assert.equal(first.questions.length, 3);
    assert.equal(new Set(first.questions.map((question) => question.id)).size, 3);
    assert.equal(ok(await student.get('/student/exams')).items[0].questionCount, 3);
    const unselected = frozen.questions.find(
      (question) =>
        !first.questions.some((selected) => selected.id === String(question.questionId)),
    );
    assert.equal(
      (
        await student.put(`/student/attempts/${first.id}/answers`, {
          version: first.version,
          answers: [{ questionId: String(unselected.questionId), choiceIds: ['true'] }],
        })
      ).status,
      422,
    );
    const changed = await Question.findById(questions[0].id);
    ok(
      await admin.put(`/admin/questions/${changed.id}`, {
        ...questionData(changed),
        expectedVersion: 1,
        prompt: 'Changed after publication',
        archived: true,
      }),
    );
    const resumed = ok(await student.get(`/student/attempts/${first.id}`));
    assert.ok(
      JSON.stringify(resumed.questions) === JSON.stringify(first.questions),
      'Recovery preserves selected questions and option order',
    );
    const secondUser = await User.create({
      name: 'Variant student',
      email: 'variant@phase3.invalid',
      role: 'student',
      passwordHash,
    });
    const secondClient = await client(secondUser.email);
    ok(await admin.post(`/admin/exams/${exam.id}/assign`, { studentIds: [secondUser.id] }));
    const second = await start(exam, secondClient);
    noKeys(second);
    for (const attempt of [first, second]) {
      const record = await Attempt.findById(attempt.id);
      assert.equal(
        record.selectedQuestions.reduce((sum, question) => sum + question.points, 0),
        7,
      );
      assert.equal(record.selectedQuestions.length, 3);
      assert.equal(
        record.selectedQuestions.some(
          (question) => question.prompt === 'Changed after publication',
        ),
        false,
      );
    }
    ok(await student.post(`/student/attempts/${first.id}/submit`));
    assert.equal((await Attempt.findById(first.id)).maxScore, 7);
    assert.equal((await student.get(`/student/attempts/${first.id}/result`)).status, 403);
  });
  it('deduplicates assignment previews, duplicates only drafts, and closes active attempts without altering schedules or saved responses', async () => {
    const questions = await bank();
    const exam = await publish(await draft(questions));
    const counts = ok(
      await admin.post(`/admin/exams/${exam.id}/assignment-preview`, {
        studentIds: [studentUser.id],
        cohortIds: [cohort.id],
      }),
    );
    assert.equal(counts.eligible, 1);
    assert.equal(counts.alreadyAssigned, 1);
    assert.equal(counts.newAssignments, 0);
    const attempt = await start(exam);
    ok(
      await student.put(`/student/attempts/${attempt.id}/answers`, {
        version: 0,
        answers: [{ questionId: questions[0].id, choiceIds: ['a'] }],
      }),
    );
    const closed = ok(
      await admin.post(`/admin/exams/${exam.id}/close`, {
        reason: '[TEST FICTIONAL] Administrative closure',
      }),
    );
    assert.equal(closed.remaining, 0);
    const record = await Attempt.findById(attempt.id);
    assert.equal(record.score, 2);
    assert.equal(record.submissionReason, 'admin-close');
    assert.equal(record.deadline.toISOString(), attempt.deadline);
    const persisted = await Exam.findById(exam.id);
    assert.equal(persisted.closesAt.toISOString(), exam.closesAt);
    assert.equal(String(persisted.closedBy), adminUser.id);
    assert.equal((await student.post(`/student/exams/${exam.id}/start`)).status, 409);
    assert.equal(ok(await student.get('/student/exams?view=completed')).pagination.total, 1);
    ok(await admin.post(`/admin/exams/${exam.id}/release`));
    const result = ok(await student.get(`/student/attempts/${attempt.id}/result`));
    assert.equal(result.score, 2);
    const copy = ok(await admin.post(`/admin/exams/${exam.id}/duplicate`));
    assert.equal(copy.status, 'draft');
    assert.equal(copy.resultsReleased, false);
    assert.equal(copy.closedAt, null);
    assert.equal(await Assignment.countDocuments({ exam: copy.id }), 0);
    ok(await admin.post(`/admin/exams/${exam.id}/archive`, { reason: 'History retained' }));
    assert.equal((await Attempt.findById(attempt.id)).score, 2);
    assert.equal(ok(await admin.get('/admin/exams?archived=true')).pagination.total, 1);
  });
  it('reconciles close/save/submit races into one durable grade and rejects further writes', async () => {
    const questions = await bank();
    const exam = await publish(await draft(questions));
    const attempt = await start(exam);
    ok(
      await student.put(`/student/attempts/${attempt.id}/answers`, {
        version: 0,
        answers: [{ questionId: questions[0].id, choiceIds: ['a'] }],
      }),
    );
    const responses = await Promise.all([
      admin.post(`/admin/exams/${exam.id}/close`, { reason: 'Race closure' }),
      student.put(`/student/attempts/${attempt.id}/answers`, {
        version: 1,
        answers: [{ questionId: questions[0].id, choiceIds: ['b'] }],
      }),
      student.post(`/student/attempts/${attempt.id}/submit`),
    ]);
    responses.forEach(ok);
    await expireDueAttempts();
    const record = await Attempt.findById(attempt.id);
    assert.equal(record.status, 'submitted');
    assert.ok([2, -0.5].includes(record.score));
    assert.equal(await Attempt.countDocuments({ assignment: record.assignment }), 1);
    const score = record.score,
      time = record.submittedAt.getTime();
    ok(
      await student.put(`/student/attempts/${attempt.id}/answers`, {
        version: record.version,
        answers: [],
      }),
    );
    ok(await student.post(`/student/attempts/${attempt.id}/submit`));
    const after = await Attempt.findById(attempt.id);
    assert.equal(after.score, score);
    assert.equal(after.submittedAt.getTime(), time);
    assert.equal(after.deadline.toISOString(), attempt.deadline);
  });
  it('recovers finalization after a worker interruption without rewriting completed attempts', async () => {
    const questions = await bank();
    const exam = await publish(await draft(questions));
    const attempt = await start(exam);
    await Exam.updateOne(
      { _id: exam.id },
      {
        $set: {
          closedAt: new Date(),
          closedBy: adminUser._id,
          closeReason: 'Simulated worker interruption',
        },
      },
    );
    await expireDueAttempts();
    assert.equal((await Attempt.findById(attempt.id)).submissionReason, 'admin-close');
    const before = (await Attempt.findById(attempt.id)).toObject();
    await expireDueAttempts();
    const after = (await Attempt.findById(attempt.id)).toObject();
    assert.ok(
      JSON.stringify(before) === JSON.stringify(after),
      'Repeated finalization never rewrites history',
    );
    assert.equal(
      (await student.post(`/admin/exams/${exam.id}/close`, { reason: 'Denied' })).status,
      403,
    );
    noKeys(ok(await student.get(`/student/attempts/${attempt.id}`)));
  });
});
