import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AccountToken, EmailOutbox, User } from '../models.js';
import { accountStatus } from '../auth/auth.serializers.js';
import { assert } from '../../utils/errors.js';

const key = env.EMAIL_ENCRYPTION_KEY
  ? Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex')
  : createHash('sha256').update(`email-outbox:${env.CSRF_SECRET}`).digest();
export function encryptMessage(message) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}
export function decryptMessage(payload) {
  const [iv, tag, encrypted] = payload.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function accountMessage(user, purpose, rawToken) {
  const invitation = purpose === 'invitation';
  const link = new URL(invitation ? '/accept-invitation' : '/reset-password', env.APP_URL);
  link.hash = new URLSearchParams({ token: rawToken }).toString();
  const subject = invitation
    ? 'Your ExamLedger student invitation'
    : 'Reset your ExamLedger password';
  const action = invitation ? 'Set your initial password' : 'Reset your password';
  const text = `Hello ${user.name},\n\n${action}: ${link.href}\n\nThis single-use link expires in ${invitation ? '24 hours' : '30 minutes'}. Opening it does not change your account. If you did not expect this message, ignore it. Never share this link.\n\nExamLedger`;
  return {
    to: user.email,
    subject,
    text,
    html: `<p>Hello ${escapeHtml(user.name)},</p><p><a href="${escapeHtml(link.href)}">${action}</a></p><p>This single-use link expires in ${invitation ? '24 hours' : '30 minutes'}. Opening it does not change your account. If unexpected, ignore it. Never share this link.</p><p>ExamLedger</p>`,
  };
}
export const previewsEnabled = () =>
  env.NODE_ENV !== 'production' && env.EMAIL_ADAPTER === 'preview';
export function createSmtpAdapter(config = env, transportFactory = nodemailer.createTransport) {
  const transport = transportFactory({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    requireTLS: config.SMTP_SECURE !== 'true',
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false,
    debug: false,
  });
  return {
    send: async (message, id) => {
      const info = await transport.sendMail({
        ...message,
        from: config.EMAIL_FROM,
        messageId: `<${id}@${new URL(config.APP_URL).hostname}>`,
      });
      if (!info.accepted?.length) throw new Error('Delivery not accepted');
    },
  };
}
let adapter;
function configuredAdapter() {
  adapter ||= env.EMAIL_ADAPTER === 'smtp' ? createSmtpAdapter() : { send: async () => {} };
  return adapter;
}
export async function tokenDeliverable(record) {
  const token = await AccountToken.findById(record.accountToken);
  const user = await User.findById(record.user);
  return Boolean(
    token &&
    !token.usedAt &&
    !token.revokedAt &&
    token.expiresAt > new Date() &&
    user &&
    accountStatus(user) === (record.purpose === 'invitation' ? 'pending' : 'active'),
  );
}
// Claims and bounded retries deliver existing messages; they never repeat account mutations.
export async function deliverNextEmail(delivery = configuredAdapter(), now = new Date()) {
  const owner = randomUUID();
  await EmailOutbox.updateMany(
    { status: 'processing', leaseUntil: { $lte: now }, attempts: { $gte: 3 } },
    { $set: { status: 'failed' }, $unset: { leaseOwner: 1, leaseUntil: 1 } },
  );
  const record = await EmailOutbox.findOneAndUpdate(
    {
      attempts: { $lt: 3 },
      availableAt: { $lte: now },
      $or: [{ status: 'queued' }, { status: 'processing', leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        status: 'processing',
        leaseUntil: new Date(now.getTime() + 60000),
        leaseOwner: owner,
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { availableAt: 1, _id: 1 } },
  ).select('+payload');
  if (!record) return false;
  const claim = { _id: record._id, status: 'processing', leaseOwner: owner };
  if (!(await tokenDeliverable(record))) {
    await EmailOutbox.updateOne(claim, {
      $set: { status: 'cancelled' },
      $unset: { payload: 1, leaseOwner: 1, leaseUntil: 1 },
    });
    return true;
  }
  try {
    let timer;
    try {
      await Promise.race([
        delivery.send(decryptMessage(record.payload), String(record._id)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Delivery timeout')), 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await EmailOutbox.updateOne(claim, {
      $set: { status: 'sent', deliveredAt: new Date() },
      $unset: { leaseOwner: 1, leaseUntil: 1, ...(!previewsEnabled() ? { payload: 1 } : {}) },
    });
    logger.info(
      { deliveryId: String(record._id), attempt: record.attempts, status: 'sent' },
      'Email delivery',
    );
  } catch {
    const status = record.attempts >= 3 ? 'failed' : 'queued';
    await EmailOutbox.updateOne(claim, {
      $set: {
        status,
        availableAt: new Date(now.getTime() + Math.min(60000, 1000 * 2 ** record.attempts)),
      },
      $unset: { leaseOwner: 1, leaseUntil: 1 },
    });
    logger.warn(
      { deliveryId: String(record._id), attempt: record.attempts, status },
      'Email delivery failed',
    );
  }
  return true;
}
export function startEmailWorker() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 10 && (await deliverNextEmail()); i++);
    } catch {
      logger.error({ status: 'worker-error' }, 'Email outbox unavailable');
    } finally {
      running = false;
    }
  }, 1000);
  timer.unref();
  return timer;
}
export async function listPreviews() {
  assert(previewsEnabled(), 404, 'NOT_FOUND', 'Endpoint not found.');
  return listDeliveries();
}
export async function listDeliveries() {
  const rows = await EmailOutbox.find()
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .populate('user', 'email');
  return {
    items: rows.map((row) => ({
      id: String(row._id),
      recipient: row.user?.email || 'Unavailable',
      purpose: row.purpose,
      status: row.status,
      attempts: row.attempts,
      createdAt: row.createdAt,
    })),
  };
}
export async function retryDelivery(id) {
  const record = await EmailOutbox.findById(id).select('+payload');
  assert(
    record?.status === 'failed' && record.payload && (await tokenDeliverable(record)),
    409,
    'DELIVERY_UNAVAILABLE',
    'Only failed deliveries with a still-valid link can be retried.',
  );
  const updated = await EmailOutbox.updateOne(
    { _id: id, status: 'failed' },
    {
      $set: { status: 'queued', attempts: 0, availableAt: new Date() },
      $unset: { leaseUntil: 1, leaseOwner: 1 },
    },
  );
  assert(
    updated.modifiedCount === 1,
    409,
    'DELIVERY_CHANGED',
    'This delivery changed. Refresh and try again.',
  );
  return { queued: true };
}
export async function previewEmail(id) {
  assert(previewsEnabled(), 404, 'NOT_FOUND', 'Endpoint not found.');
  const record = await EmailOutbox.findById(id).select('+payload');
  assert(
    record?.payload && (await tokenDeliverable(record)),
    410,
    'PREVIEW_UNAVAILABLE',
    'This preview has expired or its link is no longer usable.',
  );
  const message = decryptMessage(record.payload);
  return { subject: message.subject, text: message.text };
}
