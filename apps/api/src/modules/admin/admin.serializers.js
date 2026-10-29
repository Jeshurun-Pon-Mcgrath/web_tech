import { correctIds, questionType } from '../attempts/grading.js';
export const serializeCohort = (c) => ({
  id: String(c._id),
  name: c.name,
  description: c.description,
});
export const serializeSubject = (s) => ({
  id: String(s._id),
  name: s.name,
  code: s.code,
  description: s.description,
});
export const serializeQuestion = (q) => ({
  id: String(q._id),
  subject: String(q.subject),
  subjectName: q.subjectInfo?.name || '',
  prompt: q.prompt,
  choices: q.choices.map((c) => ({ id: c.id, text: c.text })),
  correctChoiceId: q.correctChoiceId,
  correctChoiceIds: correctIds(q),
  type: questionType(q),
  penalty: q.penalty || 0,
  explanation: q.explanation,
  points: q.points,
  archived: q.archived,
  revision: q.revision || 1,
  topic: q.topic || '',
  difficulty: q.difficulty || 'unspecified',
  tags: q.tags || [],
  publishedExamCount: q.publishedExamCount || 0,
});
export const serializeExam = (e) => ({
  id: String(e._id),
  title: e.title,
  subject: String(e.subject?._id || e.subject),
  subjectName: e.subjectInfo?.name || e.subject?.name || '',
  instructions: e.instructions,
  durationMinutes: e.durationMinutes,
  opensAt: e.opensAt,
  closesAt: e.closesAt,
  maxAttempts: e.maxAttempts,
  attemptControls: {
    requireFullscreen: e.attemptControls?.requireFullscreen === true,
    disableCopyPaste: e.attemptControls?.disableCopyPaste === true,
    disableContextMenu: e.attemptControls?.disableContextMenu === true,
  },
  questionIds: e.questionIds.map(String),
  questionCount:
    e.mode === 'pool'
      ? e.poolRules.reduce((sum, rule) => sum + rule.count, 0)
      : e.status === 'published'
        ? e.questions.length
        : e.questionIds.length,
  status: e.status,
  resultsReleased: e.resultsReleased,
  mode: e.mode || 'fixed',
  timeZone: e.timeZone || 'UTC',
  poolRules: (e.poolRules || []).map((rule) => ({
    id: rule.id,
    subject: String(rule.subject),
    topic: rule.topic || '',
    difficulty: rule.difficulty,
    tags: rule.tags || [],
    count: rule.count,
    points: rule.points,
    penalty: rule.penalty || 0,
  })),
  totalMarks:
    e.mode === 'pool'
      ? e.poolRules.reduce((sum, rule) => sum + rule.count * rule.points, 0)
      : e.status === 'published'
        ? e.questions.reduce((sum, question) => sum + question.points, 0)
        : null,
  closedAt: e.closedAt || null,
  closeReason: e.closeReason || '',
  closedBy: e.closedBy ? String(e.closedBy) : null,
  archivedAt: e.archivedAt || null,
  archiveReason: e.archiveReason || '',
});
