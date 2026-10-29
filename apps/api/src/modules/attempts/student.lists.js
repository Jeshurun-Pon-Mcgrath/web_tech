import mongoose from 'mongoose';
import { z } from 'zod';
import { attemptControls } from '@examledger/contracts';
import { Assignment, Attempt } from '../models.js';
import { assert } from '../../utils/errors.js';
export const studentListQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    search: z.string().trim().max(100).default(''),
    view: z.enum(['all', 'upcoming', 'available', 'completed', 'missed']).default('all'),
    sort: z.enum(['createdAt', 'title', 'opensAt', 'closesAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Start with this student's unique assignments, never a global exam or attempt collection.
function pipeline(studentId, now, examId) {
  return [
    {
      $match: {
        student: new mongoose.Types.ObjectId(studentId),
        ...(examId ? { exam: new mongoose.Types.ObjectId(examId) } : {}),
      },
    },
    {
      $lookup: {
        from: 'exams',
        localField: 'exam',
        foreignField: '_id',
        pipeline: [
          { $match: { status: 'published' } },
          {
            $project: {
              title: 1,
              subject: 1,
              instructions: 1,
              durationMinutes: 1,
              opensAt: 1,
              closesAt: 1,
              closedAt: 1,
              archivedAt: 1,
              timeZone: 1,
              availabilityEnd: { $min: ['$closesAt', { $ifNull: ['$closedAt', '$closesAt'] }] },
              maxAttempts: 1,
              attemptControls: 1,
              resultsReleased: 1,
              questionCount: {
                $cond: [
                  { $eq: ['$mode', 'pool'] },
                  { $sum: '$frozenPoolRules.count' },
                  { $size: '$questions' },
                ],
              },
            },
          },
        ],
        as: 'examInfo',
      },
    },
    { $unwind: '$examInfo' },
    {
      $lookup: {
        from: 'attempts',
        let: { assignmentId: '$_id', studentId: '$student' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$assignment', '$$assignmentId'] },
                  { $eq: ['$student', '$$studentId'] },
                ],
              },
            },
          },
          { $sort: { number: -1, _id: -1 } },
          { $project: { number: 1, status: 1, deadline: 1, submittedAt: 1 } },
        ],
        as: 'attempts',
      },
    },
    {
      $set: {
        activeAttempt: {
          $anyElementTrue: {
            $map: {
              input: '$attempts',
              as: 'attempt',
              in: {
                $and: [
                  { $eq: ['$$attempt.status', 'active'] },
                  { $gt: ['$$attempt.deadline', now] },
                  { $gt: ['$examInfo.availabilityEnd', now] },
                ],
              },
            },
          },
        },
        completedAttempt: {
          $anyElementTrue: {
            $map: {
              input: '$attempts',
              as: 'attempt',
              in: {
                $or: [
                  { $eq: ['$$attempt.status', 'submitted'] },
                  { $lte: ['$$attempt.deadline', now] },
                  { $lte: ['$examInfo.availabilityEnd', now] },
                ],
              },
            },
          },
        },
      },
    },
    {
      $set: {
        view: {
          $switch: {
            branches: [
              {
                case: { $and: ['$completedAttempt', { $not: ['$activeAttempt'] }] },
                then: 'completed',
              },
              {
                case: {
                  $and: [
                    { $gt: ['$examInfo.opensAt', now] },
                    { $gt: ['$examInfo.availabilityEnd', now] },
                  ],
                },
                then: 'upcoming',
              },
              {
                case: {
                  $and: [
                    { $lte: ['$examInfo.opensAt', now] },
                    { $gt: ['$examInfo.availabilityEnd', now] },
                    {
                      $or: ['$activeAttempt', { $lt: ['$attemptsUsed', '$examInfo.maxAttempts'] }],
                    },
                  ],
                },
                then: 'available',
              },
            ],
            default: 'missed',
          },
        },
      },
    },
  ];
}
function serialize(row, now) {
  const exam = row.examInfo;
  return {
    id: String(exam._id),
    title: exam.title,
    subject: String(exam.subject),
    instructions: exam.instructions,
    durationMinutes: exam.durationMinutes,
    opensAt: exam.opensAt,
    closesAt: exam.closesAt,
    closedAt: exam.closedAt || null,
    archivedAt: exam.archivedAt || null,
    timeZone: exam.timeZone || 'UTC',
    maxAttempts: exam.maxAttempts,
    attemptControls: attemptControls(exam.attemptControls),
    questionCount: exam.questionCount,
    resultsReleased: exam.resultsReleased,
    attemptsUsed: row.attemptsUsed,
    ready: Boolean(row.readinessAt && now - row.readinessAt < 30 * 60000),
    serverNow: now,
    view: row.view,
    attempts: row.attempts.map((attempt) => ({
      id: String(attempt._id),
      number: attempt.number,
      status: attempt.status,
      deadline: attempt.deadline,
      submittedAt: attempt.submittedAt,
    })),
  };
}
export async function listStudentExams(studentId, input) {
  const q = studentListQuery.parse(input);
  const now = new Date();
  const stages = pipeline(studentId, now);
  if (q.view !== 'all') stages.push({ $match: { view: q.view } });
  if (q.search)
    stages.push({ $match: { 'examInfo.title': { $regex: escaped(q.search), $options: 'i' } } });
  const total = (await Assignment.aggregate([...stages, { $count: 'total' }]))[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, totalPages);
  const direction = q.order === 'asc' ? 1 : -1;
  const rows = await Assignment.aggregate([
    ...stages,
    {
      $sort: {
        [q.sort === 'createdAt' ? 'createdAt' : `examInfo.${q.sort}`]: direction,
        _id: direction,
      },
    },
    { $skip: (page - 1) * q.pageSize },
    { $limit: q.pageSize },
  ]);
  return {
    items: rows.map((row) => serialize(row, now)),
    pagination: {
      page,
      pageSize: q.pageSize,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}
export async function assignedExam(examId, studentId) {
  // Finalize only this assignment's expired attempts, without changing their original deadline.
  const assignment = await Assignment.findOne({ exam: examId, student: studentId });
  assert(assignment, 404, 'NOT_FOUND', 'This examination is not assigned to your account.');
  const { expireAttempt } = await import('./attempts.service.js');
  const expired = await Attempt.find({
    assignment: assignment._id,
    student: studentId,
    status: 'active',
  }).select('_id');
  for (const attempt of expired) await expireAttempt(attempt._id);
  const now = new Date();
  const [row] = await Assignment.aggregate(pipeline(studentId, now, examId));
  assert(row, 404, 'NOT_FOUND', 'This examination is unavailable.');
  return serialize(row, now);
}
