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
process.env.LOG_LEVEL = 'silent';
process.env.EMAIL_ADAPTER = 'preview';
process.env.CSRF_SECRET = randomBytes(32).toString('hex');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-phase2';
const { createApp } = await import('../src/app.js');
const {
  models,
  User,
  Session,
  Cohort,
  Subject,
  Question,
  Exam,
  Assignment,
  Attempt,
  AccountToken,
  EmailOutbox,
  RecoveryThrottle,
} = await import('../src/modules/models.js');
const { decryptMessage, deliverNextEmail, createSmtpAdapter } =
  await import('../src/modules/email/email.service.js');
const { env } = await import('../src/config/env.js');
const { hash, SESSION_COOKIE } = await import('../src/middleware/security.js');
let repl, app, admin, student, other, studentUser, cohort, exam, question, passwordHash;
const password = randomBytes(20).toString('hex');
const newPassword = randomBytes(20).toString('hex');
const ok = (response) => {
  assert.equal(response.status, 200, response.body.error?.code || 'Unexpected status');
  return response.body.data;
};
async function client(email, portal = 'student', secret = password) {
  const agent = request.agent(app);
  const csrf = ok(await agent.get('/api/v1/auth/csrf')).token;
  const result = {
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
  if (email) ok(await result.post('/auth/login', { email, password: secret, portal }));
  return result;
}
async function invitation(email = 'pending@phase2.invalid') {
  return ok(
    await admin.post('/admin/student-invitations', {
      name: '[TEST FICTIONAL] Pending',
      email,
      cohort: String(cohort._id),
    }),
  );
}
async function latestToken(userId, purpose) {
  const row = await EmailOutbox.findOne({ user: userId, purpose })
    .sort({ createdAt: -1, _id: -1 })
    .select('+payload');
  const message = decryptMessage(row.payload);
  const link = new URL(message.text.match(/https?:\/\/\S+/)[0]);
  return { raw: new URLSearchParams(link.hash.slice(1)).get('token'), row, message, link };
}
async function reset(userId = studentUser._id, email = studentUser.email) {
  const guest = await client();
  ok(await guest.post('/auth/forgot-password', { email }));
  return { guest, ...(await latestToken(userId, 'reset')) };
}
async function begin() {
  ok(
    await student.post(`/student/exams/${exam._id}/readiness`, {
      acknowledged: true,
      connectionChecked: true,
    }),
  );
  return ok(await student.post(`/student/exams/${exam._id}/start`));
}
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('phase2_tests'));
  for (const model of models) await model.init();
  passwordHash = await bcrypt.hash(password, 12);
});
beforeEach(async () => {
  for (const model of models) await model.deleteMany({});
  app = createApp();
  cohort = await Cohort.create({ name: '[TEST FICTIONAL] Cohort' });
  await User.create({
    name: '[TEST FICTIONAL] Admin',
    email: 'admin@phase2.invalid',
    role: 'admin',
    passwordHash,
  });
  studentUser = await User.create({
    name: '[TEST FICTIONAL] Student',
    email: 'student@phase2.invalid',
    role: 'student',
    cohort: cohort._id,
    passwordHash,
  });
  await User.create({
    name: '[TEST FICTIONAL] Other',
    email: 'other@phase2.invalid',
    role: 'student',
    passwordHash,
  });
  admin = await client('admin@phase2.invalid', 'admin');
  student = await client(studentUser.email);
  other = await client('other@phase2.invalid');
  const subject = await Subject.create({ name: '[TEST FICTIONAL] Subject', code: 'P2' });
  question = await Question.create({
    subject: subject._id,
    prompt: '[TEST FICTIONAL] Secure transport?',
    choices: [
      { id: 'a', text: 'TLS' },
      { id: 'b', text: 'Cleartext' },
    ],
    correctChoiceIds: ['a'],
    points: 3,
    explanation: 'Private explanation',
  });
  const draft = ok(
    await admin.post('/admin/exams', {
      title: '[TEST FICTIONAL] Assessment',
      subject: String(subject._id),
      durationMinutes: 10,
      opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      maxAttempts: 2,
      questionIds: [String(question._id)],
    }),
  );
  ok(await admin.post(`/admin/exams/${draft.id}/publish`));
  ok(
    await admin.post(`/admin/exams/${draft.id}/assign`, {
      studentIds: [String(studentUser._id)],
      cohortIds: [String(cohort._id)],
    }),
  );
  exam = await Exam.findById(draft.id);
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
describe('administrator-controlled invitations', () => {
  it('creates a pending student and atomically activates only the student role with a hash-stored token', async () => {
    const pending = await invitation();
    assert.equal(pending.status, 'pending');
    assert.equal(pending.active, false);
    const { raw, row } = await latestToken(pending.id, 'invitation');
    const stored = await AccountToken.findById(row.accountToken).select('+tokenHash');
    assert.ok(stored.tokenHash === hash(raw), 'Only the token hash is stored in the token record');
    assert.equal(row.payload.includes(raw), false);
    const guest = await client();
    const payload = { token: raw, purpose: 'invitation', password: newPassword };
    assert.equal(
      (await guest.post('/auth/redeem-token', { ...payload, role: 'admin' })).status,
      422,
    );
    assert.equal(
      (await guest.post('/auth/login', { email: pending.email, password, portal: 'student' }))
        .status,
      401,
    );
    ok(await guest.post('/auth/token-status', { token: raw, purpose: 'invitation' }));
    assert.equal(
      (await User.findById(pending.id)).status,
      'pending',
      'Inspecting a link never consumes it',
    );
    ok(await guest.post('/auth/redeem-token', payload));
    assert.equal((await guest.get('/auth/me')).status, 401);
    const activated = await client(pending.email, 'student', newPassword);
    const user = ok(await activated.get('/auth/me'));
    assert.equal(user.role, 'student');
    assert.equal(user.status, 'active');
    assert.equal(Object.hasOwn(user, 'passwordHash'), false);
    assert.equal((await guest.post('/auth/redeem-token', payload)).status, 409);
  });
  it('limits resend, invalidates the old link, revokes invitations and reports expired links', async () => {
    const pending = await invitation();
    const first = await latestToken(pending.id, 'invitation');
    assert.equal((await admin.post(`/admin/students/${pending.id}/invitation/resend`)).status, 429);
    await User.updateOne(
      { _id: pending.id },
      { $set: { invitationSentAt: new Date(Date.now() - 61000) } },
    );
    ok(await admin.post(`/admin/students/${pending.id}/invitation/resend`));
    const guest = await client();
    assert.equal(
      (await guest.post('/auth/token-status', { token: first.raw, purpose: 'invitation' })).body
        .error.code,
      'TOKEN_REVOKED',
    );
    const second = await latestToken(pending.id, 'invitation');
    await AccountToken.updateOne(
      { _id: second.row.accountToken },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    assert.equal(
      (await guest.post('/auth/token-status', { token: second.raw, purpose: 'invitation' })).body
        .error.code,
      'TOKEN_EXPIRED',
    );
    ok(await admin.post(`/admin/students/${pending.id}/invitation/revoke`));
    assert.equal(
      (
        await guest.post('/auth/redeem-token', {
          token: second.raw,
          purpose: 'invitation',
          password: newPassword,
        })
      ).status,
      410,
    );
    assert.equal(await User.countDocuments({ email: pending.email }), 1);
  });
  it('allows only one concurrent invitation redemption', async () => {
    const pending = await invitation();
    const { raw } = await latestToken(pending.id, 'invitation');
    const a = await client(),
      b = await client();
    const payload = { token: raw, purpose: 'invitation', password: newPassword };
    const results = await Promise.all([
      a.post('/auth/redeem-token', payload),
      b.post('/auth/redeem-token', payload),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await AccountToken.countDocuments({ user: pending.id, usedAt: { $ne: null } }), 1);
  });
  it('never reactivates a deactivated pending account or allows payload role escalation', async () => {
    assert.equal(
      (
        await student.post('/admin/student-invitations', {
          name: 'Denied',
          email: 'denied@phase2.invalid',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await admin.post('/admin/student-invitations', {
          name: 'Denied',
          email: 'denied@phase2.invalid',
          role: 'admin',
        })
      ).status,
      422,
    );
    const pending = await invitation();
    const { raw } = await latestToken(pending.id, 'invitation');
    ok(await admin.post(`/admin/students/${pending.id}/deactivate`));
    const guest = await client();
    assert.equal(
      (
        await guest.post('/auth/redeem-token', {
          token: raw,
          purpose: 'invitation',
          password: newPassword,
        })
      ).status,
      410,
    );
    assert.equal((await admin.post(`/admin/students/${pending.id}/invitation/resend`)).status, 409);
    assert.equal((await User.findById(pending.id)).status, 'deactivated');
    const pendingList = ok(await admin.get('/admin/students?accountStatus=pending'));
    assert.equal(pendingList.pagination.total, 0);
  });
});
describe('password recovery and account security', () => {
  it('uses generic responses and normalized account throttles without issuing links for unknown or inactive accounts', async () => {
    const guest = await client();
    const known = ok(
      await guest.post('/auth/forgot-password', { email: ' STUDENT@PHASE2.INVALID ' }),
    );
    const unknown = ok(
      await guest.post('/auth/forgot-password', { email: 'absent@phase2.invalid' }),
    );
    const again = ok(await guest.post('/auth/forgot-password', { email: studentUser.email }));
    assert.deepEqual(known, unknown);
    assert.deepEqual(known, again);
    assert.equal(await AccountToken.countDocuments({ purpose: 'reset' }), 1);
    assert.equal(await RecoveryThrottle.countDocuments(), 2);
    ok(await admin.post(`/admin/students/${studentUser._id}/deactivate`));
    await RecoveryThrottle.deleteMany({});
    assert.deepEqual(
      ok(await guest.post('/auth/forgot-password', { email: studentUser.email })),
      unknown,
    );
    assert.equal(await AccountToken.countDocuments({ purpose: 'reset' }), 1);
  });
  it('rate limits public recovery by IP equally for unknown identifiers', async () => {
    const guest = await client();
    for (let i = 0; i < 20; i++)
      ok(await guest.post('/auth/forgot-password', { email: `absent${i}@phase2.invalid` }));
    assert.equal(
      (await guest.post('/auth/forgot-password', { email: studentUser.email })).status,
      429,
    );
    assert.equal(await EmailOutbox.countDocuments(), 0);
  });
  it('expires reset links, invalidates older reset links and rejects malformed or used links', async () => {
    const first = await reset();
    await RecoveryThrottle.updateMany({}, { $set: { nextAt: new Date(Date.now() - 1) } });
    const second = await reset();
    assert.equal(
      (await first.guest.post('/auth/token-status', { token: first.raw, purpose: 'reset' })).body
        .error.code,
      'TOKEN_REVOKED',
    );
    await AccountToken.updateOne(
      { _id: second.row.accountToken },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    assert.equal(
      (
        await second.guest.post('/auth/redeem-token', {
          token: second.raw,
          purpose: 'reset',
          password: newPassword,
        })
      ).body.error.code,
      'TOKEN_EXPIRED',
    );
    assert.equal(
      (await second.guest.post('/auth/token-status', { token: 'bad', purpose: 'reset' })).status,
      422,
    );
    assert.equal(
      (
        await second.guest.post('/auth/token-status', {
          token: randomBytes(32).toString('hex'),
          purpose: 'reset',
        })
      ).body.error.code,
      'TOKEN_INVALID',
    );
  });
  it('atomically consumes a reset once, revokes every existing session and requires ordinary login', async () => {
    const anotherSession = await client(studentUser.email);
    const { guest, raw } = await reset();
    await AccountToken.create({
      user: studentUser._id,
      purpose: 'reset',
      tokenHash: hash(randomBytes(32).toString('hex')),
      expiresAt: new Date(Date.now() + 60000),
      purgeAt: new Date(Date.now() + 86400000),
    });
    const second = await client();
    const payload = { token: raw, purpose: 'reset', password: newPassword };
    const responses = await Promise.all([
      guest.post('/auth/redeem-token', payload),
      second.post('/auth/redeem-token', payload),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await guest.get('/auth/me')).status, 401);
    assert.equal((await student.get('/auth/me')).status, 401);
    assert.equal((await anotherSession.get('/auth/me')).status, 401);
    assert.equal(await Session.countDocuments({ user: studentUser._id }), 0);
    assert.equal(
      await AccountToken.countDocuments({
        user: studentUser._id,
        purpose: 'reset',
        usedAt: null,
        revokedAt: null,
      }),
      0,
    );
    // A login may compare the old hash before reset but persist its session afterward.
    const staleSession = randomBytes(32).toString('hex');
    await Session.create({
      user: studentUser._id,
      tokenHash: hash(staleSession),
      authVersion: 0,
      expiresAt: new Date(Date.now() + 60000),
    });
    assert.equal(
      (await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${staleSession}`))
        .status,
      401,
    );
    assert.equal((await guest.post('/auth/redeem-token', payload)).body.error.code, 'TOKEN_USED');
    const signedIn = await client(studentUser.email, 'student', newPassword);
    ok(await signedIn.get('/auth/me'));
  });
  it('denies reset after deactivation without changing the password or reactivating the student', async () => {
    const { guest, raw } = await reset();
    ok(await admin.post(`/admin/students/${studentUser._id}/deactivate`));
    assert.equal(
      (
        await guest.post('/auth/redeem-token', {
          token: raw,
          purpose: 'reset',
          password: newPassword,
        })
      ).status,
      410,
    );
    const user = await User.findById(studentUser._id).select('+passwordHash');
    assert.equal(user.active, false);
    assert.ok(
      user.passwordHash === passwordHash,
      'Deactivation preserves the existing password hash',
    );
  });
  it('requires the current password, rotates the current session and revokes other sessions and reset links', async () => {
    const second = await client(studentUser.email);
    const { guest, raw } = await reset();
    assert.equal(
      (await student.post('/auth/change-password', { currentPassword: 'incorrect', newPassword }))
        .status,
      422,
    );
    const previous = await Session.findOne({ user: studentUser._id });
    ok(await student.post('/auth/change-password', { currentPassword: password, newPassword }));
    ok(await student.get('/auth/me'));
    assert.equal((await second.get('/auth/me')).status, 401);
    assert.equal(await Session.countDocuments({ user: studentUser._id }), 1);
    assert.equal(await Session.exists({ _id: previous._id }), null);
    assert.equal(
      (await guest.post('/auth/token-status', { token: raw, purpose: 'reset' })).body.error.code,
      'TOKEN_REVOKED',
    );
    ok(await student.post('/auth/logout-all'));
    assert.equal((await student.get('/auth/me')).status, 401);
    assert.equal(await Session.countDocuments({ user: studentUser._id }), 0);
  });
  it('supports administrator recovery without changing the administrator role', async () => {
    const adminUser = await User.findOne({ role: 'admin' });
    const { guest, raw } = await reset(adminUser._id, adminUser.email);
    ok(
      await guest.post('/auth/redeem-token', {
        token: raw,
        purpose: 'reset',
        password: newPassword,
      }),
    );
    assert.equal((await admin.get('/auth/me')).status, 401);
    const signedIn = await client(adminUser.email, 'admin', newPassword);
    assert.equal(ok(await signedIn.get('/auth/me')).role, 'admin');
  });
});
describe('persistent email outbox and private previews', () => {
  it('retries failed deliveries without duplicate accounts and serializes worker claims', async () => {
    const pending = await invitation();
    let sends = 0;
    const failing = {
      send: async () => {
        sends++;
        throw new Error('Mock delivery failure');
      },
    };
    await deliverNextEmail(failing);
    let row = await EmailOutbox.findOne({ user: pending.id });
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 1);
    await EmailOutbox.updateOne(
      { _id: row._id },
      { $set: { availableAt: new Date(Date.now() - 1) } },
    );
    const mock = {
      send: async () => {
        sends++;
      },
    };
    await Promise.all([deliverNextEmail(mock), deliverNextEmail(mock)]);
    row = await EmailOutbox.findById(row._id);
    assert.equal(row.status, 'sent');
    assert.equal(row.attempts, 2);
    assert.equal(sends, 2);
    assert.equal(await User.countDocuments({ email: pending.email }), 1);
    assert.equal(await AccountToken.countDocuments({ user: pending.id }), 1);
  });
  it('bounds retries, reclaims crashed leases, and never sends revoked messages', async () => {
    const pending = await invitation();
    const failing = {
      send: async () => {
        throw new Error('Mock failure');
      },
    };
    for (let i = 0; i < 3; i++) {
      await EmailOutbox.updateMany({}, { $set: { availableAt: new Date(Date.now() - 1) } });
      await deliverNextEmail(failing);
    }
    assert.equal((await EmailOutbox.findOne()).status, 'failed');
    assert.equal(await deliverNextEmail(failing), false);
    const failedRow = await EmailOutbox.findOne();
    ok(await admin.post(`/admin/email-deliveries/${failedRow._id}/retry`));
    assert.equal(await User.countDocuments({ email: pending.email }), 1);
    assert.equal(await AccountToken.countDocuments({ user: pending.id }), 1);
    await deliverNextEmail({ send: async () => {} });
    assert.equal((await EmailOutbox.findById(failedRow._id)).status, 'sent');
    await EmailOutbox.updateMany(
      {},
      { $set: { status: 'processing', attempts: 3, leaseUntil: new Date(Date.now() - 1) } },
    );
    await deliverNextEmail(failing);
    assert.equal((await EmailOutbox.findOne()).status, 'failed');
    await User.updateOne(
      { _id: pending.id },
      { $set: { invitationSentAt: new Date(Date.now() - 61000) } },
    );
    ok(await admin.post(`/admin/students/${pending.id}/invitation/resend`));
    ok(await admin.post(`/admin/students/${pending.id}/invitation/revoke`));
    let sends = 0;
    await deliverNextEmail({
      send: async () => {
        sends++;
      },
    });
    assert.equal(sends, 0);
  });
  it('restricts preview contents to development administrators and builds trusted fragment links', async () => {
    const pending = await invitation();
    const { raw, row, link } = await latestToken(pending.id, 'invitation');
    assert.equal(link.origin, new URL(env.APP_URL).origin);
    assert.equal(link.search, '');
    assert.equal(link.hash.length > 0, true);
    const guest = await client();
    assert.equal((await guest.get(`/admin/email-previews/${row._id}`)).status, 401);
    assert.equal((await student.get(`/admin/email-previews/${row._id}`)).status, 403);
    assert.equal(ok(await admin.get('/admin/email-previews')).items.length, 1);
    assert.equal(ok(await admin.get(`/admin/email-previews/${row._id}`)).text.includes(raw), true);
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      assert.equal((await admin.get('/admin/email-previews')).status, 404);
      assert.equal((await admin.get(`/admin/email-previews/${row._id}`)).status, 404);
    } finally {
      env.NODE_ENV = previous;
    }
  });
  it('configures SMTP TLS, bounded timeouts, stable message IDs and checks acceptance through mocks only', async () => {
    let configuration, message;
    const adapter = createSmtpAdapter(
      {
        ...env,
        SMTP_HOST: 'smtp.example.invalid',
        SMTP_USER: 'mock-user',
        SMTP_PASSWORD: 'mock-only',
        SMTP_PORT: 587,
        SMTP_SECURE: 'false',
      },
      (options) => {
        configuration = options;
        return {
          sendMail: async (payload) => {
            message = payload;
            return { accepted: ['mock@example.invalid'] };
          },
        };
      },
    );
    await adapter.send(
      { to: 'mock@example.invalid', subject: 'Mock', text: 'No real email' },
      'stable-id',
    );
    assert.equal(configuration.requireTLS, true);
    assert.equal(configuration.tls.rejectUnauthorized, true);
    assert.equal(configuration.connectionTimeout, 5000);
    assert.equal(configuration.socketTimeout, 10000);
    assert.ok(message.messageId.startsWith('<stable-id@'));
    assert.equal(message.from, env.EMAIL_FROM);
    const rejected = createSmtpAdapter(env, () => ({ sendMail: async () => ({ accepted: [] }) }));
    await assert.rejects(rejected.send({ text: 'mock' }, 'mock'), /not accepted/);
  });
});
describe('student pagination, isolation and session-change recovery', () => {
  it('paginates authorized assignments with stable ordering, no cohort duplicates and strict bounded queries', async () => {
    for (let i = 0; i < 12; i++) {
      const extra = await Exam.create({
        ...exam.toObject(),
        _id: undefined,
        title: `Page ${String(i).padStart(2, '0')}`,
        createdAt: undefined,
        updatedAt: undefined,
      });
      await Assignment.create({ exam: extra._id, student: studentUser._id });
    }
    ok(
      await admin.post(`/admin/exams/${exam._id}/assign`, {
        studentIds: [String(studentUser._id)],
        cohortIds: [String(cohort._id)],
      }),
    );
    const first = ok(await student.get('/student/exams?pageSize=5&sort=title&order=asc'));
    const second = ok(await student.get('/student/exams?pageSize=5&page=2&sort=title&order=asc'));
    assert.equal(first.pagination.total, 13);
    assert.equal(first.items.length, 5);
    assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 10);
    assert.equal(ok(await other.get('/student/exams')).pagination.total, 0);
    assert.equal((await other.get(`/student/exams/${exam._id}`)).status, 404);
    const empty = ok(await student.get('/student/exams?page=999&search=not-found'));
    assert.equal(empty.pagination.page, 1);
    assert.equal(empty.pagination.totalPages, 1);
    assert.equal(ok(await student.get('/student/exams?page=999&pageSize=5')).pagination.page, 3);
    for (const query of [
      'pageSize=51',
      'page=0',
      'sort=questions',
      'student=other',
      'view=bad',
      'search[$ne]=x',
    ])
      assert.equal((await student.get(`/student/exams?${query}`)).status, 422);
    assert.equal(JSON.stringify(first).includes('correctChoice'), false);
    assert.equal(JSON.stringify(first).includes('Private explanation'), false);
  });
  it('defines upcoming, available, completed and missed using server time and preserves eligible retakes', async () => {
    assert.equal(ok(await student.get('/student/exams?view=available')).pagination.total, 1);
    await Exam.updateOne({ _id: exam._id }, { $set: { opensAt: new Date(Date.now() + 60000) } });
    assert.equal(ok(await student.get('/student/exams?view=upcoming')).pagination.total, 1);
    await Exam.updateOne(
      { _id: exam._id },
      { $set: { opensAt: new Date(Date.now() - 120000), closesAt: new Date(Date.now() - 60000) } },
    );
    assert.equal(ok(await student.get('/student/exams?view=missed')).pagination.total, 1);
    await Exam.updateOne({ _id: exam._id }, { $set: { closesAt: new Date(Date.now() + 3600000) } });
    const attempt = await begin();
    ok(await student.post(`/student/attempts/${attempt.id}/submit`));
    assert.equal(ok(await student.get('/student/exams?view=completed')).pagination.total, 1);
    assert.equal(ok(await student.get('/student/exams?view=available')).pagination.total, 0);
    const next = await begin();
    assert.notEqual(next.id, attempt.id);
    assert.equal(ok(await student.get('/student/exams?view=available')).pagination.total, 1);
    await Attempt.updateOne({ _id: next.id }, { $set: { deadline: new Date(Date.now() - 1) } });
    assert.equal(ok(await student.get('/student/exams?view=completed')).pagination.total, 1);
    ok(await student.get(`/student/exams/${exam._id}`));
    assert.equal((await Attempt.findById(next.id)).status, 'submitted');
  });
  it('preserves server answers, original deadlines, grades and attempt allowances through reset and reauthentication', async () => {
    const attempt = await begin();
    const answers = [{ questionId: String(question._id), choiceIds: ['a'] }];
    ok(
      await student.put(`/student/attempts/${attempt.id}/answers`, {
        version: attempt.version,
        answers,
      }),
    );
    const { guest, raw } = await reset();
    ok(
      await guest.post('/auth/redeem-token', {
        token: raw,
        purpose: 'reset',
        password: newPassword,
      }),
    );
    assert.equal(
      (await student.put(`/student/attempts/${attempt.id}/answers`, { version: 1, answers: [] }))
        .status,
      401,
    );
    const resumedClient = await client(studentUser.email, 'student', newPassword);
    const resumed = ok(await resumedClient.get(`/student/attempts/${attempt.id}`));
    assert.deepEqual(resumed.answers, answers);
    assert.equal(resumed.deadline, attempt.deadline);
    assert.equal(resumed.version, 1);
    const same = ok(await resumedClient.post(`/student/exams/${exam._id}/start`));
    assert.equal(same.id, attempt.id);
    assert.equal(
      (await Assignment.findOne({ exam: exam._id, student: studentUser._id })).attemptsUsed,
      1,
    );
    const receipt = ok(await resumedClient.post(`/student/attempts/${attempt.id}/submit`));
    assert.equal((await Attempt.findById(receipt.id)).score, 3);
    assert.equal((await resumedClient.get(`/student/attempts/${attempt.id}/result`)).status, 403);
    ok(await resumedClient.post('/auth/logout-all'));
    assert.equal((await resumedClient.post(`/student/attempts/${attempt.id}/submit`)).status, 401);
    assert.equal((await Attempt.findById(receipt.id)).score, 3);
  });
});
