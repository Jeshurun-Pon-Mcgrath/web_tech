import mongoose from 'mongoose';
import { Exam, Attempt, Assignment, User } from '../models.js';
import { assert } from '../../utils/errors.js';
import { buildExamContent, matchPool } from './pools.service.js';
import { serializeExam } from './admin.serializers.js';
import { expireAttempt } from '../attempts/attempts.service.js';
export async function publicationChecklist(identifier) {
  const exam = await Exam.findById(identifier);
  assert(exam, 404, 'NOT_FOUND', 'Exam not found.');
  const checks = [
    { label: 'Unarchived draft', passed: exam.status === 'draft' && !exam.archivedAt },
    { label: 'Closing time is in the future', passed: exam.closesAt > new Date() },
    { label: 'Availability is longer than zero', passed: exam.closesAt > exam.opensAt },
  ];
  let content, error;
  try {
    content = await buildExamContent(exam);
  } catch (failure) {
    if (!failure.status) throw failure;
    error = failure.message;
  }
  checks.push({
    label: error || 'Eligible versions and unique selection are satisfiable',
    passed: Boolean(content),
  });
  const example = content
    ? exam.mode === 'pool'
      ? matchPool(content.rules).map(({ questionId, section }) => ({
          ...content.questions.find((question) => String(question.questionId) === questionId),
          points: content.rules[section].points,
          penalty: content.rules[section].penalty,
        }))
      : content.questions
    : [];
  return {
    ready: checks.every((check) => check.passed),
    checks,
    exam: serializeExam(exam),
    questionCount: example.length,
    totalMarks: example.reduce((sum, question) => sum + question.points, 0),
    sections: (content?.rules || []).map((rule) => ({
      id: rule.id,
      eligible: rule.candidateIds.length,
      required: rule.count,
      points: rule.points,
      penalty: rule.penalty,
    })),
    sample: example.map((question) => ({
      id: String(question.questionId),
      revision: question.revision,
      prompt: question.prompt,
      points: question.points,
      penalty: question.penalty,
    })),
    notice:
      'This is a feasible authoring preview, not a future student selection. Random variants may differ in difficulty; psychometric equivalence is not claimed.',
    releaseRule:
      'Scores and explanations remain hidden until closure and explicit administrator release.',
  };
}
export async function assignmentPreview(identifier, data) {
  const exam = await Exam.findById(identifier);
  assert(
    exam?.status === 'published' &&
      !exam.closedAt &&
      !exam.archivedAt &&
      exam.closesAt > new Date(),
    409,
    'EXAM_UNAVAILABLE',
    'Assignments require an open published exam.',
  );
  const filter = {
    role: 'student',
    active: true,
    status: { $nin: ['pending', 'deactivated'] },
    $or: [{ _id: { $in: data.studentIds } }, { cohort: { $in: data.cohortIds } }],
  };
  const students = await User.find(filter).select('_id').limit(1001);
  assert(
    students.length <= 1000,
    422,
    'ASSIGNMENT_LIMIT',
    'Assign at most 1000 eligible students per operation.',
  );
  const alreadyAssigned = await Assignment.countDocuments({
    exam: identifier,
    student: { $in: students.map((student) => student._id) },
  });
  return {
    eligible: students.length,
    alreadyAssigned,
    newAssignments: students.length - alreadyAssigned,
    deduplicated: true,
    notice:
      'Individual and cohort matches count once. Pending/deactivated accounts are excluded. Membership and permissions are checked again when assigning.',
  };
}
export async function finalizeExamBatch(identifier) {
  const attempts = await Attempt.find({ exam: identifier, status: 'active' })
    .select('_id')
    .limit(100);
  for (const attempt of attempts) await expireAttempt(attempt._id);
  return {
    processed: attempts.length,
    remaining: await Attempt.countDocuments({ exam: identifier, status: 'active' }),
  };
}
export async function closeExam(identifier, reason, administrator) {
  await mongoose.connection.transaction(async (session) => {
    const exam = await Exam.findById(identifier).session(session);
    assert(
      exam?.status === 'published',
      409,
      'EXAM_UNAVAILABLE',
      'Only published exams can be closed.',
    );
    if (exam.closedAt) return;
    exam.closedAt = new Date();
    exam.closedBy = administrator;
    exam.closeReason = reason;
    exam.controlVersion = (exam.controlVersion || 0) + 1;
    await exam.save({ session });
  });
  const finalization = await finalizeExamBatch(identifier);
  return {
    exam: serializeExam(await Exam.findById(identifier)),
    ...finalization,
    closing: finalization.remaining > 0,
  };
}
export async function archiveExam(identifier, reason, administrator) {
  const original = await Exam.findById(identifier);
  assert(original, 404, 'NOT_FOUND', 'Exam not found.');
  if (original.status === 'published') {
    assert(
      original.closedAt || original.closesAt <= new Date(),
      409,
      'CLOSE_REQUIRED',
      'Close this exam before archiving.',
    );
    await finalizeExamBatch(identifier);
  }
  return mongoose.connection.transaction(async (session) => {
    const exam = await Exam.findById(identifier).session(session);
    if (exam.archivedAt) return serializeExam(exam);
    assert(
      !(await Attempt.exists({ exam: identifier, status: 'active' }).session(session)),
      409,
      'FINALIZATION_PENDING',
      'Active attempts are still being finalized. Retry after the closing worker completes.',
    );
    exam.archivedAt = new Date();
    exam.archivedBy = administrator;
    exam.archiveReason = reason;
    exam.controlVersion = (exam.controlVersion || 0) + 1;
    await exam.save({ session });
    return serializeExam(exam);
  });
}
export async function duplicateExam(identifier, administrator) {
  const exam = await Exam.findById(identifier);
  assert(exam, 404, 'NOT_FOUND', 'Exam not found.');
  const copy = await Exam.create({
    title: `${exam.title.slice(0, 170)} (copy)`,
    subject: exam.subject,
    instructions: exam.instructions,
    durationMinutes: exam.durationMinutes,
    opensAt: exam.opensAt,
    closesAt: exam.closesAt,
    maxAttempts: exam.maxAttempts,
    attemptControls: exam.attemptControls,
    questionIds: exam.questionIds,
    mode: exam.mode || 'fixed',
    poolRules: exam.poolRules.map((rule) => ({
      id: rule.id,
      subject: rule.subject,
      topic: rule.topic,
      difficulty: rule.difficulty,
      tags: rule.tags,
      count: rule.count,
      points: rule.points,
      penalty: rule.penalty,
    })),
    timeZone: exam.timeZone || 'UTC',
    createdBy: administrator,
    duplicatedFrom: exam._id,
  });
  return serializeExam(copy);
}
