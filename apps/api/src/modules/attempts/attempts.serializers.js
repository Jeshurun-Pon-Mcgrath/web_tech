import { selectionIds, attemptControls } from '@examledger/contracts';
import { correctIds, gradeQuestion, questionType, serializeSavedAnswer } from './grading.js';
import { questionsForAttempt } from './attempts.service.js';
// Active responses are allowlisted; never spread database documents here.
export function serializeActiveAttempt(a, exam) {
  return {
    id: String(a._id),
    examId: String(exam._id),
    title: exam.title,
    instructions: exam.instructions,
    attemptControls: attemptControls(exam.attemptControls),
    number: a.number,
    status: a.status,
    startedAt: a.startedAt,
    deadline: a.deadline,
    serverNow: new Date(),
    version: a.version,
    answers: a.answers.map(serializeSavedAnswer),
    questions: questionsForAttempt(a, exam).map((q) => ({
      id: String(q.questionId),
      prompt: q.prompt,
      type: questionType(q),
      choices: q.choices.map((c) => ({ id: c.id, text: c.text })),
    })),
  };
}
export function serializeReceipt(a) {
  return {
    id: String(a._id),
    examId: String(a.exam),
    number: a.number,
    status: a.status,
    submittedAt: a.submittedAt,
    submissionReason: a.submissionReason,
    serverNow: new Date(),
  };
}
export function serializeResult(a, exam) {
  return {
    ...serializeReceipt(a),
    title: exam.title,
    score: a.score,
    maxScore: a.maxScore,
    percentage: a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0,
    questions: questionsForAttempt(a, exam).map((q) => ({
      id: String(q.questionId),
      prompt: q.prompt,
      choices: q.choices.map((c) => ({ id: c.id, text: c.text })),
      selectedChoiceId:
        questionType(q) === 'multiple'
          ? null
          : selectionIds(a.answers.find((v) => v.questionId === String(q.questionId)))[0] || null,
      correctChoiceId: questionType(q) === 'multiple' ? undefined : correctIds(q)[0],
      type: questionType(q),
      selectedChoiceIds: selectionIds(a.answers.find((v) => v.questionId === String(q.questionId))),
      correctChoiceIds: correctIds(q),
      ...gradeQuestion(
        q,
        a.answers.find((v) => v.questionId === String(q.questionId)),
      ),
      penalty: q.penalty || 0,
      explanation: q.explanation,
      points: q.points,
    })),
  };
}
