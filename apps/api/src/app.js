import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { csrfToken, csrfProtection } from './middleware/security.js';
import { errorHandler } from './middleware/errors.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';
import { studentRouter } from './modules/attempts/attempts.routes.js';
import { API_PREFIX } from '@examledger/contracts';
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
      },
    }),
  );
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(
    `${API_PREFIX}/admin/question-imports/preview`,
    express.json({ limit: '768kb', strict: true }),
  );
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use(cookieParser());
  app.use(API_PREFIX, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get(`${API_PREFIX}/health`, (req, res) =>
    res.json({ data: { status: 'ok', serverNow: new Date() } }),
  );
  app.get(`${API_PREFIX}/auth/csrf`, csrfToken);
  app.use(API_PREFIX, csrfProtection);
  app.use(`${API_PREFIX}/auth`, createAuthRouter());
  app.use(`${API_PREFIX}/admin`, createAdminRouter());
  app.use(`${API_PREFIX}/student`, studentRouter);
  app.use((req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }),
  );
  app.use(errorHandler);
  return app;
}
