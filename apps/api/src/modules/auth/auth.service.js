import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { User, Session } from '../models.js';
import { env } from '../../config/env.js';
import { hash } from '../../middleware/security.js';
import { assert } from '../../utils/errors.js';
import { accountStatus } from './auth.serializers.js';
import { revokeLinks } from './recovery.service.js';
const dummyHash = await bcrypt.hash(randomBytes(24).toString('hex'), 12);
export async function login({ email, password, portal }) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const valid = await bcrypt.compare(password, user?.passwordHash || dummyHash);
  assert(
    user && valid && accountStatus(user) === 'active' && user.role === portal,
    401,
    'INVALID_CREDENTIALS',
    'Email or password is incorrect for this portal.',
  );
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.SESSION_HOURS * 3600000);
  // A concurrent password reset cannot leave a valid session created from the old hash.
  await Session.create({
    user: user._id,
    tokenHash: hash(token),
    expiresAt,
    authVersion: user.authVersion || 0,
  });
  return { user, token, expiresAt };
}
export async function logoutAll(userId) {
  await mongoose.connection.transaction(async (session) => {
    await User.updateOne({ _id: userId }, { $inc: { authVersion: 1 } }, { session });
    await Session.deleteMany({ user: userId }, { session });
  });
}
export async function changePassword(userId, { currentPassword, newPassword }) {
  const original = await User.findById(userId).select('+passwordHash');
  assert(
    original && (await bcrypt.compare(currentPassword, original.passwordHash || dummyHash)),
    422,
    'CURRENT_PASSWORD_INVALID',
    'Your current password is incorrect.',
  );
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.SESSION_HOURS * 3600000);
  const user = await mongoose.connection.transaction(async (session) => {
    const user = await User.findById(userId).select('+passwordHash').session(session);
    assert(
      user &&
        accountStatus(user) === 'active' &&
        user.passwordHash === original.passwordHash &&
        (user.authVersion || 0) === (original.authVersion || 0),
      409,
      'ACCOUNT_CHANGED',
      'Your account changed. Sign in again before changing your password.',
    );
    user.passwordHash = passwordHash;
    user.authVersion = (user.authVersion || 0) + 1;
    await user.save({ session });
    await revokeLinks(userId, session);
    await Session.deleteMany({ user: userId }, { session });
    await Session.create(
      [{ user: userId, tokenHash: hash(token), expiresAt, authVersion: user.authVersion }],
      { session },
    );
    return user;
  });
  return { user, token, expiresAt };
}
