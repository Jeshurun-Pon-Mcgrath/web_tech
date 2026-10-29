import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { assert } from '../../utils/errors.js';
import { User, Cohort, Subject, Question, Exam, Assignment, Attempt } from '../models.js';
import { questionInput, examInput } from '../admin/admin.validators.js';
import { writeQuestion } from '../admin/questions.service.js';
import { publishExam, assignExam, releaseResults, reviewAttempt } from '../admin/admin.service.js';
import { closeExam } from '../admin/exam-lifecycle.service.js';
import {
  readiness,
  startAttempt,
  saveAnswers,
  submitAttempt,
  integrityEvent,
} from '../attempts/attempts.service.js';
import { cseCatalog, cseStudentNames } from './cse-catalog.js';

export const csePrefix = 'examledger.cse.v1.';
export const cseEmail = (index) =>
  `cse-demo-${String(index + 1).padStart(2, '0')}@examledger.invalid`;

export async function seedCseFixtures(passwords) {
  assert(
    env.NODE_ENV !== 'production',
    403,
    'DEVELOPMENT_ONLY',
    'CSE demonstration seeding is disabled in production.',
  );
  assert(
    Array.isArray(passwords) &&
      passwords.length === 20 &&
      passwords.every(
        (password) =>
          typeof password === 'string' && password.length >= 12 && password.length <= 128,
      ),
    422,
    'SEED_CONFIG',
    'Twenty private demonstration passwords are required.',
  );
  const admin = await User.findOne({ role: 'admin', active: true, status: { $ne: 'deactivated' } });
  assert(admin, 409, 'ADMIN_REQUIRED', 'An active administrator is required.');
  const created = { students: 0, cohorts: 0, subjects: 0, questions: 0, exams: 0, attempts: 0 };
  async function ensure(Model, key, data, category) {
    const fixtureKey = csePrefix + key;
    const previous = await Model.findOne({ fixtureKey });
    if (previous) return { record: previous, fresh: false };
    const record = await Model.create({ ...data, fixtureKey });
    created[category]++;
    return { record, fresh: true };
  }
  const students = [],
    subjects = [],
    banks = [],
    exams = [];
  const freshExams = new Set();
  const now = Date.now();
  for (let index = 0; index < 20; index++) {
    const cohort = (
      await ensure(
        Cohort,
        `cohort-${index}`,
        {
          name: `[CSE DEMO] Year ${Math.floor(index / 5) + 1} - Section ${'ABCDE'[index % 5]}`,
          description: 'Fictional CSE demonstration cohort; not a real class.',
        },
        'cohorts',
      )
    ).record;
    const studentKey = csePrefix + `student-${index}`;
    let student = await User.findOne({ fixtureKey: studentKey });
    if (!student)
      student = (
        await ensure(
          User,
          `student-${index}`,
          {
            name: `[CSE DEMO] ${cseStudentNames[index]}`,
            email: cseEmail(index),
            passwordHash: await bcrypt.hash(passwords[index], 12),
            role: 'student',
            active: true,
            status: 'active',
            cohort: cohort._id,
          },
          'students',
        )
      ).record;
    students.push(student);
    const catalog = cseCatalog[index];
    const subject = (
      await ensure(
        Subject,
        `subject-${index}`,
        {
          name: `[CSE DEMO] ${catalog.name}`,
          code: `DEMO-CSE-${catalog.code}`,
          description: 'Fictional CSE question-bank and internal assessment demonstration.',
        },
        'subjects',
      )
    ).record;
    subjects.push(subject);
    const questions = [];
    for (const [questionIndex, entry] of catalog.questions.entries()) {
      const fixtureKey = csePrefix + `question-${index}-${questionIndex}`;
      let question = await Question.findOne({ fixtureKey });
      if (!question) {
        const ids = entry.type === 'true-false' ? ['true', 'false'] : ['a', 'b', 'c', 'd'];
        const data = questionInput.parse({
          subject: String(subject._id),
          type: entry.type,
          prompt: `[CSE DEMO] ${entry.prompt}`,
          choices: entry.options.map((text, option) => ({ id: ids[option], text })),
          correctChoiceIds: entry.correct.map((option) => ids[option]),
          explanation: entry.explanation,
          points: entry.type === 'multiple' ? 3 : 2,
          penalty: 0.5,
          topic: catalog.topic,
          difficulty: questionIndex === 1 ? 'medium' : 'easy',
          tags: ['cse-demo', 'internal-assessment'],
        });
        await mongoose.connection.transaction((session) =>
          writeQuestion({ ...data, fixtureKey }, null, admin._id, session),
        );
        question = await Question.findOne({ fixtureKey });
        created.questions++;
      }
      questions.push(question);
    }
    banks.push(questions);
    const data = examInput.parse({
      title: `[CSE DEMO] ${catalog.name} - ${index < 16 ? 'Completed practice' : index < 18 ? 'Available practice' : index === 18 ? 'Upcoming practice' : 'Draft practice'}`,
      subject: String(subject._id),
      questionIds: questions.map((question) => String(question._id)),
      instructions:
        'Fictional CSE demonstration. Three questions: single choice, exact-set multiple choice and true/false. A wrong non-empty response incurs 0.5 points; a blank earns zero. Browser signals are incomplete context, not proof of misconduct.',
      durationMinutes: 20,
      maxAttempts: 1,
      opensAt: new Date(now + (index === 18 ? 86400000 : -60000)).toISOString(),
      closesAt: new Date(now + 30 * 86400000).toISOString(),
      timeZone: 'Asia/Kolkata',
      attemptControls: {
        requireFullscreen: index >= 16,
        disableCopyPaste: index >= 16,
        disableContextMenu: index >= 16,
      },
    });
    const { record: exam, fresh } = await ensure(
      Exam,
      `exam-${index}`,
      { ...data, createdBy: admin._id },
      'exams',
    );
    if (fresh) {
      freshExams.add(String(exam._id));
      if (index !== 19) await publishExam(String(exam._id));
    }
    exams.push(exam);
  }
  async function ensureAssignment(exam, student) {
    if (!(await Assignment.exists({ exam: exam._id, student: student._id })))
      await assignExam(String(exam._id), { studentIds: [String(student._id)], cohortIds: [] });
  }
  // Only new exam/student pairs generate activity. Never resume, replace or resubmit existing work.
  for (let index = 0; index < 20; index++) {
    const examIndex = index % 16;
    const exam = exams[examIndex],
      student = students[index];
    if (!freshExams.has(String(exam._id))) continue;
    await ensureAssignment(exam, student);
    if (await Attempt.exists({ exam: exam._id, student: student._id })) continue;
    await readiness(String(exam._id), String(student._id));
    const attempt = await startAttempt(String(exam._id), String(student._id));
    const answers = banks[examIndex].flatMap((question, questionIndex) => {
      const mode = (index + questionIndex) % 4;
      if (mode === 3) return [];
      const correct = question.correctChoiceIds;
      const choiceIds =
        mode === 2
          ? [question.choices.find((choice) => !correct.includes(choice.id))?.id || correct[0]]
          : [...correct];
      return [{ questionId: String(question._id), choiceIds }];
    });
    await saveAnswers(attempt.id, String(student._id), { version: attempt.version, answers });
    if (index % 3 !== 0)
      await integrityEvent(
        attempt.id,
        String(student._id),
        index % 2 ? 'offline' : 'visibility-hidden',
      );
    await submitAttempt(attempt.id, String(student._id));
    await reviewAttempt(
      attempt.id,
      {
        status: ['cleared', 'flagged', 'pending'][index % 3],
        expectedReviewVersion: 0,
        note: 'CSE DEMO: fictional review decision and simulated activity. Browser signals do not establish misconduct; this review does not change the grade.',
      },
      admin._id,
    );
    created.attempts++;
  }
  for (const exam of exams.slice(0, 16)) {
    if (!freshExams.has(String(exam._id))) continue;
    await closeExam(
      String(exam._id),
      'CSE DEMO: close fictional practice after server-graded submissions.',
      admin._id,
    );
    await releaseResults(String(exam._id));
  }
  // Two available practices and one upcoming practice, without consuming their allowances.
  for (const [examIndex, studentIndexes] of [
    [16, [0]],
    [17, [1]],
    [18, [2]],
  ]) {
    if (freshExams.has(String(exams[examIndex]._id)))
      for (const studentIndex of studentIndexes)
        await ensureAssignment(exams[examIndex], students[studentIndex]);
  }
  return {
    created,
    totals: {
      students: students.length,
      cohorts: 20,
      subjects: subjects.length,
      questions: banks.flat().length,
      exams: exams.length,
      assignments: await Assignment.countDocuments({
        exam: { $in: exams.map((exam) => exam._id) },
      }),
      submittedAttempts: await Attempt.countDocuments({
        exam: { $in: exams.map((exam) => exam._id) },
        status: 'submitted',
      }),
    },
  };
}
