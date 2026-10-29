import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  User,
  Session,
  Cohort,
  Subject,
  Exam,
  Assignment,
  Attempt,
  IntegrityDecision,
} from '../models.js';
import { assert } from '../../utils/errors.js';
import { serializeUser } from '../auth/auth.serializers.js';
import { revokeLinks } from '../auth/recovery.service.js';
import { saveVersionedQuestion } from './questions.service.js';
import { buildExamContent } from './pools.service.js';
import { serializeExam } from './admin.serializers.js';
export async function requireRecord(Model, id, session) {
  const record = await Model.findById(id).session(session || null);
  assert(record, 404, 'NOT_FOUND', 'The requested record was not found.');
  return record;
}
export async function createStudent(data) {
  if (data.cohort) await requireRecord(Cohort, data.cohort);
  const { password, ...fields } = data;
  return serializeUser(
    await User.create({
      ...fields,
      role: 'student',
      passwordHash: await bcrypt.hash(password, 12),
    }),
  );
}
export async function updateStudent(id, data) {
  if (data.cohort) await requireRecord(Cohort, data.cohort);
  const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
  return mongoose.connection.transaction(async (session) => {
    const student = await User.findOne({ _id: id, role: 'student' })
      .select('+passwordHash')
      .session(session);
    assert(student, 404, 'NOT_FOUND', 'Student not found.');
    assert(
      !data.active || student.passwordHash || passwordHash,
      422,
      'PASSWORD_REQUIRED',
      'Set a password explicitly before reactivating an account without one.',
    );
    const { password: _password, ...fields } = data;
    assert(
      student.status !== 'pending' || !data.active,
      409,
      'INVITATION_REQUIRED',
      'Pending students must accept their invitation to activate their account.',
    );
    assert(
      student.status !== 'pending' || !passwordHash,
      409,
      'INVITATION_REQUIRED',
      'Use the invitation to set the initial password.',
    );
    const identityChanged = student.email !== data.email;
    const securityChanged = (student.active && !data.active) || passwordHash || identityChanged;
    Object.assign(student, fields);
    if (student.status !== 'pending') student.status = data.active ? 'active' : 'deactivated';
    if (passwordHash) student.passwordHash = passwordHash;
    if (securityChanged) {
      student.authVersion = (student.authVersion || 0) + 1;
      await revokeLinks(id, session);
      if (identityChanged && student.status === 'pending') student.invitationSentAt = undefined;
    }
    await student.save({ session });
    if (securityChanged) await Session.deleteMany({ user: id }).session(session);
    return serializeUser(student);
  });
}
export const saveQuestion = saveVersionedQuestion;
export async function saveExam(data, userId, id) {
  if (data.mode === 'pool') await requireRecord(Subject, data.subject);
  else await buildExamContent(data);
  if (!id) return serializeExam(await Exam.create({ ...data, createdBy: userId }));
  const updated = await Exam.findOneAndUpdate(
    { _id: id, status: 'draft', archivedAt: null },
    { $set: data },
    { new: true, runValidators: true },
  );
  assert(updated, 409, 'EXAM_LOCKED', 'Only draft exams can be edited.');
  return serializeExam(updated);
}
export async function publishExam(id) {
  return mongoose.connection.transaction(async (session) => {
    const exam = await requireRecord(Exam, id, session);
    assert(
      exam.status === 'draft' && !exam.archivedAt,
      409,
      'EXAM_LOCKED',
      'Only an unarchived draft can be published.',
    );
    assert(exam.closesAt > new Date(), 422, 'EXAM_CLOSED', 'An exam must close in the future.');
    const content = await buildExamContent(exam, session);
    exam.questions = content.questions;
    exam.frozenPoolRules = content.rules;
    exam.status = 'published';
    await exam.save({ session });
    return serializeExam(exam);
  });
}
export async function assignExam(id, data) {
  return mongoose.connection.transaction(async (session) => {
    const exam = await requireRecord(Exam, id, session);
    assert(
      exam.status === 'published' &&
        !exam.closedAt &&
        !exam.archivedAt &&
        exam.closesAt > new Date(),
      409,
      'EXAM_UNAVAILABLE',
      'Assignments require a published exam that has not closed.',
    );
    const students = await User.find({
      role: 'student',
      active: true,
      $or: [{ _id: { $in: data.studentIds } }, { cohort: { $in: data.cohortIds } }],
    })
      .limit(1001)
      .session(session);
    assert(students.length > 0, 422, 'NO_STUDENTS', 'No active students match the selection.');
    assert(
      students.length <= 1000,
      422,
      'ASSIGNMENT_LIMIT',
      'Assign at most 1000 eligible students in one operation.',
    );
    await Exam.updateOne({ _id: id }, { $inc: { controlVersion: 1 } }, { session });
    let added = 0;
    for (const student of students) {
      const r = await Assignment.updateOne(
        { exam: id, student: student._id },
        { $setOnInsert: { exam: id, student: student._id, attemptsUsed: 0 } },
        { upsert: true, session },
      );
      added += r.upsertedCount;
    }
    return { assigned: added, matched: students.length };
  });
}
export async function releaseResults(id) {
  const updated = await Exam.findOneAndUpdate(
    {
      _id: id,
      status: 'published',
      $or: [{ closesAt: { $lte: new Date() } }, { closedAt: { $lte: new Date() } }],
    },
    { $set: { resultsReleased: true } },
    { new: true },
  );
  assert(
    updated,
    409,
    'RELEASE_UNAVAILABLE',
    'Results can only be released after the exam closes.',
  );
  return serializeExam(updated);
}
export async function reviewAttempt(id, data, adminId) {
  return mongoose.connection.transaction(async (session) => {
    const previous = await Attempt.findById(id)
      .select('reviewStatus reviewVersion reviewNote reviewedBy reviewedAt')
      .session(session);
    assert(previous, 404, 'NOT_FOUND', 'Attempt not found.');
    assert(
      data.expectedReviewVersion === undefined ||
        data.expectedReviewVersion === (previous.reviewVersion || 0),
      409,
      'REVIEW_CONFLICT',
      'Another reviewer changed this decision. Reopen the review before saving.',
    );
    const decidedAt = new Date();
    if (previous.reviewedAt && !(await IntegrityDecision.exists({ attempt: id }).session(session)))
      await IntegrityDecision.create(
        [
          {
            attempt: id,
            reviewer: previous.reviewedBy,
            status: previous.reviewStatus,
            note: previous.reviewNote,
            decidedAt: previous.reviewedAt,
            legacy: true,
          },
        ],
        { session },
      );
    const a = await Attempt.findByIdAndUpdate(
      id,
      {
        $set: {
          reviewStatus: data.status,
          reviewNote: data.note,
          reviewedBy: adminId,
          reviewedAt: decidedAt,
        },
        $inc: { reviewVersion: 1 },
      },
      { new: true, runValidators: true, session },
    );
    await IntegrityDecision.create(
      [
        {
          attempt: id,
          reviewer: adminId,
          previousStatus: previous.reviewStatus,
          status: data.status,
          note: data.note,
          decidedAt,
        },
      ],
      { session },
    );
    return {
      id: String(a._id),
      status: a.reviewStatus,
      note: a.reviewNote,
      reviewedAt: a.reviewedAt,
      reviewVersion: a.reviewVersion,
      events: a.events.map((e) => ({ type: e.type, receivedAt: e.receivedAt })),
    };
  });
}
export async function integrityDetail(id, { historyPage = 1, pageSize = 20 } = {}) {
  const a = await requireRecord(Attempt, id);
  const total = await IntegrityDecision.countDocuments({ attempt: id });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  historyPage = Math.min(historyPage, totalPages);
  const decisions = await IntegrityDecision.find({ attempt: id })
    .sort({ decidedAt: -1, _id: -1 })
    .skip((historyPage - 1) * pageSize)
    .limit(pageSize)
    .populate('reviewer', 'name');
  return {
    id: String(a._id),
    status: a.reviewStatus,
    note: a.reviewNote,
    reviewVersion: a.reviewVersion || 0,
    startedAt: a.startedAt,
    deadline: a.deadline,
    submittedAt: a.submittedAt,
    legacyDecision:
      total === 0 && a.reviewedAt
        ? {
            status: a.reviewStatus,
            note: a.reviewNote,
            decidedAt: a.reviewedAt,
            reviewer: a.reviewedBy ? String(a.reviewedBy) : null,
          }
        : null,
    history: {
      items: decisions.map((decision) => ({
        id: String(decision._id),
        previousStatus: decision.previousStatus,
        status: decision.status,
        note: decision.note,
        legacy: decision.legacy,
        reviewer: decision.reviewer?.name || 'Unavailable reviewer',
        reviewerId: decision.reviewer ? String(decision.reviewer._id) : null,
        decidedAt: decision.decidedAt,
      })),
      pagination: {
        page: historyPage,
        pageSize,
        total,
        totalPages,
        hasPrevious: historyPage > 1,
        hasNext: historyPage < totalPages,
      },
    },
    events: a.events
      .map((e) => ({ type: e.type, receivedAt: e.receivedAt }))
      .sort((left, right) => left.receivedAt - right.receivedAt),
  };
}
