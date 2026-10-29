import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/security.js';
import { validate, validateId, text, id } from '../../middleware/validation.js';
import * as imports from './question-imports.service.js';
import * as questions from './questions.service.js';
import * as lifecycle from './exam-lifecycle.service.js';
import { report, reportCsv, reportQuery, reportExportQuery } from './reporting.service.js';
import { Cohort, Subject } from '../models.js';
import * as input from './admin.validators.js';
import * as service from './admin.service.js';
import { serializeCohort, serializeSubject } from './admin.serializers.js';
import { REVIEW_STATES } from '@examledger/contracts';
import { listRecords, listQuery, overview, getRecord } from './admin.lists.js';
import { inviteStudent, manageInvitation, deactivateStudent } from '../auth/recovery.service.js';
import {
  listPreviews,
  previewEmail,
  listDeliveries,
  retryDelivery,
} from '../email/email.service.js';
export function createAdminRouter() {
  const adminRouter = Router();
  adminRouter.use(authenticate, authorize('admin'));
  const reply = (handler) => async (req, res) => res.json({ data: await handler(req) });
  adminRouter.get(
    '/analytics',
    validate(reportQuery, 'query'),
    reply((req) => report(req.validated.query)),
  );
  adminRouter.get(
    '/analytics/export',
    validate(reportExportQuery, 'query'),
    reply((req) => reportCsv(req.validated.query)),
  );
  const format = z.enum(['json', 'csv']);
  adminRouter.get(
    '/questions/templates/:format',
    validate(z.object({ format }), 'params'),
    reply((req) => imports.importTemplate(req.validated.params.format)),
  );
  adminRouter.post(
    '/questions/export',
    validate(
      z
        .object({
          format,
          ids: z
            .array(id)
            .min(1)
            .max(100)
            .refine((values) => new Set(values).size === values.length, 'Select unique questions.'),
        })
        .strict(),
    ),
    reply((req) => imports.exportQuestions(req.validated.body)),
  );
  adminRouter.post(
    '/question-imports/preview',
    validate(z.object({ format, content: z.string().min(1).max(262144) }).strict()),
    reply((req) => imports.previewImport(req.validated.body, req.user._id)),
  );
  adminRouter.post(
    '/question-imports/:id/commit',
    validateId,
    validate(
      z
        .object({
          digest: z.string().regex(/^[a-f\d]{64}$/),
          decisions: z
            .array(
              z
                .object({
                  row: z.number().int().min(1).max(100),
                  action: z.enum(['import', 'skip']),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict(),
    ),
    reply((req) => imports.commitImport(req.params.id, req.validated.body, req.user._id)),
  );
  adminRouter.get(
    '/question-imports',
    reply(() => imports.importAudit()),
  );
  adminRouter.post(
    '/questions/bulk',
    validate(
      z
        .object({
          items: z
            .array(z.object({ id, expectedVersion: z.number().int().min(1) }).strict())
            .min(1)
            .max(100)
            .refine(
              (values) => new Set(values.map((value) => value.id)).size === values.length,
              'Select unique questions.',
            ),
          operation: z.enum(['tag', 'archive']),
          tags: input.tags.default([]),
          archived: z.boolean().optional(),
        })
        .strict()
        .refine(
          (data) => (data.operation === 'tag' ? data.tags.length > 0 : data.archived !== undefined),
          'Supply tags or the archive state.',
        ),
    ),
    reply((req) => questions.bulkQuestions(req.validated.body, req.user._id)),
  );
  adminRouter.get(
    '/questions/:id/history',
    validateId,
    validate(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict(),
      'query',
    ),
    reply((req) => questions.questionHistory(req.params.id, req.validated.query)),
  );
  adminRouter.get(
    '/questions/:id/compare',
    validateId,
    validate(
      z
        .object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) })
        .strict(),
      'query',
    ),
    reply((req) => questions.compareQuestions(req.params.id, req.validated.query)),
  );
  adminRouter.get(
    '/exams/:id/publication-checklist',
    validateId,
    reply((req) => lifecycle.publicationChecklist(req.params.id)),
  );
  adminRouter.post(
    '/exams/:id/assignment-preview',
    validateId,
    validate(input.assignmentInput),
    reply((req) => lifecycle.assignmentPreview(req.params.id, req.validated.body)),
  );
  adminRouter.post(
    '/exams/:id/duplicate',
    validateId,
    validate(z.object({}).strict()),
    reply((req) => lifecycle.duplicateExam(req.params.id, req.user._id)),
  );
  for (const action of ['close', 'archive'])
    adminRouter.post(
      `/exams/:id/${action}`,
      validateId,
      validate(z.object({ reason: text(1000) }).strict()),
      reply((req) =>
        lifecycle[action === 'close' ? 'closeExam' : 'archiveExam'](
          req.params.id,
          req.validated.body.reason,
          req.user._id,
        ),
      ),
    );
  adminRouter.get(
    '/email-previews',
    reply(() => listPreviews()),
  );
  adminRouter.get(
    '/email-previews/:id',
    validateId,
    reply((req) => previewEmail(req.params.id)),
  );
  adminRouter.get(
    '/email-deliveries',
    reply(() => listDeliveries()),
  );
  adminRouter.post(
    '/email-deliveries/:id/retry',
    validateId,
    validate(z.object({}).strict()),
    reply((req) => retryDelivery(req.params.id)),
  );
  const invitationLimit = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many invitations. Try again later.' } },
  });
  adminRouter.post(
    '/students/:id/deactivate',
    validateId,
    validate(z.object({}).strict()),
    reply((req) => deactivateStudent(req.params.id)),
  );
  adminRouter.post(
    '/student-invitations',
    invitationLimit,
    validate(input.studentInput.omit({ password: true }).strict()),
    reply((req) => inviteStudent(req.validated.body)),
  );
  for (const action of ['resend', 'revoke'])
    adminRouter.post(
      `/students/:id/invitation/${action}`,
      invitationLimit,
      validateId,
      validate(z.object({}).strict()),
      reply((req) => manageInvitation(req.params.id, action)),
    );
  adminRouter.get('/catalog', (req, res) =>
    res.status(410).json({
      error: {
        code: 'CATALOG_RETIRED',
        message: 'Use the paginated resource lists and overview endpoint.',
      },
    }),
  );
  adminRouter.get(
    '/overview',
    reply(() => overview()),
  );
  for (const kind of [
    'students',
    'cohorts',
    'subjects',
    'questions',
    'exams',
    'attempts',
    'integrity',
    'assignments',
  ]) {
    adminRouter.get(
      `/${kind}`,
      validate(listQuery(kind), 'query'),
      reply((req) => listRecords(kind, req.validated.query)),
    );
  }
  for (const kind of ['students', 'cohorts', 'subjects', 'questions', 'exams']) {
    adminRouter.get(
      `/${kind}/:id`,
      validateId,
      reply((req) => getRecord(kind, req.params.id)),
    );
  }
  for (const [path, Model, schema, serialize] of [
    ['cohorts', Cohort, input.cohortInput, serializeCohort],
    ['subjects', Subject, input.subjectInput, serializeSubject],
  ]) {
    adminRouter.post(
      `/${path}`,
      validate(schema),
      reply(async (req) => serialize(await Model.create(req.validated.body))),
    );
    adminRouter.put(
      `/${path}/:id`,
      validateId,
      validate(schema),
      reply(async (req) => {
        const record = await service.requireRecord(Model, req.params.id);
        Object.assign(record, req.validated.body);
        await record.save();
        return serialize(record);
      }),
    );
  }
  adminRouter.post(
    '/students',
    validate(input.studentInput),
    reply((req) => service.createStudent(req.validated.body)),
  );
  adminRouter.put(
    '/students/:id',
    validateId,
    validate(input.studentUpdate),
    reply((req) => service.updateStudent(req.params.id, req.validated.body)),
  );
  adminRouter.post(
    '/questions',
    validate(input.questionInput),
    reply((req) => service.saveQuestion(req.validated.body, undefined, req.user._id)),
  );
  adminRouter.put(
    '/questions/:id',
    validateId,
    validate(input.questionInput),
    reply((req) => service.saveQuestion(req.validated.body, req.params.id, req.user._id)),
  );
  adminRouter.post(
    '/exams',
    validate(input.examInput),
    reply((req) => service.saveExam(req.validated.body, req.user._id)),
  );
  adminRouter.put(
    '/exams/:id',
    validateId,
    validate(input.examInput),
    reply((req) => service.saveExam(req.validated.body, req.user._id, req.params.id)),
  );
  adminRouter.post(
    '/exams/:id/publish',
    validateId,
    validate(z.object({}).strict()),
    reply((req) => service.publishExam(req.params.id)),
  );
  adminRouter.post(
    '/exams/:id/assign',
    validateId,
    validate(input.assignmentInput),
    reply((req) => service.assignExam(req.params.id, req.validated.body)),
  );
  adminRouter.post(
    '/exams/:id/release',
    validateId,
    validate(z.object({}).strict()),
    reply((req) => service.releaseResults(req.params.id)),
  );
  adminRouter.get(
    '/attempts/:id/integrity',
    validateId,
    validate(
      z
        .object({
          historyPage: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict(),
      'query',
    ),
    reply((req) => service.integrityDetail(req.params.id, req.validated.query)),
  );
  adminRouter.put(
    '/attempts/:id/review',
    validateId,
    validate(
      z
        .object({
          status: z.enum(REVIEW_STATES),
          note: text(4000),
          expectedReviewVersion: z.number().int().min(0).optional(),
        })
        .strict(),
    ),
    reply((req) => service.reviewAttempt(req.params.id, req.validated.body, req.user._id)),
  );
  return adminRouter;
}
