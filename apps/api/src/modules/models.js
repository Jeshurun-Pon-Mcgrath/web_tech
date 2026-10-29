import mongoose from 'mongoose';
const { Schema } = mongoose;
const ref = (model, required = true) => ({ type: Schema.Types.ObjectId, ref: model, required });
const options = { timestamps: true, strict: 'throw' };
const fixtureKey = { type: String, unique: true, sparse: true };
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    fixtureKey,
    email: { type: String, required: true, unique: true },
    passwordHash: {
      type: String,
      required: function () {
        return !['pending', 'deactivated'].includes(this.status);
      },
      select: false,
    },
    role: { type: String, enum: ['admin', 'student'], required: true },
    cohort: ref('Cohort', false),
    active: { type: Boolean, default: true },
    status: { type: String, enum: ['pending', 'active', 'deactivated'] },
    authVersion: { type: Number, default: 0 },
    invitationSentAt: Date,
  },
  options,
);
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    user: ref('User'),
    authVersion: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  options,
);
const cohortSchema = new Schema(
  {
    fixtureKey,
    name: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
  },
  options,
);
const subjectSchema = new Schema(
  {
    fixtureKey,
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
  },
  options,
);
const choiceSchema = new Schema({ id: String, text: String }, { _id: false });
const questionFields = {
  fixtureKey: { type: String },
  subject: ref('Subject'),
  prompt: { type: String, required: true },
  choices: { type: [choiceSchema], required: true },
  type: { type: String, enum: ['single', 'multiple', 'true-false'], default: 'single' },
  correctChoiceId: String,
  correctChoiceIds: { type: [String], default: undefined },
  penalty: { type: Number, min: 0, default: 0 },
  explanation: { type: String, default: '' },
  points: { type: Number, required: true, min: 1 },
  archived: { type: Boolean, default: false },
  revision: { type: Number, default: 1 },
  topic: { type: String, default: '' },
  difficulty: {
    type: String,
    enum: ['unspecified', 'easy', 'medium', 'hard'],
    default: 'unspecified',
  },
  tags: { type: [String], default: [] },
  contentHash: String,
};
const questionSchema = new Schema(questionFields, options);
questionSchema.index({ fixtureKey: 1 }, { unique: true, sparse: true });
const snapshotSchema = new Schema(
  { questionId: ref('Question'), ...questionFields },
  { _id: false, versionKey: false, strict: 'throw' },
);
const poolRuleSchema = new Schema(
  {
    id: { type: String, required: true },
    subject: ref('Subject'),
    topic: String,
    difficulty: String,
    tags: [String],
    count: Number,
    points: Number,
    penalty: Number,
    candidateIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
  },
  { _id: false, versionKey: false, strict: 'throw' },
);
const examSchema = new Schema(
  {
    fixtureKey,
    title: { type: String, required: true },
    subject: ref('Subject'),
    instructions: { type: String, default: '' },
    durationMinutes: { type: Number, required: true },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    maxAttempts: { type: Number, required: true },
    attemptControls: {
      requireFullscreen: { type: Boolean, default: false },
      disableCopyPaste: { type: Boolean, default: false },
      disableContextMenu: { type: Boolean, default: false },
    },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    questions: [snapshotSchema],
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    resultsReleased: { type: Boolean, default: false },
    createdBy: ref('User'),
    mode: { type: String, enum: ['fixed', 'pool'], default: 'fixed' },
    poolRules: [poolRuleSchema],
    frozenPoolRules: [poolRuleSchema],
    timeZone: { type: String, default: 'UTC' },
    controlVersion: { type: Number, default: 0 },
    closedAt: Date,
    closedBy: ref('User', false),
    closeReason: String,
    archivedAt: Date,
    archivedBy: ref('User', false),
    archiveReason: String,
    duplicatedFrom: ref('Exam', false),
  },
  options,
);
const assignmentSchema = new Schema(
  {
    exam: ref('Exam'),
    student: ref('User'),
    attemptsUsed: { type: Number, default: 0 },
    readinessAt: Date,
  },
  options,
);
assignmentSchema.index({ exam: 1, student: 1 }, { unique: true });
const answerSchema = new Schema(
  {
    questionId: { type: String, required: true },
    choiceId: String,
    choiceIds: { type: [String], default: undefined },
  },
  { _id: false },
);
const eventSchema = new Schema({ type: String, receivedAt: Date }, { _id: false });
const attemptSchema = new Schema(
  {
    exam: ref('Exam'),
    student: ref('User'),
    assignment: ref('Assignment'),
    number: Number,
    status: { type: String, enum: ['active', 'submitted'], default: 'active' },
    startedAt: Date,
    deadline: Date,
    submittedAt: Date,
    submissionReason: { type: String, enum: ['student', 'deadline', 'admin-close'] },
    selectedQuestions: { type: [snapshotSchema], default: undefined },
    answers: [answerSchema],
    version: { type: Number, default: 0 },
    score: Number,
    maxScore: Number,
    events: [eventSchema],
    reviewStatus: { type: String, enum: ['pending', 'cleared', 'flagged'], default: 'pending' },
    reviewNote: { type: String, default: '' },
    reviewedBy: ref('User', false),
    reviewedAt: Date,
    reviewVersion: { type: Number, default: 0 },
  },
  options,
);
attemptSchema.index({ assignment: 1, number: 1 }, { unique: true });
attemptSchema.index(
  { assignment: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
attemptSchema.index({ status: 1, deadline: 1 });
userSchema.index({ role: 1, active: 1, cohort: 1, name: 1, _id: 1 });
userSchema.index({ role: 1, createdAt: -1, _id: -1 });
questionSchema.index({ subject: 1, archived: 1, type: 1, createdAt: -1, _id: -1 });
questionSchema.index({ createdAt: -1, _id: -1 });
questionSchema.index({ subject: 1, contentHash: 1 });
questionSchema.index({ subject: 1, archived: 1, topic: 1, difficulty: 1, tags: 1 });
examSchema.index({ status: 1, subject: 1, createdAt: -1, _id: -1 });
examSchema.index({ createdAt: -1, _id: -1 });
examSchema.index({ status: 1, 'questions.questionId': 1 });
examSchema.index({ closedAt: 1, status: 1 });
attemptSchema.index({ status: 1, createdAt: -1, _id: -1 });
attemptSchema.index({ reviewStatus: 1, createdAt: -1, _id: -1 });
attemptSchema.index({ exam: 1, student: 1, createdAt: -1, _id: -1 });
assignmentSchema.index({ student: 1, createdAt: -1, _id: -1 });
userSchema.index({ role: 1, status: 1, createdAt: -1, _id: -1 });
attemptSchema.index({ assignment: 1, student: 1, number: -1 });
export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Cohort = mongoose.model('Cohort', cohortSchema);
export const Subject = mongoose.model('Subject', subjectSchema);
export const Question = mongoose.model('Question', questionSchema);
export const Exam = mongoose.model('Exam', examSchema);
export const Assignment = mongoose.model('Assignment', assignmentSchema);
export const Attempt = mongoose.model('Attempt', attemptSchema);
const accountTokenSchema = new Schema(
  {
    user: ref('User'),
    purpose: { type: String, enum: ['invitation', 'reset'], required: true },
    tokenHash: { type: String, unique: true, required: true, select: false },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    revokedAt: Date,
    purgeAt: { type: Date, required: true, index: { expires: 0 } },
  },
  options,
);
accountTokenSchema.index({ user: 1, purpose: 1, createdAt: -1 });
const outboxSchema = new Schema(
  {
    user: ref('User'),
    accountToken: ref('AccountToken'),
    purpose: { type: String, enum: ['invitation', 'reset'], required: true },
    payload: { type: String, select: false },
    status: {
      type: String,
      enum: ['queued', 'processing', 'sent', 'failed', 'cancelled'],
      default: 'queued',
    },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    leaseOwner: String,
    deliveredAt: Date,
    purgeAt: { type: Date, required: true, index: { expires: 0 } },
  },
  options,
);
outboxSchema.index({ status: 1, availableAt: 1, leaseUntil: 1 });
const throttleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: Number,
    windowUntil: Date,
    nextAt: Date,
    purgeAt: { type: Date, required: true, index: { expires: 0 } },
  },
  options,
);
export const AccountToken = mongoose.model('AccountToken', accountTokenSchema);
export const EmailOutbox = mongoose.model('EmailOutbox', outboxSchema);
export const RecoveryThrottle = mongoose.model('RecoveryThrottle', throttleSchema);
const questionVersionSchema = new Schema(
  {
    question: ref('Question'),
    revision: { type: Number, required: true },
    snapshot: { type: snapshotSchema, required: true },
    editedBy: ref('User', false),
    reason: { type: String, required: true },
  },
  options,
);
questionVersionSchema.index({ question: 1, revision: 1 }, { unique: true });
const importBatchSchema = new Schema(
  {
    administrator: ref('User'),
    digest: { type: String, required: true },
    rows: { type: [Schema.Types.Mixed], default: [] },
    expiresAt: { type: Date, required: true },
    purgeAt: { type: Date, index: { expires: 0 } },
    status: { type: String, enum: ['preview', 'committed'], default: 'preview' },
    decisionsHash: String,
    committedAt: Date,
    summary: Schema.Types.Mixed,
  },
  options,
);
importBatchSchema.index({ administrator: 1, createdAt: -1, _id: -1 });
export const QuestionVersion = mongoose.model('QuestionVersion', questionVersionSchema);
export const QuestionImport = mongoose.model('QuestionImport', importBatchSchema);
const integrityDecisionSchema = new Schema(
  {
    attempt: ref('Attempt'),
    reviewer: ref('User', false),
    previousStatus: { type: String, enum: ['pending', 'cleared', 'flagged'] },
    status: { type: String, enum: ['pending', 'cleared', 'flagged'], required: true },
    note: { type: String, default: '' },
    decidedAt: { type: Date, required: true },
    legacy: { type: Boolean, default: false },
  },
  options,
);
integrityDecisionSchema.index({ attempt: 1, decidedAt: -1, _id: -1 });
export const IntegrityDecision = mongoose.model('IntegrityDecision', integrityDecisionSchema);
export const models = [
  User,
  Session,
  Cohort,
  Subject,
  Question,
  Exam,
  Assignment,
  Attempt,
  AccountToken,
  EmailOutbox,
  RecoveryThrottle,
  QuestionVersion,
  QuestionImport,
  IntegrityDecision,
];
