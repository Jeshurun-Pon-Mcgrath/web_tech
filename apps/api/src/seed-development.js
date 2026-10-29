import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { models, User } from './modules/models.js';
import { seedDevelopmentFixtures } from './modules/maintenance/development-fixtures.js';
try {
  if (env.NODE_ENV === 'production')
    throw new Error('Development seeding is disabled in production.');
  await connectDatabase();
  for (const model of models) await model.init();
  const filename = fileURLToPath(
    new URL('../../../.cache/development-fixtures.env', import.meta.url),
  );
  let credentials;
  try {
    credentials = dotenv.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (
      await User.exists({
        fixtureKey: { $in: ['examledger.phase1.student-a', 'examledger.phase1.student-b'] },
      })
    )
      throw new Error(
        'Fixtures already exist but their private credentials file is absent. Restore that file; this command will not reset accounts.',
      );
    credentials = {
      STUDENT_A_EMAIL: 'phase1-student-a@examledger.invalid',
      STUDENT_A_PASSWORD: randomBytes(18).toString('base64url'),
      STUDENT_B_EMAIL: 'phase1-student-b@examledger.invalid',
      STUDENT_B_PASSWORD: randomBytes(18).toString('base64url'),
    };
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(
      filename,
      Object.entries(credentials)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  const result = await seedDevelopmentFixtures({
    a: credentials.STUDENT_A_PASSWORD,
    b: credentials.STUDENT_B_PASSWORD,
  });
  console.log(
    `Fictional development seed complete: ${result.created} records created. Existing records retained.`,
  );
  console.log(
    'Two students, two cohorts, two subjects, eight questions, one draft, and one published exam. Student A is assigned; student B is unassigned.',
  );
  console.log(
    'Credentials are kept in the ignored .cache/development-fixtures.env file. No credentials are printed.',
  );
} catch (error) {
  console.error(
    error.code === 11000
      ? 'Seed refused a unique-field collision. Existing user data was not overwritten.'
      : 'Development seed failed. Check local configuration and fixture prerequisites. Existing accounts were not reset.',
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
