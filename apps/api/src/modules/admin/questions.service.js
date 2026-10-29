import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { Question, QuestionVersion, Subject, Exam } from '../models.js';
import { assert } from '../../utils/errors.js';
import { correctIds, questionType } from '../attempts/grading.js';
import { serializeQuestion } from './admin.serializers.js';
export function questionData(question) {
  return {
    subject: String(question.subject),
    type: questionType(question),
    prompt: question.prompt,
    choices: question.choices.map(({ id, text }) => ({ id, text })),
    correctChoiceIds: correctIds(question),
    points: question.points,
    penalty: question.penalty || 0,
    explanation: question.explanation || '',
    archived: Boolean(question.archived),
    topic: question.topic || '',
    difficulty: question.difficulty || 'unspecified',
    tags: [...(question.tags || [])],
  };
}
export function questionSnapshot(question) {
  return {
    ...questionData(question),
    correctChoiceId: questionType(question) === 'multiple' ? undefined : correctIds(question)[0],
    questionId: question._id,
    revision: question.revision || 1,
  };
}
export function contentFingerprint(question) {
  const normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(
      JSON.stringify([
        String(question.subject),
        questionType(question),
        normalize(question.prompt),
        question.choices.map((choice) => normalize(choice.text)).sort(),
      ]),
    )
    .digest('hex');
}
export async function writeQuestion(data, identifier, administrator, session, reason = 'edit') {
  data = { ...data, correctChoiceIds: correctIds(data) };
  const subject = await Subject.findOneAndUpdate(
    { _id: data.subject },
    { $inc: { __v: 1 } },
    { session, new: true },
  );
  assert(subject, 422, 'INVALID_SUBJECT', 'Choose an existing subject.');
  let question;
  if (identifier) {
    assert(
      Number.isInteger(data.expectedVersion),
      428,
      'VERSION_REQUIRED',
      'Reload the question and provide its version before editing.',
    );
    question = await Question.findById(identifier).session(session);
    assert(question, 404, 'NOT_FOUND', 'Question not found.');
    assert(
      (question.revision || 1) === data.expectedVersion,
      409,
      'QUESTION_CONFLICT',
      'This question changed in another session. Reload and compare versions before editing.',
    );
    const baseline = await QuestionVersion.exists({
      question: identifier,
      revision: question.revision || 1,
    }).session(session);
    if (!baseline)
      await QuestionVersion.create(
        [
          {
            question: identifier,
            revision: question.revision || 1,
            snapshot: questionSnapshot(question),
            reason: 'legacy baseline',
          },
        ],
        { session },
      );
    if (String(question.subject) !== data.subject) {
      await Subject.updateOne({ _id: question.subject }, { $inc: { __v: 1 } }, { session });
    }
    const { expectedVersion: _expected, ...fields } = data;
    Object.assign(question, fields);
    question.revision = data.expectedVersion + 1;
  } else {
    const { expectedVersion: _expected, ...fields } = data;
    question = new Question({ ...fields, revision: 1 });
  }
  question.correctChoiceId = question.type === 'multiple' ? undefined : correctIds(question)[0];
  question.contentHash = contentFingerprint(question);
  await question.save({ session });
  await QuestionVersion.create(
    [
      {
        question: question._id,
        revision: question.revision,
        snapshot: questionSnapshot(question),
        editedBy: administrator,
        reason: identifier ? reason : 'create',
      },
    ],
    { session },
  );
  return serializeQuestion(question);
}
export async function saveVersionedQuestion(data, identifier, administrator) {
  return mongoose.connection.transaction((session) =>
    writeQuestion(data, identifier, administrator, session),
  );
}
export async function bulkQuestions({ items, operation, tags, archived }, administrator) {
  return mongoose.connection.transaction(async (session) => {
    for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
      const question = await Question.findById(item.id).session(session);
      assert(
        question,
        404,
        'NOT_FOUND',
        'A selected question no longer exists. Nothing was changed.',
      );
      const data = { ...questionData(question), expectedVersion: item.expectedVersion };
      if (operation === 'tag') data.tags = [...new Set([...data.tags, ...tags])].sort();
      else data.archived = archived;
      assert(
        data.tags.length <= 12,
        422,
        'TAG_LIMIT',
        'A question would exceed twelve tags. Nothing was changed.',
      );
      await writeQuestion(data, item.id, administrator, session, `bulk ${operation}`);
    }
    return { updated: items.length };
  });
}
export async function questionHistory(identifier, query) {
  const question = await Question.findById(identifier);
  assert(question, 404, 'NOT_FOUND', 'Question not found.');
  const total = await QuestionVersion.countDocuments({ question: identifier });
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const versions = await QuestionVersion.find({ question: identifier })
    .sort({ revision: -1 })
    .skip((page - 1) * query.pageSize)
    .limit(query.pageSize)
    .populate('editedBy', 'name');
  return {
    items: versions.map((version) => ({
      revision: version.revision,
      reason: version.reason,
      createdAt: version.createdAt,
      administrator: version.editedBy?.name || 'Legacy baseline',
      snapshot: {
        ...serializeQuestion({ ...version.snapshot.toObject(), _id: identifier }),
        revision: version.revision,
      },
    })),
    currentVersion: question.revision || 1,
    legacyBaseline: total === 0 ? { ...serializeQuestion(question), revision: 1 } : null,
    publishedExamCount: await Exam.countDocuments({
      status: 'published',
      'questions.questionId': identifier,
    }),
    pagination: {
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}
export async function compareQuestions(identifier, { from, to }) {
  const question = await Question.findById(identifier);
  assert(question, 404, 'NOT_FOUND', 'Question not found.');
  const versions = await QuestionVersion.find({
    question: identifier,
    revision: { $in: [from, to] },
  });
  const lookup = (revision) =>
    versions.find((version) => version.revision === revision)?.snapshot ||
    ((question.revision || 1) === revision ? question : null);
  const previous = lookup(from),
    next = lookup(to);
  assert(previous && next, 404, 'VERSION_NOT_FOUND', 'A selected question version is unavailable.');
  const a = questionData(previous),
    b = questionData(next);
  return {
    from,
    to,
    changes: Object.keys(a)
      .filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]))
      .map((field) => ({ field, before: a[field], after: b[field] })),
  };
}
