import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { User, Subject, Question, QuestionImport } from '../models.js';
import { assert } from '../../utils/errors.js';
import { questionInput } from './admin.validators.js';
import { questionData, contentFingerprint, writeQuestion } from './questions.service.js';
export const IMPORT_LIMITS = { bytes: 262144, rows: 100 };
const columns = [
  'schemaVersion',
  'subjectCode',
  'type',
  'prompt',
  'choicesJson',
  'correctChoiceIdsJson',
  'topic',
  'difficulty',
  'tagsJson',
  'points',
  'penalty',
  'explanation',
  'archived',
];
const {
  subject: _subject,
  expectedVersion: _expected,
  correctChoiceId: _legacyKey,
  ...externalFields
} = questionInput.shape;
const externalRow = z
  .object({ ...externalFields, subjectCode: z.string().trim().min(1).max(20).toUpperCase() })
  .strict();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const riskyCell = (value) =>
  /^[=+@-]/.test(
    [...value]
      .filter((character) => character.charCodeAt(0) > 31)
      .join('')
      .trimStart(),
  ) || /^[\t\r\n]/.test(value);
export const protectCell = (value) =>
  value.startsWith("'") || riskyCell(value) ? "'" + value : value;
const unprotectCell = (value) =>
  value.startsWith("'") && (value.slice(1).startsWith("'") || riskyCell(value.slice(1)))
    ? value.slice(1)
    : value;
function parseFile(format, content) {
  assert(
    Buffer.byteLength(content, 'utf8') <= IMPORT_LIMITS.bytes,
    413,
    'IMPORT_TOO_LARGE',
    'Files must be at most 256 KiB.',
  );
  try {
    if (format === 'json') {
      const document = z
        .object({
          format: z.literal('examledger.questions'),
          version: z.literal(1),
          questions: z.array(z.unknown()).min(1).max(100),
        })
        .strict()
        .parse(JSON.parse(content.replace(/^\uFEFF/, '')));
      return document.questions.map((row, index) => ({ row: index + 1, input: row }));
    }
    const table = parse(content, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 40000,
      relax_column_count: false,
    });
    const headers = table.shift();
    assert(
      Array.isArray(headers) &&
        headers.length === columns.length &&
        new Set(headers).size === headers.length &&
        columns.every((column) => headers.includes(column)),
      422,
      'CSV_HEADERS',
      'Use exactly the documented version 1 CSV headers.',
    );
    assert(
      table.length > 0 && table.length <= 100,
      422,
      'IMPORT_ROW_LIMIT',
      'Import 1–100 question rows at a time.',
    );
    return table.map((cells, index) => {
      try {
        const row = Object.fromEntries(
          headers.map((header, i) => [header, unprotectCell(cells[i])]),
        );
        assert(
          row.schemaVersion === '1',
          422,
          'CSV_VERSION',
          'Every row must use schemaVersion 1.',
        );
        assert(
          ['true', 'false'].includes(row.archived),
          422,
          'CSV_BOOLEAN',
          'archived must be true or false.',
        );
        return {
          row: index + 1,
          input: {
            subjectCode: row.subjectCode,
            type: row.type,
            prompt: row.prompt,
            choices: JSON.parse(row.choicesJson),
            correctChoiceIds: JSON.parse(row.correctChoiceIdsJson),
            topic: row.topic,
            difficulty: row.difficulty || 'unspecified',
            tags: JSON.parse(row.tagsJson),
            points: Number(row.points),
            penalty: row.penalty === '' ? 0 : Number(row.penalty),
            explanation: row.explanation,
            archived: row.archived === 'true',
          },
        };
      } catch {
        return {
          row: index + 1,
          errors: [
            {
              field: 'row',
              message: 'Invalid version, boolean, number or nested JSON cell. Use the template.',
            },
          ],
        };
      }
    });
  } catch (error) {
    if (error.status) throw error;
    assert(
      false,
      422,
      'IMPORT_FORMAT_INVALID',
      'Malformed file, unsupported schema, excessive rows or invalid CSV quoting. Use the version 1 template.',
    );
  }
}
async function findDuplicates(rows, session) {
  const subjects = [...new Set(rows.map((row) => row.data.subject))];
  const fingerprints = rows.map((row) => row.fingerprint);
  const candidates = await Question.find({
    subject: { $in: subjects },
    $or: [{ contentHash: { $in: fingerprints } }, { contentHash: { $exists: false } }],
  })
    .select('subject type prompt choices contentHash')
    .limit(2001)
    .session(session || null);
  assert(
    candidates.length <= 2000,
    422,
    'DUPLICATE_SCAN_LIMIT',
    'Narrow the import or backfill fingerprints before importing into a large legacy bank.',
  );
  const matches = new Map();
  for (const question of candidates) {
    const fingerprint = question.contentHash || contentFingerprint(question);
    const ids = matches.get(fingerprint) || [];
    ids.push(String(question._id));
    matches.set(fingerprint, ids);
  }
  return matches;
}
const validationErrors = (error) =>
  error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
