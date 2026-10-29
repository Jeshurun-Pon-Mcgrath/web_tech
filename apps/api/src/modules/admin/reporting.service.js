import mongoose from 'mongoose';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import { id } from '../../middleware/validation.js';
import { Assignment } from '../models.js';
import { protectCell } from './question-imports.service.js';

export const reportQuery = z
  .object({
    exam: id.optional(),
    cohort: id.optional(),
    attempts: z.enum(['latest', 'all']).default('latest'),
    passPercent: z.coerce.number().min(0).max(100).default(40),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    questionPage: z.coerce.number().int().min(1).max(100000).default(1),
    sort: z.enum(['submittedAt', 'percentage']).default('submittedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export const studentReportQuery = reportQuery
  .omit({ cohort: true, attempts: true, questionPage: true })
  .strict();
export const reportExportQuery = reportQuery
  .extend({ kind: z.enum(['results', 'questions']).default('results') })
  .strict();
const objectId = (value) => new mongoose.Types.ObjectId(value);
const execute = (Model, pipeline) =>
  Model.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 15000 });
function pagination(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, totalPages);
  return { page, pageSize, total, totalPages, hasPrevious: page > 1, hasNext: page < totalPages };
}
function basePipeline(q, studentId, now) {
  const published = { status: 'published' };
  if (studentId)
    Object.assign(published, {
      resultsReleased: true,
      $or: [{ closesAt: { $lte: now } }, { closedAt: { $type: 'date', $lte: now } }],
    });
  return [
    {
      $match: {
        ...(studentId ? { student: objectId(studentId) } : {}),
        ...(q.exam ? { exam: objectId(q.exam) } : {}),
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'student',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, email: 1, cohort: 1 } }],
        as: 'person',
      },
    },
    { $unwind: '$person' },
    ...(q.cohort ? [{ $match: { 'person.cohort': objectId(q.cohort) } }] : []),
    {
      $lookup: {
        from: 'exams',
        localField: 'exam',
        foreignField: '_id',
        pipeline: [{ $match: published }, { $project: { title: 1, resultsReleased: 1 } }],
        as: 'assessment',
      },
    },
    { $unwind: '$assessment' },
    {
      $lookup: {
        from: 'attempts',
        let: { assignment: '$_id', owner: '$student' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ['$assignment', '$$assignment'] }, { $eq: ['$student', '$$owner'] }],
              },
            },
          },
          { $sort: { number: -1, _id: -1 } },
          { $project: { number: 1, status: 1, score: 1, maxScore: 1, submittedAt: 1 } },
        ],
        as: 'attempts',
      },
    },
    {
      $set: {
        finalized: {
          $filter: {
            input: '$attempts',
            as: 'attempt',
            cond: { $eq: ['$$attempt.status', 'submitted'] },
          },
        },
      },
    },
  ];
}
function selectedPipeline(base, q) {
  return [
    ...base,
    { $set: { samples: q.attempts === 'all' ? '$finalized' : { $slice: ['$finalized', 1] } } },
    { $unwind: '$samples' },
    {
      $match: {
        'samples.score': { $type: 'number' },
        'samples.maxScore': { $type: 'number', $gt: 0 },
      },
    },
    {
      $set: {
        percentage: { $multiply: [{ $divide: ['$samples.score', '$samples.maxScore'] }, 100] },
      },
    },
  ];
}
const questionPipeline = (selected) => [
  ...selected,
  {
    $lookup: {
      from: 'attempts',
      localField: 'samples._id',
      foreignField: '_id',
      pipeline: [{ $project: { selectedQuestions: 1, answers: 1 } }],
      as: 'saved',
    },
  },
  { $unwind: '$saved' },
  // Only legacy attempts need their exam snapshot. New variants never use current bank data.
  {
    $lookup: {
      from: 'exams',
      let: { exam: '$exam', legacy: { $eq: [{ $type: '$saved.selectedQuestions' }, 'missing'] } },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$_id', '$$exam'] }, '$$legacy'] } } },
        { $project: { questions: 1 } },
      ],
      as: 'legacy',
    },
  },
  {
    $set: {
      frozen: { $ifNull: ['$saved.selectedQuestions', { $arrayElemAt: ['$legacy.questions', 0] }] },
    },
  },
  { $unwind: '$frozen' },
  {
    $set: {
      answer: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$saved.answers',
              as: 'answer',
              cond: { $eq: ['$$answer.questionId', { $toString: '$frozen.questionId' }] },
            },
          },
          0,
        ],
      },
    },
  },
  {
    $set: {
      selected: {
        $ifNull: [
          '$answer.choiceIds',
          { $cond: [{ $ifNull: ['$answer.choiceId', false] }, ['$answer.choiceId'], []] },
        ],
      },
      correct: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$frozen.correctChoiceIds', []] } }, 0] },
          '$frozen.correctChoiceIds',
          {
            $cond: [
              { $ifNull: ['$frozen.correctChoiceId', false] },
              ['$frozen.correctChoiceId'],
              [],
            ],
          },
        ],
      },
    },
  },
  {
    $group: {
      _id: {
        exam: '$exam',
        question: '$frozen.questionId',
        revision: { $ifNull: ['$frozen.revision', 1] },
      },
      title: { $first: '$assessment.title' },
      prompt: { $first: '$frozen.prompt' },
      sampleSize: { $sum: 1 },
      correctCount: {
        $sum: {
          $cond: [
            {
              $and: [
                { $gt: [{ $size: '$selected' }, 0] },
                { $eq: [{ $size: '$selected' }, { $size: '$correct' }] },
                { $setEquals: ['$selected', '$correct'] },
              ],
            },
            1,
            0,
          ],
        },
      },
    },
  },
];
export async function report(input, studentId, includeQuestions = true) {
  const q = studentId
    ? { ...studentReportQuery.parse(input), attempts: 'latest', questionPage: 1 }
    : reportQuery.parse(input);
  const base = basePipeline(q, studentId, new Date()),
    selected = selectedPipeline(base, q);
  const [denominators = {}] = await execute(Assignment, [
    ...base,
    {
      $group: {
        _id: null,
        assigned: { $sum: 1 },
        participated: { $sum: { $cond: [{ $gt: [{ $size: '$attempts' }, 0] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $gt: [{ $size: '$finalized' }, 0] }, 1, 0] } },
        finalizedAttempts: { $sum: { $size: '$finalized' } },
      },
    },
  ]);
  const [analysis] = await execute(Assignment, [
    ...selected,
    {
      $facet: {
        stats: [
          {
            $group: {
              _id: null,
              sampleSize: { $sum: 1 },
              mean: { $avg: '$percentage' },
              passed: { $sum: { $cond: [{ $gte: ['$percentage', q.passPercent] }, 1, 0] } },
            },
          },
        ],
        median: [
          {
            $setWindowFields: {
              sortBy: { percentage: 1 },
              output: {
                rank: { $documentNumber: {} },
                count: { $count: {}, window: { documents: ['unbounded', 'unbounded'] } },
              },
            },
          },
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ['$rank', { $floor: { $divide: [{ $add: ['$count', 1] }, 2] } }] },
                  { $eq: ['$rank', { $floor: { $divide: [{ $add: ['$count', 2] }, 2] } }] },
                ],
              },
            },
          },
          { $group: { _id: null, value: { $avg: '$percentage' } } },
        ],
        distribution: [
          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    { case: { $lt: ['$percentage', 0] }, then: '<0' },
                    { case: { $lt: ['$percentage', 40] }, then: '0–<40' },
                    { case: { $lt: ['$percentage', 60] }, then: '40–<60' },
                    { case: { $lt: ['$percentage', 80] }, then: '60–<80' },
                  ],
                  default: '>=80',
                },
              },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);
  const stats = analysis.stats[0] || { sampleSize: 0, mean: null, passed: 0 };
  const pages = pagination(stats.sampleSize, q.page, q.pageSize);
  const rows = await execute(Assignment, [
    ...selected,
    {
      $sort: {
        [q.sort === 'percentage' ? 'percentage' : 'samples.submittedAt']:
          q.order === 'asc' ? 1 : -1,
        'samples._id': q.order === 'asc' ? 1 : -1,
      },
    },
    { $skip: (pages.page - 1) * q.pageSize },
    { $limit: q.pageSize },
    { $project: { assessment: 1, person: 1, samples: 1, percentage: 1 } },
  ]);
  let questions = { items: [], pagination: pagination(0, 1, q.pageSize) };
  if (!studentId && includeQuestions) {
    const stages = questionPipeline(selected);
    const count = (await execute(Assignment, [...stages, { $count: 'total' }]))[0]?.total || 0;
    const questionPages = pagination(count, q.questionPage, q.pageSize);
    const accuracy = await execute(Assignment, [
      ...stages,
      { $sort: { title: 1, '_id.exam': 1, '_id.question': 1, '_id.revision': 1 } },
      { $skip: (questionPages.page - 1) * q.pageSize },
      { $limit: q.pageSize },
    ]);
    questions = {
      pagination: questionPages,
      items: accuracy.map((row) => ({
        id: `${row._id.exam}:${row._id.question}:${row._id.revision}`,
        exam: row.title,
        prompt: row.prompt,
        revision: row._id.revision,
        sampleSize: row.sampleSize,
        correct: row.correctCount,
        accuracy: (row.correctCount / row.sampleSize) * 100,
      })),
    };
  }
  return {
    items: rows.map((row) => ({
      id: String(row.samples._id),
      exam: row.assessment.title,
      examId: String(row.assessment._id),
      ...(studentId ? {} : { student: row.person.name, email: row.person.email }),
      number: row.samples.number,
      score: row.samples.score,
      maxScore: row.samples.maxScore,
      percentage: row.percentage,
      submittedAt: row.samples.submittedAt,
      released: row.assessment.resultsReleased,
    })),
    pagination: pages,
    questions,
    summary: {
      assigned: denominators.assigned || 0,
      participated: denominators.participated || 0,
      completed: denominators.completed || 0,
      finalizedAttempts: denominators.finalizedAttempts || 0,
      sampleSize: stats.sampleSize,
      mean: stats.mean,
      median: analysis.median[0]?.value ?? null,
      passed: stats.passed,
      passRate: stats.sampleSize ? (stats.passed / stats.sampleSize) * 100 : null,
      passPercent: q.passPercent,
    },
    distribution: ['<0', '0–<40', '40–<60', '60–<80', '>=80'].map((band) => ({
      band,
      count: analysis.distribution.find((row) => row._id === band)?.count || 0,
    })),
    policy: {
      attempts: q.attempts,
      cohort:
        'Current cohort membership; counts are exam/student assignments, not unique people across exams.',
      scores: studentId
        ? 'Only your closed, explicitly released results.'
        : 'Administrator-only finalized scores, including unreleased results.',
      denominators:
        'Participation: assignments with any start / assigned. Completion: assignments with any finalized attempt / assigned. Score statistics: selected finalized attempts with numeric scores and positive maximum; percentages, not raw marks. Pending expiry is not finalized.',
      multipleAttempts:
        q.attempts === 'all'
          ? 'All finalized attempts; retakes contribute separate score samples.'
          : 'Latest finalized attempt per exam/student assignment, by attempt number; not best score.',
      pass: 'Analytical cutoff only, not an institutional pass award. Question accuracy uses exact option sets, including blanks as incorrect; denominator is selected variants containing that exam/question version.',
    },
  };
}
export async function reportCsv(query, studentId) {
  const { kind = 'results', ...filters } = query;
  const data = await report(filters, studentId, kind === 'questions' && !studentId);
  if (kind === 'questions' && !studentId)
    return {
      filename: 'examledger-question-accuracy-page.csv',
      contentType: 'text/csv;charset=utf-8',
      page: data.questions.pagination,
      policy: data.policy,
      content: stringify(
        [
          [
            'Exam',
            'Question',
            'Frozen version',
            'Sample size',
            'Correct',
            'Exact-set accuracy %',
            'Attempt handling',
          ],
          ...data.questions.items.map((row) => [
            row.exam,
            row.prompt,
            row.revision,
            row.sampleSize,
            row.correct,
            row.accuracy,
            data.policy.attempts,
          ]),
        ].map((row) => row.map((value) => protectCell(String(value)))),
        { record_delimiter: '\r\n' },
      ),
    };
  const rows = data.items.map((row) => [
    row.exam,
    ...(studentId ? [] : [row.student, row.email]),
    row.number,
    row.score,
    row.maxScore,
    row.percentage,
    row.submittedAt.toISOString(),
    row.released,
    data.policy.attempts,
    data.summary.passPercent,
  ]);
  return {
    filename: 'examledger-results-page.csv',
    contentType: 'text/csv;charset=utf-8',
    content: stringify(
      [
        [
          'Exam',
          ...(studentId ? [] : ['Student', 'Email']),
          'Attempt',
          'Score',
          'Maximum',
          'Percentage',
          'Submitted UTC',
          'Released',
          'Attempt handling',
          'Analytical cutoff % (not official)',
        ],
        ...rows,
      ].map((row) => row.map((value) => protectCell(String(value)))),
      { record_delimiter: '\r\n' },
    ),
    page: data.pagination,
    policy: data.policy,
  };
}
