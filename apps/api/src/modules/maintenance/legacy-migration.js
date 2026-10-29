const missing = (object, key) => !Object.prototype.hasOwnProperty.call(object, key);
export function legacyPatch(document, kind) {
  const patch = {};
  function question(q, prefix = '') {
    if (missing(q, 'type'))
      patch[prefix + 'type'] = q.correctChoiceIds?.length > 1 ? 'multiple' : 'single';
    if (missing(q, 'penalty')) patch[prefix + 'penalty'] = 0;
    if (missing(q, 'correctChoiceIds') && q.correctChoiceId)
      patch[prefix + 'correctChoiceIds'] = [q.correctChoiceId];
  }
  if (kind === 'questions') question(document);
  if (kind === 'exams')
    (document.questions || []).forEach((q, i) => question(q, `questions.${i}.`));
  if (kind === 'attempts')
    (document.answers || []).forEach((a, i) => {
      if (missing(a, 'choiceIds') && a.choiceId) patch[`answers.${i}.choiceIds`] = [a.choiceId];
    });
  return patch;
}
export async function migrateLegacyQuestions(connection, { dryRun = true } = {}) {
  const report = { dryRun, questions: 0, exams: 0, attempts: 0 };
  for (const kind of ['questions', 'exams', 'attempts']) {
    const collection = connection.collection(kind);
    for await (const candidate of collection.find({})) {
      if (!Object.keys(legacyPatch(candidate, kind)).length) continue;
      if (dryRun) {
        report[kind]++;
        continue;
      }
      const changed = await connection.transaction(async (session) => {
        const current = await collection.findOne({ _id: candidate._id }, { session });
        if (!current) return false;
        const patch = legacyPatch(current, kind);
        if (!Object.keys(patch).length) return false;
        await collection.updateOne({ _id: current._id }, { $set: patch }, { session });
        return true;
      });
      if (changed) report[kind]++;
    }
  }
  return report;
}
