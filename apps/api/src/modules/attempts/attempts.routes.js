import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/security.js';
import { id, validate, validateId } from '../../middleware/validation.js';
import { INTEGRITY_TYPES, ANSWER_LIMIT } from '@examledger/contracts';
import * as service from './attempts.service.js';
import { optionId } from '../admin/admin.validators.js';
import { studentListQuery, listStudentExams, assignedExam } from './student.lists.js';
import { report, reportCsv, studentReportQuery } from '../admin/reporting.service.js';
export const studentRouter = Router();
studentRouter.use(authenticate, authorize('student'));
const reply = (handler) => async (req, res) => res.json({ data: await handler(req) });
studentRouter.get(
  '/performance',
  validate(studentReportQuery, 'query'),
  reply((req) => report(req.validated.query, req.user._id)),
);
studentRouter.get(
  '/performance/export',
  validate(studentReportQuery, 'query'),
  reply((req) => reportCsv(req.validated.query, req.user._id)),
);
studentRouter.get(
  '/exams',
  validate(studentListQuery, 'query'),
  reply((req) => listStudentExams(req.user._id, req.validated.query)),
);
studentRouter.get(
  '/exams/:id',
  validateId,
  reply((req) => assignedExam(req.params.id, req.user._id)),
);
studentRouter.post(
  '/exams/:id/readiness',
  validateId,
  validate(
    z.object({ acknowledged: z.literal(true), connectionChecked: z.literal(true) }).strict(),
  ),
  reply((req) => service.readiness(req.params.id, req.user._id)),
);
studentRouter.post(
  '/exams/:id/start',
  validateId,
  validate(z.object({}).strict()),
  reply((req) => service.startAttempt(req.params.id, req.user._id)),
);
studentRouter.get(
  '/attempts/:id',
  validateId,
  reply((req) => service.getAttempt(req.params.id, req.user._id)),
);
studentRouter.put(
  '/attempts/:id/answers',
  validateId,
  validate(
    z
      .object({
        version: z.number().int().nonnegative(),
        answers: z
          .array(
            z
              .object({
                questionId: id,
                choiceId: optionId.optional(),
                choiceIds: z.array(optionId).min(1).max(8).optional(),
              })
              .strict()
              .refine((a) => Boolean(a.choiceId) !== Boolean(a.choiceIds), {
                message: 'Provide one selection representation.',
              }),
          )
          .max(ANSWER_LIMIT),
      })
      .strict(),
  ),
  reply((req) => service.saveAnswers(req.params.id, req.user._id, req.validated.body)),
);
studentRouter.post(
  '/attempts/:id/submit',
  validateId,
  validate(z.object({}).strict()),
  reply((req) => service.submitAttempt(req.params.id, req.user._id)),
);
studentRouter.post(
  '/attempts/:id/events',
  validateId,
  validate(z.object({ type: z.enum(INTEGRITY_TYPES) }).strict()),
  reply((req) => service.integrityEvent(req.params.id, req.user._id, req.validated.body.type)),
);
studentRouter.get(
  '/attempts/:id/result',
  validateId,
  reply((req) => service.result(req.params.id, req.user._id)),
);
