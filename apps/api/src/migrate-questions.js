import mongoose from 'mongoose';
import { connectDatabase } from './config/db.js';
import { migrateLegacyQuestions } from './modules/maintenance/legacy-migration.js';
const args = process.argv.slice(2);
try {
  if (
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  )
    throw new Error('Use either --dry-run (default) or --apply.');
  await connectDatabase();
  console.log(
    JSON.stringify(
      await migrateLegacyQuestions(mongoose.connection, { dryRun: !args.includes('--apply') }),
    ),
  );
  console.log(
    'Only missing representation fields are added. Existing keys, options, scores, receipts, versions, and timestamps are preserved.',
  );
} catch {
  console.error(
    'Migration failed. Check arguments and replica-set configuration. No destructive reset was attempted.',
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
