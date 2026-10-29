import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5174'),
  MONGODB_URI: z.string().min(1),
  CSRF_SECRET: z.string().min(32),
  SESSION_HOURS: z.coerce.number().positive().max(168).default(12),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
  APP_URL: z.url().optional(),
  EMAIL_ADAPTER: z.enum(['preview', 'smtp']).default('preview'),
  EMAIL_FROM: z.email().default('examledger@localhost.invalid'),
  EMAIL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f\d]{64}$/i)
    .optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
});
export const env = schema.parse(process.env);
env.APP_URL ||= env.WEB_ORIGIN;
const applicationUrl = new URL(env.APP_URL);
if (
  applicationUrl.username ||
  applicationUrl.password ||
  applicationUrl.search ||
  applicationUrl.hash ||
  applicationUrl.pathname !== '/'
) {
  throw new Error(
    'APP_URL must be a trusted application origin without credentials, path, query or fragment.',
  );
}
if (
  env.NODE_ENV === 'production' &&
  (!env.APP_URL.startsWith('https://') ||
    env.EMAIL_ADAPTER !== 'smtp' ||
    !env.EMAIL_ENCRYPTION_KEY ||
    !env.SMTP_HOST ||
    !env.SMTP_USER ||
    !env.SMTP_PASSWORD)
) {
  throw new Error(
    'Production requires HTTPS APP_URL, SMTP configuration and EMAIL_ENCRYPTION_KEY.',
  );
}
if (env.NODE_ENV === 'test' && env.EMAIL_ADAPTER !== 'preview')
  throw new Error('Tests cannot use production email delivery.');
if (
  env.NODE_ENV === 'production' &&
  (!env.WEB_ORIGIN.startsWith('https://') || env.CSRF_SECRET.includes('replace-with'))
) {
  throw new Error('Production requires an HTTPS origin and a random CSRF_SECRET.');
}
