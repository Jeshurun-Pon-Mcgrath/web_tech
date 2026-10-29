import { selectionIds } from '@examledger/contracts';
export const questionType = (q) => q.type || 'single';
export const correctIds = (q) =>
  q.correctChoiceIds?.length
    ? [...q.correctChoiceIds].sort()
    : q.correctChoiceId
      ? [q.correctChoiceId]
      : [];
export function gradeQuestion(q, answer) {
  const selected = selectionIds(answer);
  const correct = correctIds(q);
  const exact =
    selected.length > 0 &&
    selected.length === correct.length &&
    new Set(selected).size === selected.length &&
    selected.every((id, i) => id === correct[i]);
  return {
    correct: exact,
    awardedPoints: exact ? q.points : selected.length ? -(q.penalty || 0) : 0,
  };
}
export function grade(questions, answers) {
  const selected = new Map(answers.map((a) => [a.questionId, a]));
  const score =
    questions.reduce(
      (sum, q) =>
        sum + Math.round(gradeQuestion(q, selected.get(String(q.questionId))).awardedPoints * 100),
      0,
    ) / 100;
  return { score, maxScore: questions.reduce((sum, q) => sum + q.points, 0) };
}
export const serializeSavedAnswer = (a) => ({
  questionId: a.questionId,
  ...(Array.isArray(a.choiceIds) ? { choiceIds: selectionIds(a) } : { choiceId: a.choiceId }),
});
