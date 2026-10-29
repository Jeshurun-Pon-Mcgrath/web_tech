import mongoose from 'mongoose';
import { z } from 'zod';
import { id } from '../../middleware/validation.js';
import { assert } from '../../utils/errors.js';
import { User, Cohort, Subject, Question, Exam, Assignment, Attempt } from '../models.js';
import { serializeUser } from '../auth/auth.serializers.js';
import {
  serializeCohort,
  serializeSubject,
  serializeQuestion,
  serializeExam,
} from './admin.serializers.js';
import { QUESTION_TYPES, REVIEW_STATES } from '@examledger/contracts';

const definitions = {
  students: {
    Model: User,
    serialize: (row) => ({
      ...serializeUser(row),
      cohortName: row.cohortInfo?.name || 'Unassigned',
    }),
    sorts: ['createdAt', 'name', 'email'],
    search: ['name', 'email'],
  },
  cohorts: {
    Model: Cohort,
    serialize: (row) => ({ ...serializeCohort(row), studentCount: row.studentCount || 0 }),
    sorts: ['createdAt', 'name'],
    search: ['name', 'description'],
  },
  subjects: {
    Model: Subject,
    serialize: serializeSubject,
    sorts: ['createdAt', 'name', 'code'],
    search: ['name', 'code'],
  },
  questions: {
    Model: Question,
    serialize: serializeQuestion,
    sorts: ['createdAt', 'prompt', 'points', 'revision', 'topic', 'difficulty'],
    search: ['prompt'],
  },
  exams: {
    Model: Exam,
    serialize: serializeExam,
    sorts: ['createdAt', 'title', 'opensAt', 'closesAt'],
    search: ['title'],
  },
  attempts: {
    Model: Attempt,
    serialize: serializeAttemptRow,
    sorts: ['createdAt', 'deadline', 'score', 'submittedAt'],
    search: ['student.name', 'student.email', 'exam.title'],
  },
  integrity: {
    Model: Attempt,
    serialize: serializeAttemptRow,
    sorts: ['createdAt', 'reviewStatus', 'deadline'],
    search: ['student.name', 'student.email', 'exam.title', 'reviewNote'],
  },
  assignments: {
    Model: Assignment,
    serialize: serializeAssignmentRow,
    sorts: ['createdAt', 'attemptsUsed'],
    search: ['student.name', 'student.email', 'exam.title'],
  },
};
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const optionalId = id.optional();
const booleanString = z.enum(['true', 'false']).optional();
const base = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).default(''),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
};
const extra = {
  students: {
    active: booleanString,
    cohort: optionalId,
    accountStatus: z.enum(['pending', 'active', 'deactivated']).optional(),
  },
  questions: {
    subject: optionalId,
    type: z.enum(QUESTION_TYPES).optional(),
    archived: booleanString,
    topic: z.string().trim().max(120).toLowerCase().optional(),
    difficulty: z.enum(['unspecified', 'easy', 'medium', 'hard']).optional(),
    tag: z.string().trim().max(40).toLowerCase().optional(),
  },
  exams: {
    subject: optionalId,
    status: z.enum(['draft', 'published']).optional(),
    released: booleanString,
    archived: booleanString,
  },
  attempts: {
    exam: optionalId,
    student: optionalId,
    status: z.enum(['active', 'submitted']).optional(),
  },
  integrity: {
    exam: optionalId,
    student: optionalId,
    status: z.enum(['active', 'submitted']).optional(),
    reviewStatus: z.enum(REVIEW_STATES).optional(),
    hasEvents: booleanString,
  },
  assignments: { exam: optionalId, student: optionalId },
};
export function listQuery(kind) {
  return z
    .object({ ...base, ...extra[kind] })
    .strict()
    .superRefine((q, ctx) => {
      if (!definitions[kind].sorts.includes(q.sort))
        ctx.addIssue({ code: 'custom', path: ['sort'], message: 'Unsupported sorting field.' });
    });
}
const objectId = (value) => new mongoose.Types.ObjectId(value);
const relation = (collection, field, fields) => [
  {
    $lookup: {
      from: collection,
      localField: field,
      foreignField: '_id',
      pipeline: [{ $project: fields }],
      as: field,
    },
  },
  { $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: true } },
];
export async function listRecords(kind, query) {
  const definition = definitions[kind];
  assert(definition, 404, 'NOT_FOUND', 'List not found.');
  const q = listQuery(kind).parse(query);
  const filter = kind === 'students' ? { role: 'student' } : {};
  for (const field of ['cohort', 'subject', 'exam', 'student'])
    if (q[field]) filter[field] = objectId(q[field]);
  for (const field of ['active', 'archived'])
    if (q[field] !== undefined) filter[field] = q[field] === 'true';
  if (q.status) filter.status = q.status;
  if (q.reviewStatus) filter.reviewStatus = q.reviewStatus;
  if (q.released !== undefined) filter.resultsReleased = q.released === 'true';
  if (q.type) filter.type = q.type === 'single' ? { $in: ['single', null] } : q.type;
  if (kind === 'questions') {
    if (q.topic) filter.topic = q.topic;
    if (q.tag) filter.tags = q.tag;
    if (q.difficulty)
      filter.difficulty =
        q.difficulty === 'unspecified' ? { $in: ['unspecified', null] } : q.difficulty;
  }
  if (kind === 'exams' && q.archived !== undefined) {
    delete filter.archived;
    filter.archivedAt = q.archived === 'true' ? { $ne: null } : null;
  }
  if (q.hasEvents !== undefined) filter['events.0'] = { $exists: q.hasEvents === 'true' };
  const pipeline = [{ $match: filter }];
  if (kind === 'questions')
    pipeline.push({
      $set: {
        revision: { $ifNull: ['$revision', 1] },
        topic: { $ifNull: ['$topic', ''] },
        difficulty: { $ifNull: ['$difficulty', 'unspecified'] },
        tags: { $ifNull: ['$tags', []] },
      },
    });
  if (kind === 'students' && q.accountStatus) {
    pipeline.push({
      $set: {
        effectiveStatus: {
          $cond: [
            { $eq: ['$status', 'pending'] },
            'pending',
            {
              $cond: [
                { $or: [{ $eq: ['$active', false] }, { $eq: ['$status', 'deactivated'] }] },
                'deactivated',
                'active',
              ],
            },
          ],
        },
      },
    });
    pipeline.push({ $match: { effectiveStatus: q.accountStatus } });
  }
  if (kind === 'students')
    pipeline.push(
      {
        $lookup: {
          from: 'cohorts',
          localField: 'cohort',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1 } }],
          as: 'cohortInfo',
        },
      },
      { $unwind: { path: '$cohortInfo', preserveNullAndEmptyArrays: true } },
    );
  if (['questions', 'exams'].includes(kind))
    pipeline.push(
      {
        $lookup: {
          from: 'subjects',
          localField: 'subject',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1 } }],
          as: 'subjectInfo',
        },
      },
      { $unwind: { path: '$subjectInfo', preserveNullAndEmptyArrays: true } },
    );
  if (['attempts', 'integrity', 'assignments'].includes(kind)) {
    pipeline.push(
      ...relation('users', 'student', { name: 1, email: 1 }),
      ...relation('exams', 'exam', { title: 1, resultsReleased: 1 }),
    );
  }
  if (q.search)
    pipeline.push({
      $match: {
        $or: definition.search.map((field) => ({
          [field]: { $regex: escaped(q.search), $options: 'i' },
        })),
      },
    });
  const count = await definition.Model.aggregate([...pipeline, { $count: 'total' }]);
  const total = count[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, totalPages);
  const direction = q.order === 'asc' ? 1 : -1;
  const records = await definition.Model.aggregate([
    ...pipeline,
    { $sort: { [q.sort]: direction, _id: direction } },
    { $skip: (page - 1) * q.pageSize },
    { $limit: q.pageSize },
  ]);
  if (kind === 'questions' && records.length) {
    const ids = records.map((row) => row._id);
    const counts = await Exam.aggregate([
      { $match: { status: 'published', 'questions.questionId': { $in: ids } } },
      { $unwind: '$questions' },
      { $match: { 'questions.questionId': { $in: ids } } },
      { $group: { _id: { exam: '$_id', question: '$questions.questionId' } } },
      { $group: { _id: '$_id.question', count: { $sum: 1 } } },
    ]);
    for (const row of records)
      row.publishedExamCount =
        counts.find((count) => String(count._id) === String(row._id))?.count || 0;
  }
  if (kind === 'cohorts' && records.length) {
    const counts = await User.aggregate([
      { $match: { role: 'student', cohort: { $in: records.map((row) => row._id) } } },
      { $group: { _id: '$cohort', count: { $sum: 1 } } },
    ]);
    for (const row of records)
      row.studentCount = counts.find((count) => String(count._id) === String(row._id))?.count || 0;
  }
  return {
    items: records.map(definition.serialize),
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
export async function overview() {
  const [activeStudents, publishedExams, availableQuestions, submittedAttempts, recent] =
    await Promise.all([
      User.countDocuments({ role: 'student', active: true }),
      Exam.countDocuments({ status: 'published' }),
      Question.countDocuments({ archived: false }),
      Attempt.countDocuments({ status: 'submitted' }),
      Exam.find().populate('subject', 'name').sort({ createdAt: -1, _id: -1 }).limit(5),
    ]);
  return {
    counts: { activeStudents, publishedExams, availableQuestions, submittedAttempts },
    recentExams: recent.map(serializeExam),
  };
}
export async function getRecord(kind, identifier) {
  const definition = definitions[kind];
  const record = await definition.Model.findOne({
    _id: identifier,
    ...(kind === 'students' ? { role: 'student' } : {}),
  });
  assert(record, 404, 'NOT_FOUND', 'Record not found.');
  if (kind === 'questions')
    return definition.serialize({
      ...record.toObject(),
      publishedExamCount: await Exam.countDocuments({
        status: 'published',
        'questions.questionId': record._id,
      }),
    });
  if (kind === 'cohorts')
    return definition.serialize({
      ...record.toObject(),
      studentCount: await User.countDocuments({ role: 'student', cohort: record._id }),
    });
  return definition.serialize(record);
}
function serializeAttemptRow(a) {
  return {
    id: String(a._id),
    student: a.student
      ? { id: String(a.student._id), name: a.student.name, email: a.student.email }
      : null,
    exam: a.exam
      ? { id: String(a.exam._id), title: a.exam.title, resultsReleased: a.exam.resultsReleased }
      : null,
    number: a.number,
    status: a.status,
    startedAt: a.startedAt,
    deadline: a.deadline,
    submittedAt: a.submittedAt,
    score: a.status === 'submitted' ? a.score : null,
    maxScore: a.status === 'submitted' ? a.maxScore : null,
    eventCount: a.events?.length || 0,
    reviewStatus: a.reviewStatus,
    reviewNote: a.reviewNote,
  };
}
function serializeAssignmentRow(a) {
  return {
    id: String(a._id),
    student: a.student
      ? { id: String(a.student._id), name: a.student.name, email: a.student.email }
      : null,
    exam: a.exam ? { id: String(a.exam._id), title: a.exam.title } : null,
    attemptsUsed: a.attemptsUsed,
    ready: Boolean(a.readinessAt),
  };
}
