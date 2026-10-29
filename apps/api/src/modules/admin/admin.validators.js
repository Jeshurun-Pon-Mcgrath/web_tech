import { z } from 'zod';
import { id, text } from '../../middleware/validation.js';
import { QUESTION_TYPES } from '@examledger/contracts';
export const optionId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Use a stable option identifier.');
export const difficulty = z.enum(['unspecified', 'easy', 'medium', 'hard']);
export const tags = z
  .array(text(40).transform((value) => value.toLowerCase()))
  .max(12)
  .refine((values) => new Set(values).size === values.length, 'Tags must be unique.');
export const topic = z.string().trim().max(120).toLowerCase();
export const cohortInput = z
  .object({ name: text(100), description: z.string().trim().max(1000).default('') })
  .strict();
export const subjectInput = z
  .object({
    name: text(120),
    code: text(20).transform((v) => v.toUpperCase()),
    description: z.string().trim().max(1000).default(''),
  })
  .strict();
export const studentInput = z
  .object({
    name: text(120),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    cohort: id.nullable().default(null),
  })
  .strict();
export const studentUpdate = studentInput
  .omit({ password: true })
  .extend({ active: z.boolean(), password: z.string().min(12).max(128).optional() })
  .strict();
export const questionInput = z
  .object({
    subject: id,
    type: z.enum(QUESTION_TYPES).default('single'),
    prompt: text(4000),
    choices: z
      .array(z.object({ id: optionId, text: text(1000) }).strict())
      .min(2)
      .max(8),
    correctChoiceId: optionId.optional(),
    correctChoiceIds: z.array(optionId).min(1).max(8).optional(),
    penalty: z.number().min(0).max(100).multipleOf(0.01).default(0),
    explanation: z.string().trim().max(4000).default(''),
    points: z.number().int().min(1).max(100),
    archived: z.boolean().default(false),
    expectedVersion: z.number().int().min(1).optional(),
    topic: topic.default(''),
    difficulty: difficulty.default('unspecified'),
    tags: tags.default([]),
  })
  .strict()
  .superRefine((q, ctx) => {
    const issue = (field, message) => ctx.addIssue({ code: 'custom', path: [field], message });
    const keys = q.correctChoiceIds || (q.correctChoiceId ? [q.correctChoiceId] : []);
    if (q.correctChoiceId && q.correctChoiceIds)
      issue('correctChoiceIds', 'Provide one answer-key representation.');
    if (new Set(q.choices.map((c) => c.id)).size !== q.choices.length)
      issue('choices', 'Option identifiers must be unique.');
    if (
      !keys.length ||
      new Set(keys).size !== keys.length ||
      keys.some((k) => !q.choices.some((c) => c.id === k))
    )
      issue('correctChoiceIds', 'Choose unique correct options from this question.');
    if (q.type !== 'multiple' && keys.length !== 1)
      issue('correctChoiceIds', 'This question requires exactly one correct option.');
    if (
      q.type === 'true-false' &&
      (q.choices.length !== 2 ||
        !['true', 'false'].every((k) =>
          q.choices.some((c) => c.id === k && c.text === (k === 'true' ? 'True' : 'False')),
        ))
    )
      issue('choices', 'True/false questions require the fixed true/false options.');
    if (q.penalty > q.points)
      issue('penalty', 'The incorrect-answer penalty cannot exceed the question points.');
  });
export const poolRuleInput = z
  .object({
    id: optionId,
    subject: id,
    topic: topic.default(''),
    difficulty: difficulty.optional(),
    tags: tags.default([]),
    count: z.number().int().min(1).max(200),
    points: z.number().int().min(1).max(100),
    penalty: z.number().min(0).max(100).multipleOf(0.01).default(0),
  })
  .strict()
  .refine((rule) => rule.penalty <= rule.points, 'A pool penalty cannot exceed its points.');
export const examInput = z
  .object({
    title: text(180),
    subject: id,
    instructions: z.string().trim().max(8000).default(''),
    durationMinutes: z.number().int().min(1).max(240),
    opensAt: z.iso.datetime({ offset: true }),
    closesAt: z.iso.datetime({ offset: true }),
    maxAttempts: z.number().int().min(1).max(5),
    attemptControls: z
      .object({
        requireFullscreen: z.boolean().default(false),
        disableCopyPaste: z.boolean().default(false),
        disableContextMenu: z.boolean().default(false),
      })
      .strict()
      .default({ requireFullscreen: false, disableCopyPaste: false, disableContextMenu: false }),
    questionIds: z.array(id).max(200).default([]),
    mode: z.enum(['fixed', 'pool']).default('fixed'),
    poolRules: z.array(poolRuleInput).max(10).default([]),
    timeZone: z
      .string()
      .max(100)
      .default('UTC')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid IANA timezone.'),
  })
  .strict()
  .refine((e) => new Date(e.closesAt) > new Date(e.opensAt), {
    message: 'Closing time must be after opening time.',
  })
  .refine((e) => new Set(e.questionIds).size === e.questionIds.length, {
    message: 'Questions cannot be repeated.',
  })
  .superRefine((exam, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', path: ['mode'], message });
    if (exam.mode === 'fixed' && (!exam.questionIds.length || exam.poolRules.length))
      issue('Fixed mode requires questions and no pool rules.');
    if (exam.mode === 'pool' && (exam.questionIds.length || !exam.poolRules.length))
      issue('Pool mode requires rules and no fixed questions.');
    if (new Set(exam.poolRules.map((rule) => rule.id)).size !== exam.poolRules.length)
      issue('Pool section identifiers must be unique.');
    if (exam.poolRules.reduce((sum, rule) => sum + rule.count, 0) > 200)
      issue('An attempt can contain at most 200 questions.');
  });
export const assignmentInput = z
  .object({
    studentIds: z.array(id).max(500).default([]),
    cohortIds: z.array(id).max(50).default([]),
  })
  .strict()
  .refine((v) => v.studentIds.length + v.cohortIds.length > 0, {
    message: 'Choose a student or cohort.',
  });
