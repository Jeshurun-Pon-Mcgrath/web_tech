import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { User, Session, Cohort, AccountToken, EmailOutbox, RecoveryThrottle } from '../models.js';
import { hash } from '../../middleware/security.js';
import { assert } from '../../utils/errors.js';
import { accountStatus, serializeUser } from './auth.serializers.js';
import { accountMessage, encryptMessage } from '../email/email.service.js';
const generic = {
  message:
    'If this account is eligible, a password reset link will be sent. Please check your email.',
};
export async function revokeLinks(user, session, purpose) {
  const filter = { user, ...(purpose ? { purpose } : {}) };
  await AccountToken.updateMany(
    { ...filter, usedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
  await EmailOutbox.updateMany(
    { ...filter, status: { $in: ['queued', 'processing'] } },
    { $set: { status: 'cancelled' }, $unset: { payload: 1 } },
    { session },
  );
}
async function issue(user, purpose, session) {
  await revokeLinks(user._id, session, purpose);
  const raw = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (purpose === 'invitation' ? 24 * 3600000 : 30 * 60000));
  const purgeAt = new Date(expiresAt.getTime() + 30 * 86400000);
  const [token] = await AccountToken.create(
    [{ user: user._id, purpose, tokenHash: hash(raw), expiresAt, purgeAt }],
    { session },
  );
  await EmailOutbox.create(
    [
      {
        user: user._id,
        purpose,
        accountToken: token._id,
        payload: encryptMessage(accountMessage(user, purpose, raw)),
        purgeAt,
      },
    ],
    { session },
  );
}
export async function inviteStudent(data) {
  return mongoose.connection.transaction(async (session) => {
    if (data.cohort)
      assert(
        await Cohort.exists({ _id: data.cohort }).session(session),
        422,
        'INVALID_COHORT',
        'Choose an existing cohort.',
      );
    const [user] = await User.create(
      [
        {
          name: data.name,
          email: data.email,
          cohort: data.cohort,
          role: 'student',
          active: false,
          status: 'pending',
          invitationSentAt: new Date(),
        },
      ],
      { session },
    );
    await issue(user, 'invitation', session);
    return serializeUser(user);
  });
}
export async function manageInvitation(id, action) {
  return mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ _id: id, role: 'student' }).session(session);
    assert(
      user && accountStatus(user) === 'pending',
      409,
      'INVITATION_UNAVAILABLE',
      'Only pending student accounts can receive invitations.',
    );
    if (action === 'resend') {
      assert(
        !user.invitationSentAt || Date.now() - user.invitationSentAt.getTime() >= 60000,
        429,
        'RATE_LIMITED',
        'Wait one minute before resending this invitation.',
      );
      user.invitationSentAt = new Date();
      await issue(user, 'invitation', session);
    } else await revokeLinks(user._id, session, 'invitation');
    user.authVersion = (user.authVersion || 0) + 1;
    await user.save({ session });
    return serializeUser(user);
  });
}
export async function deactivateStudent(id) {
  return mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ _id: id, role: 'student' }).session(session);
    assert(user, 404, 'NOT_FOUND', 'Student not found.');
    user.active = false;
    user.status = 'deactivated';
    user.authVersion = (user.authVersion || 0) + 1;
    // A pending student has no password; keep deactivation possible without fabricating one.
    await User.updateOne(
      { _id: id },
      { $set: { active: false, status: 'deactivated', authVersion: user.authVersion } },
      { session },
    );
    await revokeLinks(id, session);
    await Session.deleteMany({ user: id }, { session });
    return serializeUser(user);
  });
}
async function allowRecovery(email) {
  const key = hash(`reset:${email}`);
  const now = new Date();
  try {
    await RecoveryThrottle.updateOne(
      { key, windowUntil: { $lte: now } },
      {
        $set: {
          count: 0,
          windowUntil: new Date(now.getTime() + 3600000),
          nextAt: now,
          purgeAt: new Date(now.getTime() + 7200000),
        },
      },
    );
    const record = await RecoveryThrottle.findOneAndUpdate(
      { key, count: { $lt: 5 }, nextAt: { $lte: now } },
      { $inc: { count: 1 }, $set: { nextAt: new Date(now.getTime() + 60000) } },
      { new: true },
    );
    if (record) return true;
    if (await RecoveryThrottle.exists({ key })) return false;
    await RecoveryThrottle.create({
      key,
      count: 1,
      nextAt: new Date(now.getTime() + 60000),
      windowUntil: new Date(now.getTime() + 3600000),
      purgeAt: new Date(now.getTime() + 7200000),
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}
export async function requestReset(email) {
  email = email.trim().toLowerCase();
  if (!(await allowRecovery(email))) return generic;
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ email }).session(session);
    if (!user || accountStatus(user) !== 'active') return;
    user.increment();
    await user.save({ session });
    await issue(user, 'reset', session);
  });
  return generic;
}
function checkToken(token) {
  assert(token, 400, 'TOKEN_INVALID', 'This link is malformed or unavailable. Request a new link.');
  assert(
    !token.usedAt,
    409,
    'TOKEN_USED',
    'This link has already been used. Sign in or request a new link.',
  );
  assert(
    !token.revokedAt,
    410,
    'TOKEN_REVOKED',
    'This link was revoked or replaced. Use the newest email.',
  );
  assert(
    token.expiresAt > new Date(),
    410,
    'TOKEN_EXPIRED',
    'This link has expired. Request a new link.',
  );
}
export async function inspectToken(raw, purpose) {
  const token = await AccountToken.findOne({ tokenHash: hash(raw), purpose });
  checkToken(token);
  const user = await User.findById(token.user);
  assert(
    user && accountStatus(user) === (purpose === 'invitation' ? 'pending' : 'active'),
    410,
    'TOKEN_REVOKED',
    'This account cannot use this link. Contact your administrator.',
  );
  return { valid: true };
}
export async function redeemToken(raw, purpose, password) {
  await inspectToken(raw, purpose);
  const passwordHash = await bcrypt.hash(password, 12);
  return mongoose.connection.transaction(async (session) => {
    const token = await AccountToken.findOne({ tokenHash: hash(raw), purpose }).session(session);
    checkToken(token);
    const user = await User.findById(token.user).session(session);
    assert(
      user && accountStatus(user) === (purpose === 'invitation' ? 'pending' : 'active'),
      410,
      'TOKEN_REVOKED',
      'This account cannot use this link. Contact your administrator.',
    );
    token.usedAt = new Date();
    await token.save({ session });
    user.passwordHash = passwordHash;
    user.active = true;
    user.status = 'active';
    user.authVersion = (user.authVersion || 0) + 1;
    await user.save({ session });
    await revokeLinks(user._id, session);
    await Session.deleteMany({ user: user._id }, { session });
    return {
      message:
        purpose === 'invitation'
          ? 'Account activated. Please sign in.'
          : 'Password reset. Please sign in with your new password.',
    };
  });
}
