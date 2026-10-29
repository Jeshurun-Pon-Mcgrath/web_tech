import mongoose from 'mongoose';
import { connectDatabase } from './config/db.js';
import { backfillQuestionFingerprints } from './modules/maintenance/question-fingerprints.js';
const flags = process.argv.slice(2);
if (
  flags.some((flag) => !['--apply', '--dry-run'].includes(flag)) ||
  (flags.includes('--apply') && flags.includes('--dry-run'))
)
  throw new Error('Use --dry-run (default) or --apply.');
await connectDatabase();
try {
  console.log(
    JSON.stringify(await backfillQuestionFingerprints({ apply: flags.includes('--apply') })),
  );
} finally {
  await mongoose.disconnect();
}
