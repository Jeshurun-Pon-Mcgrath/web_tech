import mongoose from 'mongoose';
import { Assignment, Exam, Attempt } from '../models.js';
import { assert } from '../../utils/errors.js';
import { selectionIds } from '@examledger/contracts';
import { grade, questionType } from './grading.js';
import { selectAttemptQuestions } from '../admin/pools.service.js';
export const questionsForAttempt = (attempt, exam) => attempt.selectedQuestions || exam.questions;
const endedByAdmin = (attempt, exam) =>
  exam.closedAt && exam.closedAt <= new Date() && exam.closedAt < attempt.deadline;
const fence = (exam, session) =>
  Exam.updateOne({ _id: exam._id }, { $inc: { controlVersion: 1 } }, { session });
export { grade } from './grading.js';
import {
  serializeActiveAttempt,
  serializeReceipt,
  serializeResult,
} from './attempts.serializers.js';
async function ownedAssignment(examId, studentId, session) {
  const assignment = await Assignment.findOne({ exam: examId, student: studentId }).session(
    session || null,
  );
  assert(assignment, 404, 'NOT_FOUND', 'This exam is not assigned to you.');
  const exam = await Exam.findById(examId).session(session || null);
  assert(exam?.status === 'published', 404, 'NOT_FOUND', 'Exam not available.');
  return { assignment, exam };
}
async function ownedAttempt(id, studentId, session) {
  const attempt = await Attempt.findOne({ _id: id, student: studentId }).session(session || null);
  assert(attempt, 404, 'NOT_FOUND', 'Attempt not found.');
  const exam = await Exam.findById(attempt.exam).session(session || null);
  assert(exam, 404, 'NOT_FOUND', 'Exam not found.');
  return { attempt, exam };
}
function finish(attempt, exam, now, reason) {
  Object.assign(attempt, grade(questionsForAttempt(attempt, exam), attempt.answers), {
    status: 'submitted',
    submittedAt: now,
    submissionReason: reason,
  });
  attempt.version += 1;
}
export async function expireAttempt(id) {
  return mongoose.connection.transaction(async (session) => {
    const a = await Attempt.findOne({
      _id: id,
      status: 'active',
    }).session(session);
    if (!a) return;
    const exam = await Exam.findById(a.exam).session(session);
    if (a.deadline > new Date() && !endedByAdmin(a, exam)) return;
    await fence(exam, session);
    finish(a, exam, new Date(), endedByAdmin(a, exam) ? 'admin-close' : 'deadline');
    await a.save({ session });
  });
}
export async function readiness(examId, studentId) {
  const { assignment, exam } = await ownedAssignment(examId, studentId);
  const now = new Date();
  assert(
    !exam.closedAt && !exam.archivedAt && now >= exam.opensAt && now < exam.closesAt,
    409,
    'EXAM_WINDOW',
    'Readiness is available while the exam is open.',
  );
  assignment.readinessAt = now;
  await assignment.save();
  return { ready: true, validUntil: new Date(now.getTime() + 30 * 60000), serverNow: now };
}
export async function startAttempt(examId, studentId) {
  return mongoose.connection.transaction(async (session) => {
    const { assignment, exam } = await ownedAssignment(examId, studentId, session);
    await fence(exam, session);
    // This write serializes concurrent starts on the assignment document.
    await Assignment.updateOne({ _id: assignment._id }, { $inc: { __v: 1 } }, { session });
    const now = new Date();
    const existing = await Attempt.findOne({
      assignment: assignment._id,
      status: 'active',
    }).session(session);
    if (existing) {
      if (existing.deadline <= now || endedByAdmin(existing, exam)) {
        finish(existing, exam, now, endedByAdmin(existing, exam) ? 'admin-close' : 'deadline');
        await existing.save({ session });
        return serializeReceipt(existing);
      }
      return serializeActiveAttempt(existing, exam);
    }
    assert(
      !exam.closedAt && !exam.archivedAt && now >= exam.opensAt && now < exam.closesAt,
      409,
      'EXAM_WINDOW',
      'This exam is not currently open.',
    );
    assert(
      assignment.readinessAt && now - assignment.readinessAt < 30 * 60000,
      409,
      'READINESS_REQUIRED',
      'Complete the readiness checks before starting.',
    );
    assert(
      assignment.attemptsUsed < exam.maxAttempts,
      409,
      'ATTEMPT_LIMIT',
      'You have used all permitted attempts.',
    );
    assignment.attemptsUsed += 1;
    await assignment.save({ session });
    const [attempt] = await Attempt.create(
      [
        {
          exam: exam._id,
          student: studentId,
          assignment: assignment._id,
          number: assignment.attemptsUsed,
          startedAt: now,
          deadline: new Date(
            Math.min(now.getTime() + exam.durationMinutes * 60000, exam.closesAt.getTime()),
          ),
          answers: [],
          selectedQuestions: selectAttemptQuestions(exam),
        },
      ],
      { session },
    );
    return serializeActiveAttempt(attempt, exam);
  });
}
export async function getAttempt(id, studentId) {
  // Check ownership before any expiry side effect.
  await ownedAttempt(id, studentId);
  await expireAttempt(id);
  const { attempt, exam } = await ownedAttempt(id, studentId);
  return attempt.status === 'active'
    ? serializeActiveAttempt(attempt, exam)
    : serializeReceipt(attempt);
}
export async function saveAnswers(id, studentId, data) {
  return mongoose.connection.transaction(async (session) => {
    const { attempt, exam } = await ownedAttempt(id, studentId, session);
    await fence(exam, session);
    const now = new Date();
    if (attempt.status !== 'active') return serializeReceipt(attempt);
    if (attempt.deadline <= now || endedByAdmin(attempt, exam)) {
      finish(attempt, exam, now, endedByAdmin(attempt, exam) ? 'admin-close' : 'deadline');
      await attempt.save({ session });
      return serializeReceipt(attempt);
    }
    assert(
      attempt.version === data.version,
      409,
      'VERSION_CONFLICT',
      'This attempt changed in another tab. Reload its saved answers.',
    );
    const valid = data.answers.every((a) => {
      const q = questionsForAttempt(attempt, exam).find(
        (q) => String(q.questionId) === a.questionId,
      );
      const ids = selectionIds(a);
      return (
        q &&
        ids.length > 0 &&
        new Set(ids).size === ids.length &&
        (questionType(q) === 'multiple' || ids.length === 1) &&
        ids.every((id) => q.choices.some((c) => c.id === id))
      );
    });
    assert(
      valid && new Set(data.answers.map((a) => a.questionId)).size === data.answers.length,
      422,
      'INVALID_ANSWERS',
      'Answers must reference unique questions and valid choices.',
    );
    attempt.answers = data.answers;
    attempt.version += 1;
    await attempt.save({ session });
    return {
      id: String(attempt._id),
      status: attempt.status,
      version: attempt.version,
      serverNow: new Date(),
      savedAt: new Date(),
    };
  });
}
export async function submitAttempt(id, studentId) {
  return mongoose.connection.transaction(async (session) => {
    const { attempt, exam } = await ownedAttempt(id, studentId, session);
    await fence(exam, session);
    if (attempt.status === 'submitted') return serializeReceipt(attempt);
    const now = new Date();
    finish(
      attempt,
      exam,
      now,
      endedByAdmin(attempt, exam)
        ? 'admin-close'
        : attempt.deadline <= now
          ? 'deadline'
          : 'student',
    );
    await attempt.save({ session });
    return serializeReceipt(attempt);
  });
}
export async function result(id, studentId) {
  await ownedAttempt(id, studentId);
  await expireAttempt(id);
  const { attempt, exam } = await ownedAttempt(id, studentId);
  assert(
    exam.resultsReleased &&
      (exam.closesAt <= new Date() || (exam.closedAt && exam.closedAt <= new Date())) &&
      attempt.status === 'submitted',
    403,
    'RESULT_UNRELEASED',
    'Your result has not been released yet.',
  );
  return serializeResult(attempt, exam);
}
export async function integrityEvent(id, studentId, type) {
  const { attempt } = await ownedAttempt(id, studentId);
  if (attempt.status === 'active')
    await Attempt.updateOne(
      {
        _id: id,
        student: studentId,
        status: 'active',
        deadline: { $gt: new Date() },
        'events.199': { $exists: false },
      },
      { $push: { events: { type, receivedAt: new Date() } } },
    );
  return { received: true };
}
