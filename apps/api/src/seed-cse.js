import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { models, User } from './modules/models.js';
import { seedCseFixtures, csePrefix, cseEmail } from './modules/maintenance/cse-fixtures.js';
import { cseStudentNames } from './modules/maintenance/cse-catalog.js';

try {
  if (env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_ONLY');
  await connectDatabase();
  for (const model of models) await model.init();
  const filename = fileURLToPath(
    new URL('../../../.cache/cse-demo-accounts.json', import.meta.url),
  );
  let accounts;
  try {
    accounts = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (
      await User.exists({
        fixtureKey: { $regex: '^' + csePrefix.replaceAll('.', '\\.') + 'student-' },
      })
    )
      throw new Error('PRIVATE_CREDENTIALS_MISSING');
    accounts = cseStudentNames.map((name, index) => ({
      name: `[CSE DEMO] ${name}`,
      email: cseEmail(index),
      password: randomBytes(18).toString('base64url'),
    }));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(accounts, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  }
  if (
    !Array.isArray(accounts) ||
    accounts.length !== 20 ||
    accounts.some((account, index) => account.email !== cseEmail(index))
  )
    throw new Error('PRIVATE_CREDENTIALS_INVALID');
  console.log(JSON.stringify(await seedCseFixtures(accounts.map((account) => account.password))));
  console.log(
    'Fictional CSE fixtures only. Existing records retained. Private student logins: .cache/cse-demo-accounts.json (not printed).',
  );
} catch (error) {
  console.error(
    error.code === 11000
      ? 'CSE seed refused a unique-field collision. Existing records were not overwritten.'
      : 'CSE seed stopped. Check the local database, administrator and private credentials file. Production is prohibited. Existing accounts were not reset.',
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
