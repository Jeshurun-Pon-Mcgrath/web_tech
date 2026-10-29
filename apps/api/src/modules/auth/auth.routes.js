import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../middleware/validation.js';
import { authenticate, cookieOptions, SESSION_COOKIE } from '../../middleware/security.js';
import { login, changePassword, logoutAll } from './auth.service.js';
import { requestReset, inspectToken, redeemToken } from './recovery.service.js';
import { previewsEnabled } from '../email/email.service.js';
import { serializeUser } from './auth.serializers.js';
import { Session } from '../models.js';
export function createAuthRouter() {
  const authRouter = Router();
  const publicLimit = () =>
    rateLimit({
      windowMs: 15 * 60000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
    });
  const password = z.string().min(12).max(128);
  const tokenInput = z
    .object({ token: z.string().regex(/^[a-f\d]{64}$/), purpose: z.enum(['invitation', 'reset']) })
    .strict();
  authRouter.get('/config', (_req, res) => res.json({ data: { emailPreview: previewsEnabled() } }));
  authRouter.post(
    '/forgot-password',
    publicLimit(),
    validate(
      z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) }).strict(),
    ),
    async (req, res) => {
      res.json({ data: await requestReset(req.validated.body.email) });
    },
  );
  authRouter.post('/token-status', publicLimit(), validate(tokenInput), async (req, res) => {
    res.json({ data: await inspectToken(req.validated.body.token, req.validated.body.purpose) });
  });
  authRouter.post(
    '/redeem-token',
    publicLimit(),
    validate(tokenInput.extend({ password }).strict()),
    async (req, res) => {
      const { token, purpose, password } = req.validated.body;
      const data = await redeemToken(token, purpose, password);
      res.clearCookie(SESSION_COOKIE, cookieOptions).json({ data });
    },
  );
  authRouter.post(
    '/change-password',
    publicLimit(),
    authenticate,
    validate(
      z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(),
    ),
    async (req, res) => {
      const { user, token, expiresAt } = await changePassword(req.user._id, req.validated.body);
      res
        .cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt })
        .json({ data: serializeUser(user) });
    },
  );
  authRouter.post(
    '/logout-all',
    authenticate,
    validate(z.object({}).strict()),
    async (req, res) => {
      await logoutAll(req.user._id);
      res.clearCookie(SESSION_COOKIE, cookieOptions).json({ data: { signedOut: true } });
    },
  );
  authRouter.post(
    '/login',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' },
      },
    }),
    validate(
      z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(128),
          portal: z.enum(['admin', 'student']),
        })
        .strict(),
    ),
    async (req, res) => {
      const { user, token, expiresAt } = await login(req.validated.body);
      res
        .cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt })
        .json({ data: serializeUser(user) });
    },
  );
  authRouter.get('/me', authenticate, (req, res) => res.json({ data: serializeUser(req.user) }));
  authRouter.post('/logout', authenticate, async (req, res) => {
    await Session.deleteOne({ _id: req.authSession._id });
    res.clearCookie(SESSION_COOKIE, cookieOptions).json({ data: { signedOut: true } });
  });
  return authRouter;
}
