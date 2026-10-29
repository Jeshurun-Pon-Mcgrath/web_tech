import pino from 'pino';
import { env } from '../config/env.js';
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
    'password',
    'passwordHash',
    'token',
  ],
});
