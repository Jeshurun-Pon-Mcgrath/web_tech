import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDatabase } from './config/db.js';
import { User, models } from './modules/models.js';
const data = z
  .object({
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(12).max(128),
    SEED_ADMIN_NAME: z.string().min(1).default('Exam Administrator'),
  })
  .parse(process.env);
await connectDatabase();
try {
  for (const model of models) await model.init();
  const email = data.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing)
    throw new Error('This email already exists. Seed does not overwrite existing accounts.');
  await User.create({
    name: data.SEED_ADMIN_NAME,
    email,
    passwordHash: await bcrypt.hash(data.SEED_ADMIN_PASSWORD, 12),
    role: 'admin',
  });
  console.log('Initial administrator created. Sign in through the admin portal.');
} finally {
  await mongoose.disconnect();
}
