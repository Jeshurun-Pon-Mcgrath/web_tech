import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { assert } from '../../utils/errors.js';
import { User, Cohort, Subject, Question, Exam } from '../models.js';
import { questionInput, examInput } from '../admin/admin.validators.js';
import { publishExam, assignExam } from '../admin/admin.service.js';

export async function seedDevelopmentFixtures(passwords) {
  assert(
    env.NODE_ENV !== 'production',
    403,
    'DEVELOPMENT_ONLY',
    'Development seeding is disabled in production.',
  );
  assert(
    ['a', 'b'].every(
      (key) =>
        typeof passwords[key] === 'string' &&
        passwords[key].length >= 12 &&
        passwords[key].length <= 128,
    ),
    422,
    'SEED_CONFIG',
    'Two private development student passwords are required.',
  );
  const admin = await User.findOne({ role: 'admin', active: true });
  assert(
    admin,
    409,
    'ADMIN_REQUIRED',
    'Create the initial administrator before running the development seed.',
  );
  let created = 0;
  const ensure = async (Model, key, data) => {
    const fixtureKey = `examledger.phase1.${key}`;
    const existing = await Model.findOne({ fixtureKey });
    if (existing) return existing;
    const record = await Model.create({ ...data, fixtureKey });
    created++;
    return record;
  };
  const cohorts = [],
    subjects = [],
    students = [],
    questions = [];
  for (const suffix of ['a', 'b']) {
    const letter = suffix.toUpperCase();
    const cohort = await ensure(Cohort, `cohort-${suffix}`, {
      name: `[DEV FICTIONAL] Cohort ${letter}`,
      description: 'Fictional Phase 1 development fixture. Not a real class.',
    });
    cohorts.push(cohort);
    const subject = await ensure(Subject, `subject-${suffix}`, {
      name: `[DEV FICTIONAL] ${suffix === 'a' ? 'Web Foundations' : 'Data Foundations'}`,
      code: `DEV-P1-${letter}`,
      description: 'Fictional development assessment subject.',
    });
    subjects.push(subject);
    const student = await ensure(User, `student-${suffix}`, {
      name: `[DEV FICTIONAL] Student ${letter}`,
      email: `phase1-student-${suffix}@examledger.invalid`,
      passwordHash: await bcrypt.hash(passwords[suffix], 12),
      role: 'student',
      active: true,
      cohort: cohort._id,
    });
    students.push(student);
    const inputs = [
      {
        type: 'single',
        prompt: '[DEV FICTIONAL] Which protocol encrypts web transport?',
        choices: [
          { id: 'a', text: 'HTTPS' },
          { id: 'b', text: 'HTTP' },
          { id: 'c', text: 'FTP' },
          { id: 'd', text: 'Telnet' },
        ],
        correctChoiceIds: ['a'],
        points: 3,
        penalty: 1,
        explanation: 'HTTPS secures transport with TLS.',
      },
      {
        type: 'multiple',
        prompt: '[DEV FICTIONAL] Select the semantic HTML elements.',
        choices: [
          { id: 'article', text: 'article' },
          { id: 'section', text: 'section' },
          { id: 'div', text: 'div' },
          { id: 'span', text: 'span' },
        ],
        correctChoiceIds: ['article', 'section'],
        points: 4,
        penalty: 1,
        explanation:
          'article and section carry semantic meaning; div and span are generic containers.',
      },
      {
        type: 'true-false',
        prompt: '[DEV FICTIONAL] HTTP is stateless.',
        choices: [
          { id: 'true', text: 'True' },
          { id: 'false', text: 'False' },
        ],
        correctChoiceIds: ['true'],
        points: 2,
        penalty: 0.5,
        explanation: 'Applications add state using mechanisms such as server sessions.',
      },
      {
        type: 'single',
        prompt:
          '[DEV FICTIONAL] Read the requirements carefully. '.repeat(16) +
          'Which layer enforces the examination deadline?',
        choices: [
          { id: 'server', text: 'The application server' },
          { id: 'browser', text: 'Only the browser timer' },
        ],
        correctChoiceIds: ['server'],
        points: 1,
        penalty: 0,
        explanation: 'The server independently enforces the persisted deadline.',
      },
    ];
    const bank = [];
    for (let i = 0; i < inputs.length; i++)
      bank.push(
        await ensure(
          Question,
          `question-${suffix}-${i}`,
          questionInput.parse({ subject: String(subject._id), ...inputs[i] }),
        ),
      );
    questions.push(bank);
  }
  const examData = (index, title) =>
    examInput.parse({
      title,
      subject: String(subjects[index]._id),
      instructions:
        '[DEV FICTIONAL] Development fixture. Multiple-answer questions use exact-set grading. Incorrect non-empty answers incur the configured penalty; unanswered questions score zero.',
      durationMinutes: 20,
      opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      maxAttempts: 2,
      questionIds: questions[index].map((q) => String(q._id)),
    });
  const draft = await ensure(Exam, 'exam-draft', {
    ...examData(1, '[DEV FICTIONAL] Draft Assessment'),
    createdBy: admin._id,
  });
  let published = await ensure(Exam, 'exam-published', {
    ...examData(0, '[DEV FICTIONAL] Published Assessment'),
    createdBy: admin._id,
  });
  if (published.status === 'draft') {
    await publishExam(String(published._id));
    published = await Exam.findById(published._id);
  }
  // Only A is assigned. B is intentionally ineligible, for negative-access checks.
  // Reruns keep an existing assignment and never reset readiness or attempt counters.
  const { Assignment } = await import('../models.js');
  if (!(await Assignment.exists({ exam: published._id, student: students[0]._id })))
    await assignExam(String(published._id), {
      studentIds: [String(students[0]._id)],
      cohortIds: [],
    });
  return {
    created,
    students: students.map((s) => String(s._id)),
    cohorts: cohorts.map((c) => String(c._id)),
    subjects: subjects.map((s) => String(s._id)),
    draftExam: String(draft._id),
    publishedExam: String(published._id),
    questions: questions.flat().map((q) => String(q._id)),
  };
}
