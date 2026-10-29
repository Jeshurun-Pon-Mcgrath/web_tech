import mongoose from 'mongoose';
import { Question, Subject } from '../models.js';
import { contentFingerprint } from '../admin/questions.service.js';
// Additive metadata only: no question revision, timestamps, snapshots or grades are changed.
export async function backfillQuestionFingerprints({ apply = false } = {}) {
  let found = 0,
    changed = 0;
  for await (const record of Question.find({ contentHash: { $exists: false } })
    .select('_id')
    .cursor()) {
    found++;
    if (!apply) continue;
    const applied = await mongoose.connection.transaction(async (session) => {
      const question = await Question.findOne({
        _id: record._id,
        contentHash: { $exists: false },
      }).session(session);
      if (!question) return 0;
      await Subject.updateOne(
        { _id: question.subject },
        { $inc: { __v: 1 } },
        { session, timestamps: false },
      );
      const result = await Question.updateOne(
        { _id: question._id, contentHash: { $exists: false } },
        { $set: { contentHash: contentFingerprint(question) } },
        { session, timestamps: false },
      );
      return result.modifiedCount;
    });
    changed += applied;
  }
  return { dryRun: !apply, found, changed };
}
