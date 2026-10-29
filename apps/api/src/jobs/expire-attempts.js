import { Attempt } from '../modules/models.js';
import { expireAttempt } from '../modules/attempts/attempts.service.js';
import { logger } from '../utils/logger.js';
export async function expireDueAttempts() {
  const due = await Attempt.find({ status: 'active', deadline: { $lte: new Date() } })
    .select('_id')
    .limit(100);
  for (const attempt of due) await expireAttempt(attempt._id);
  const closing = await Attempt.aggregate([
    { $match: { status: 'active' } },
    {
      $lookup: {
        from: 'exams',
        localField: 'exam',
        foreignField: '_id',
        pipeline: [
          { $match: { closedAt: { $type: 'date', $lte: new Date() } } },
          { $project: { _id: 1 } },
        ],
        as: 'closedExam',
      },
    },
    { $match: { 'closedExam.0': { $exists: true } } },
    { $limit: 100 },
    { $project: { _id: 1 } },
  ]);
  for (const attempt of closing) await expireAttempt(attempt._id);
}
export function startExpiryJob() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireDueAttempts();
    } catch (err) {
      logger.error({ errorType: err.name }, 'Attempt expiry failed');
    } finally {
      running = false;
    }
  }, 5000);
  timer.unref();
  return timer;
}