export async function previewImport({ format, content }, administrator) {
  const inputs = parseFile(format, content);
  const subjects = await Subject.find({
    code: {
      $in: inputs.map((row) =>
        typeof row.input?.subjectCode === 'string'
          ? row.input.subjectCode.trim().toUpperCase()
          : '',
      ),
    },
  }).select('code');
  const rows = inputs.map((row) => {
    if (row.errors) return row;
    const parsed = externalRow.safeParse(row.input);
    if (!parsed.success) return { row: row.row, errors: validationErrors(parsed.error) };
    const subject = subjects.find((subject) => subject.code === parsed.data.subjectCode);
    if (!subject)
      return {
        row: row.row,
        errors: [
          {
            field: 'subjectCode',
            message: 'No existing subject has this code. Create or correct the subject first.',
          },
        ],
      };
    const { subjectCode, ...fields } = parsed.data;
    const validated = questionInput.safeParse({ ...fields, subject: String(subject._id) });
    if (!validated.success) return { row: row.row, errors: validationErrors(validated.error) };
    const data = questionData(validated.data);
    return { row: row.row, subjectCode, data, fingerprint: contentFingerprint(data), errors: [] };
  });
  if (rows.some((row) => row.errors.length))
    return {
      valid: false,
      rows,
      validRows: rows.filter((row) => !row.errors.length).length,
      errorRows: rows.filter((row) => row.errors.length).length,
    };
  const duplicates = await findDuplicates(rows);
  for (const row of rows) {
    row.existingDuplicates = duplicates.get(row.fingerprint) || [];
    row.duplicateRows = rows
      .filter((other) => other.row !== row.row && other.fingerprint === row.fingerprint)
      .map((other) => other.row);
  }
  const checksum = digest(rows.map(({ row, subjectCode, data }) => ({ row, subjectCode, data })));
  const expiresAt = new Date(Date.now() + 30 * 60000);
  const batch = await QuestionImport.create({
    administrator,
    digest: checksum,
    rows,
    expiresAt,
    purgeAt: new Date(expiresAt.getTime() + 7 * 86400000),
  });
  return {
    id: String(batch._id),
    digest: checksum,
    valid: true,
    rows,
    expiresAt,
    validRows: rows.length,
    errorRows: 0,
  };
}
export async function commitImport(identifier, { digest: checksum, decisions }, administrator) {
  const decisionsHash = digest([...decisions].sort((a, b) => a.row - b.row));
  return mongoose.connection.transaction(async (session) => {
    const admin = await User.findOneAndUpdate(
      {
        _id: administrator,
        role: 'admin',
        active: true,
        status: { $nin: ['pending', 'deactivated'] },
      },
      { $inc: { __v: 1 } },
      { session, new: true },
    );
    assert(admin, 403, 'FORBIDDEN', 'Administrator permission is required to commit this import.');
    const batch = await QuestionImport.findOne({ _id: identifier, administrator }).session(session);
    assert(batch, 404, 'NOT_FOUND', 'Import preview not found for this administrator.');
    assert(
      batch.digest === checksum,
      409,
      'IMPORT_CONTENT_CHANGED',
      'The preview content does not match. Validate the file again.',
    );
    if (batch.status === 'committed') {
      assert(
        batch.decisionsHash === decisionsHash,
        409,
        'IMPORT_ALREADY_COMMITTED',
        'This batch was already committed with different decisions.',
      );
      return batch.summary;
    }
    assert(
      batch.expiresAt > new Date(),
      410,
      'IMPORT_EXPIRED',
      'The preview expired. Validate the file again.',
    );
    assert(
      decisions.length === batch.rows.length &&
        new Set(decisions.map((decision) => decision.row)).size === batch.rows.length &&
        batch.rows.every((row) => decisions.some((decision) => decision.row === row.row)),
      422,
      'IMPORT_DECISIONS_REQUIRED',
      'Choose import or skip for every preview row.',
    );
    assert(
      digest(batch.rows.map(({ row, subjectCode, data }) => ({ row, subjectCode, data }))) ===
        checksum,
      409,
      'IMPORT_CONTENT_CHANGED',
      'Stored preview content changed. Validate again.',
    );
    for (const subjectId of [...new Set(batch.rows.map((row) => row.data.subject))].sort()) {
      const subject = await Subject.findOneAndUpdate(
        { _id: subjectId },
        { $inc: { __v: 1 } },
        { session, new: true },
      );
      assert(
        subject &&
          batch.rows
            .filter((row) => row.data.subject === subjectId)
            .every((row) => row.subjectCode === subject.code),
        409,
        'SUBJECT_CHANGED',
        'A referenced subject changed or was removed. Validate the file again.',
      );
    }
    const duplicates = await findDuplicates(batch.rows, session);
    for (const row of batch.rows) {
      questionInput.parse(row.data);
      if (decisions.find((decision) => decision.row === row.row).action === 'import')
        assert(
          (duplicates.get(row.fingerprint) || []).every((id) =>
            row.existingDuplicates.includes(id),
          ),
          409,
          'DUPLICATES_CHANGED',
          `New duplicate content affects row ${row.row}. Validate again before deciding.`,
        );
    }
    const importedIds = [];
    for (const row of batch.rows)
      if (decisions.find((decision) => decision.row === row.row).action === 'import')
        importedIds.push(
          (await writeQuestion(row.data, undefined, administrator, session, 'import')).id,
        );
    batch.summary = {
      batchId: String(batch._id),
      total: batch.rows.length,
      imported: importedIds.length,
      skipped: batch.rows.length - importedIds.length,
      importedIds,
    };
    batch.status = 'committed';
    batch.decisionsHash = decisionsHash;
    batch.committedAt = new Date();
    batch.purgeAt = undefined;
    batch.rows = [];
    await batch.save({ session });
    return batch.summary;
  });
}
export async function importAudit() {
  const rows = await QuestionImport.find({ status: 'committed' })
    .sort({ committedAt: -1, _id: -1 })
    .limit(50)
    .populate('administrator', 'name');
  return {
    items: rows.map((batch) => ({
      id: String(batch._id),
      administrator: batch.administrator?.name || 'Unavailable',
      committedAt: batch.committedAt,
      total: batch.summary.total,
      imported: batch.summary.imported,
      skipped: batch.summary.skipped,
    })),
  };
}
function externalQuestion(question, subjectCode) {
  const { subject: _subject, ...data } = questionData(question);
  return { subjectCode, ...data };
}
export function formatQuestions(questions, format) {
  const content =
    format === 'json'
      ? JSON.stringify({ format: 'examledger.questions', version: 1, questions }, null, 2) + '\n'
      : stringify(
          [
            columns,
            ...questions.map((question) =>
              [
                1,
                question.subjectCode,
                question.type,
                question.prompt,
                JSON.stringify(question.choices),
                JSON.stringify(question.correctChoiceIds),
                question.topic,
                question.difficulty,
                JSON.stringify(question.tags),
                question.points,
                question.penalty,
                question.explanation,
                question.archived,
              ].map((value) => protectCell(String(value))),
            ),
          ],
          { record_delimiter: '\r\n' },
        );
  assert(
    Buffer.byteLength(content, 'utf8') <= IMPORT_LIMITS.bytes,
    413,
    'EXPORT_TOO_LARGE',
    'Select fewer questions so the exported file remains within the 256 KiB round-trip limit.',
  );
  return {
    filename: `examledger-questions-v1.${format}`,
    contentType: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    content,
  };
}
export async function exportQuestions({ ids, format }) {
  const questions = await Question.find({ _id: { $in: ids } });
  assert(
    questions.length === ids.length,
    409,
    'QUESTIONS_CHANGED',
    'A selected question was removed. Refresh before exporting.',
  );
  const subjects = await Subject.find({
    _id: { $in: questions.map((question) => question.subject) },
  });
  assert(
    questions.every((question) =>
      subjects.some((subject) => String(subject._id) === String(question.subject)),
    ),
    409,
    'SUBJECT_CHANGED',
    'A selected subject is missing.',
  );
  return formatQuestions(
    ids.map((id) => {
      const question = questions.find((question) => String(question._id) === id);
      return externalQuestion(
        question,
        subjects.find((subject) => String(subject._id) === String(question.subject)).code,
      );
    }),
    format,
  );
}
export const fictionalQuestions = ['single', 'multiple', 'true-false'].map((type) => ({
  subjectCode: 'DEV-SUBJECT',
  type,
  prompt: `[FICTIONAL TEMPLATE] ${type} question`,
  choices:
    type === 'true-false'
      ? [
          { id: 'true', text: 'True' },
          { id: 'false', text: 'False' },
        ]
      : [
          { id: 'a', text: 'First option' },
          { id: 'b', text: 'Second option' },
          { id: 'c', text: 'Third option' },
        ],
  correctChoiceIds: type === 'multiple' ? ['a', 'c'] : [type === 'true-false' ? 'true' : 'a'],
  points: 2,
  penalty: 0.5,
  explanation: '[FICTIONAL TEMPLATE] Explain the answer here.',
  topic: 'sample topic',
  difficulty: 'easy',
  tags: ['fictional', 'template'],
  archived: false,
}));
export const importTemplate = (format) => formatQuestions(fictionalQuestions, format);
