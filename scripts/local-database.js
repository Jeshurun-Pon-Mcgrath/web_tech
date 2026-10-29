// Local development only. Uses a real mongod replica set, with persistent disk storage.
import { mkdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureTestMongo } from './test-mongo.js';
configureTestMongo();
const dbPath = fileURLToPath(new URL('../.cache/dev-database', import.meta.url));
const uri = 'mongodb://127.0.0.1:27017/examledger?replicaSet=rs0';

async function portAvailable() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(27017, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function verifyExistingDatabase() {
  const connection = mongoose.createConnection();
  try {
    await connection.openUri('mongodb://127.0.0.1:27017/admin', {
      directConnection: true,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 3000,
    });
    const admin = connection.db.admin();
    const hello = await admin.command({ hello: 1 });
    const options = await admin.command({ getCmdLineOpts: 1 });
    const actualPath = options.parsed?.storage?.dbPath;
    const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const matches =
      actualPath &&
      normalize(await realpath(path.resolve(actualPath))) === normalize(await realpath(dbPath));
    if (hello.setName !== 'rs0' || !matches) {
      throw new Error('Port 27017 belongs to a different database. It has been left unchanged.');
    }
    if (!hello.isWritablePrimary) {
      throw new Error('ExamLedger MongoDB is already starting. Wait a few seconds and retry.');
    }
  } catch (error) {
    throw new Error(
      `Cannot reuse the process on port 27017: ${error.message} No additional database was started.`,
    );
  } finally {
    await connection.close();
  }
}

async function main() {
  await mkdir(dbPath, { recursive: true });
  if (!(await portAvailable())) {
    await verifyExistingDatabase();
    console.log('ExamLedger MongoDB is already running and healthy:', uri);
    console.log('Using the existing persistent database. No second instance was started.');
    console.log('Open http://127.0.0.1:5174/admin/login if the app is already running.');
    return;
  }
  const repl = await MongoMemoryReplSet.create({
    instanceOpts: [{ port: 27017, dbPath }],
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  console.log('Development MongoDB ready:', repl.getUri('examledger'));
  console.log(
    'Data persists in .cache/dev-database. Keep this terminal open; Ctrl+C stops the database.',
  );
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await repl.stop({ doCleanup: false });
    process.exit(0);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(`Local MongoDB startup failed: ${error.message}`);
  console.error(
    'Do not delete mongod.lock while a database process is running. Existing data has not been reset.',
  );
  process.exitCode = 1;
});
