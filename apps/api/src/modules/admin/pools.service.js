import { randomInt } from 'node:crypto';
import { Question, Subject } from '../models.js';
import { assert } from '../../utils/errors.js';
import { questionSnapshot } from './questions.service.js';
export function boundedSnapshots(questions) {
  assert(
    Buffer.byteLength(JSON.stringify(questions), 'utf8') <= 8 * 1024 * 1024,
    422,
    'SNAPSHOT_BUDGET',
    'Frozen question content exceeds 8 MiB. Narrow the pool or reduce question text before publication.',
  );
  return questions;
}
export const shuffled = (values) => {
  const output = [...values];
  for (let i = output.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
};
// Bipartite matching handles overlapping sections, including Hall-deficient combinations.
export function matchPool(rules, randomize = false) {
  const slots = rules.flatMap((rule, section) =>
    Array.from({ length: rule.count }, () => ({
      section,
      candidates: randomize
        ? shuffled(rule.candidateIds.map(String))
        : rule.candidateIds.map(String),
    })),
  );
  const owner = new Map();
  function assign(slot, visited) {
    for (const question of slots[slot].candidates) {
      if (visited.has(question)) continue;
      visited.add(question);
      if (!owner.has(question) || assign(owner.get(question), visited)) {
        owner.set(question, slot);
        return true;
      }
    }
    return false;
  }
  for (let slot = 0; slot < slots.length; slot++)
    assert(
      assign(slot, new Set()),
      422,
      'POOL_UNSATISFIABLE',
      'The pool sections cannot supply enough unique questions. Reduce counts or adjust overlapping filters.',
    );
  const selected = [];
  for (const [questionId, slot] of owner)
    selected[slot] = { questionId, section: slots[slot].section };
  return selected;
}
export async function buildExamContent(exam, session) {
  assert(
    await Subject.exists({ _id: exam.subject }).session(session || null),
    422,
    'INVALID_SUBJECT',
    'The exam subject no longer exists.',
  );
  if ((exam.mode || 'fixed') === 'fixed') {
    const questions = await Question.find({
      _id: { $in: exam.questionIds },
      subject: exam.subject,
      archived: false,
    }).session(session || null);
    assert(
      questions.length === exam.questionIds.length && questions.length > 0,
      422,
      'INVALID_QUESTIONS',
      'Choose active questions from this exam’s subject.',
    );
    return {
      questions: boundedSnapshots(
        exam.questionIds.map((identifier) =>
          questionSnapshot(
            questions.find((question) => String(question._id) === String(identifier)),
          ),
        ),
      ),
      rules: [],
    };
  }
  const candidates = new Map();
  const rules = [];
  for (const rule of exam.poolRules) {
    assert(
      await Subject.exists({ _id: rule.subject }).session(session || null),
      422,
      'INVALID_SUBJECT',
      'A pool subject no longer exists.',
    );
    const filter = { subject: rule.subject, archived: false };
    if (rule.topic) filter.topic = rule.topic;
    if (rule.difficulty)
      filter.difficulty =
        rule.difficulty === 'unspecified' ? { $in: ['unspecified', null] } : rule.difficulty;
    if (rule.tags?.length) filter.tags = { $all: rule.tags };
    const questions = await Question.find(filter)
      .sort({ _id: 1 })
      .limit(501)
      .session(session || null);
    assert(
      questions.length <= 500,
      422,
      'POOL_TOO_LARGE',
      'Narrow the filters: at most 500 eligible question versions can be frozen.',
    );
    assert(
      questions.length >= rule.count,
      422,
      'POOL_INSUFFICIENT',
      `Pool section ${rule.id} does not have enough eligible questions.`,
    );
    for (const question of questions)
      candidates.set(String(question._id), questionSnapshot(question));
    assert(
      candidates.size <= 500,
      422,
      'POOL_TOO_LARGE',
      'The publication may freeze at most 500 unique eligible questions.',
    );
    rules.push({
      id: rule.id,
      subject: rule.subject,
      topic: rule.topic || '',
      difficulty: rule.difficulty,
      tags: [...(rule.tags || [])],
      count: rule.count,
      points: rule.points,
      penalty: rule.penalty || 0,
      candidateIds: questions.map((question) => question._id),
    });
  }
  assert(rules.length > 0, 422, 'POOL_EMPTY', 'Add at least one pool section.');
  matchPool(rules);
  return { questions: boundedSnapshots([...candidates.values()]), rules };
}
export function selectAttemptQuestions(exam, randomize = true) {
  const snapshots = exam.questions.map((question) =>
    question.toObject ? question.toObject() : structuredClone(question),
  );
  if ((exam.mode || 'fixed') !== 'pool') return snapshots;
  const selected = matchPool(exam.frozenPoolRules, randomize).map(({ questionId, section }) => {
    const question = snapshots.find((candidate) => String(candidate.questionId) === questionId);
    assert(
      question,
      409,
      'POOL_SNAPSHOT_MISSING',
      'A frozen pool question is unavailable. Contact your administrator.',
    );
    const rule = exam.frozenPoolRules[section];
    return {
      ...question,
      points: rule.points,
      penalty: rule.penalty,
      choices: randomize ? shuffled(question.choices) : question.choices,
    };
  });
  return randomize ? shuffled(selected) : selected;
}
