import mongoose from 'mongoose';
import { env } from './env.js';
mongoose.set('strictQuery', true);
export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    await mongoose.disconnect();
    throw new Error(
      'ExamLedger requires a MongoDB replica set or sharded cluster for transactions.',
    );
  }
}
