import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { Session, User } from '../modules/models.js';
import { assert } from '../utils/errors.js';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};
export const SESSION_COOKIE =
  env.NODE_ENV === 'production' ? '__Host-examledger_session' : 'examledger_session';
const CSRF_COOKIE = env.NODE_ENV === 'production' ? '__Host-examledger_csrf' : 'examledger_csrf';
const sign = (nonce) => createHmac('sha256', env.CSRF_SECRET).update(nonce).digest('hex');
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
function validCsrf(token) {
  if (typeof token !== 'string' || !/^[a-f\d]{64}\.[a-f\d]{64}$/.test(token)) return false;
  const [nonce, signature] = token.split('.');
  return equal(signature, sign(nonce));
}
export function csrfToken(req, res) {
  const nonce = randomBytes(32).toString('hex');
  const existing = req.cookies[CSRF_COOKIE];
  const token = validCsrf(existing) ? existing : `${nonce}.${sign(nonce)}`;
  res.cookie(CSRF_COOKIE, token, { ...cookieOptions, maxAge: 12 * 3600000 });
  res.json({ data: { token } });
}
export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  assert(
    !origin || origin === env.WEB_ORIGIN,
    403,
    'ORIGIN_REJECTED',
    'This request origin is not permitted.',
  );
  const token = req.get('x-csrf-token');
  const cookie = req.cookies[CSRF_COOKIE];
  assert(
    equal(token, cookie) && validCsrf(token),
    403,
    'CSRF_REJECTED',
    'Your security token has expired. Refresh and try again.',
  );
  next();
}
export async function authenticate(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  assert(token && /^[a-f\d]{64}$/.test(token), 401, 'UNAUTHENTICATED', 'Please sign in.');
  const session = await Session.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
  assert(session, 401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in.');
  const user = await User.findOne({ _id: session.user, active: true });
  assert(
    user &&
      !['pending', 'deactivated'].includes(user.status) &&
      (user.authVersion || 0) === (session.authVersion || 0),
    401,
    'UNAUTHENTICATED',
    'Your session has expired. Please sign in.',
  );
  req.user = user;
  req.authSession = session;
  next();
}
export const authorize = (role) => (req, res, next) => {
  assert(req.user.role === role, 403, 'FORBIDDEN', 'You do not have access to this resource.');
  next();
};
