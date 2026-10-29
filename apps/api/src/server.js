import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { models } from './modules/models.js';
import { startExpiryJob } from './jobs/expire-attempts.js';
import { startEmailWorker } from './modules/email/email.service.js';
await connectDatabase();
for (const model of models) await model.init();
const server = createApp().listen(env.PORT, '127.0.0.1', () =>
  logger.info({ port: env.PORT }, 'ExamLedger API ready'),
);
const expiryTimer = startExpiryJob();
const emailTimer = startEmailWorker();
async function shutdown() {
  clearInterval(expiryTimer);
  clearInterval(emailTimer);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
