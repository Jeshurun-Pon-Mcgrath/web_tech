export const API_PREFIX = '/api/v1';
export const INTEGRITY_TYPES = ['visibility-hidden', 'offline', 'fullscreen-exit'];
export const REVIEW_STATES = ['pending', 'cleared', 'flagged'];
export const ANSWER_LIMIT = 200;
export const ATTEMPT_CONTROLS = {
  requireFullscreen: 'Require fullscreen',
  disableCopyPaste: 'Disable copying, cutting and pasting',
  disableContextMenu: 'Disable right-click menu',
};
// An allowlist also supplies safe defaults for exams created before these controls existed.
export function attemptControls(value) {
  return Object.fromEntries(
    Object.keys(ATTEMPT_CONTROLS).map((key) => [key, value?.[key] === true]),
  );
}
export const QUESTION_TYPES = ['single', 'multiple', 'true-false'];
export const QUESTION_LABELS = {
  single: 'Single-answer MCQ',
  multiple: 'Multiple-answer MCQ',
  'true-false': 'True/false',
};
// Selection representation only: answer keys and grading remain on the server.
export function selectionIds(answer) {
  return Array.isArray(answer?.choiceIds)
    ? [...answer.choiceIds].sort()
    : answer?.choiceId
      ? [answer.choiceId]
      : [];
}
