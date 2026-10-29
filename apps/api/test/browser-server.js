// Isolated browser-test server. Never imported by the application entry point.
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { configureTestMongo } from '../../../scripts/test-mongo.js';
configureTestMongo();
process.env.NODE_ENV = 'test';
process.env.EMAIL_ADAPTER = 'preview';
process.env.WEB_ORIGIN = 'http://127.0.0.1:4173';
process.env.APP_URL = process.env.WEB_ORIGIN;
process.env.LOG_LEVEL = 'silent';
process.env.CSRF_SECRET = randomBytes(32).toString('hex');
const repl = await MongoMemoryReplSet.create({
  instanceOpts: [{ port: 27119 }],
  replSet: { count: 1, name: 'examledger-e2e', storageEngine: 'wiredTiger' },
});
process.env.MONGODB_URI = repl.getUri('examledger_browser');
const { connectDatabase } = await import('../src/config/db.js');
const { User, models } = await import('../src/modules/models.js');
const { createApp } = await import('../src/app.js');
const { startExpiryJob } = await import('../src/jobs/expire-attempts.js');
const { startEmailWorker } = await import('../src/modules/email/email.service.js');
await connectDatabase();
for (const model of models) await model.init();
await User.create({
  name: 'Browser Test Admin',
  email: 'admin@examledger.test',
  role: 'admin',
  passwordHash: await bcrypt.hash(process.env.EXAMLEDGER_BROWSER_ADMIN_PASSWORD, 12),
});
const server = createApp().listen(4100, '127.0.0.1', () =>
  console.log('Browser test API ready on 4100'),
);
const timer = startExpiryJob();
const emailTimer = startEmailWorker();
async function stop() {
  clearInterval(timer);
  clearInterval(emailTimer);
  server.close(async () => {
    await mongoose.disconnect();
    await repl.stop();
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
