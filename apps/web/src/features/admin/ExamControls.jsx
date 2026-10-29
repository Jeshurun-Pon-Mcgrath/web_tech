import { useState } from 'react';
import { ATTEMPT_CONTROLS } from '@examledger/contracts';
import { useResource } from '../../hooks/useResource';
import { formatDate, post } from '../../lib/api';
import { Button, ErrorMessage, Input, Loading, Modal, Select } from '../../components/ui';
import { ResourceSelect } from '../../components/ui/ResourcePicker';
export function PoolBuilder({ rules, subject, onChange }) {
  const update = (index, field, value) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, [field]: value } : rule)));
  return (
    <section>
      <h3>Pool sections</h3>
      <p>
        All specified filters must match. Tags use AND matching. Each section supplies its count at
        the stated points/penalty. At most 10 sections, 200 selected questions and 500 frozen
        eligible versions.
      </p>
      {rules.map((rule, index) => (
        <fieldset className="question-preview" key={rule.id}>
          <legend>Section {index + 1}</legend>
          <ResourceSelect
            resource="subjects"
            label={`Pool subject ${index + 1}`}
            required
            value={rule.subject}
            onChange={(value) => update(index, 'subject', value)}
          />
          <Input
            label={`Pool topic ${index + 1}`}
            maxLength={120}
            value={rule.topic || ''}
            onChange={(event) => update(index, 'topic', event.target.value)}
          />
          <Select
            label={`Pool difficulty ${index + 1}`}
            value={rule.difficulty || ''}
            onChange={(event) => update(index, 'difficulty', event.target.value || undefined)}
          >
            <option value="">Any difficulty</option>
            {['unspecified', 'easy', 'medium', 'hard'].map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </Select>
          <Input
            label={`Pool tags ${index + 1} (comma-separated)`}
            maxLength={500}
            value={rule.tagsText ?? (rule.tags || []).join(', ')}
            onChange={(event) => update(index, 'tagsText', event.target.value)}
          />
          <div className="form-grid">
            {[
              ['count', 'Required questions', 1, 200],
              ['points', 'Points per question', 1, 100],
              ['penalty', 'Penalty per wrong answer', 0, rule.points],
            ].map(([field, label, min, max]) => (
              <Input
                key={field}
                label={`${label} ${index + 1}`}
                type="number"
                required
                min={min}
                max={max}
                step={field === 'penalty' ? '0.01' : '1'}
                value={rule[field]}
                onChange={(event) => update(index, field, Number(event.target.value))}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="text"
            onClick={() => onChange(rules.filter((_, i) => i !== index))}
          >
            Remove section {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={rules.length >= 10}
        onClick={() =>
          onChange([
            ...rules,
            {
              id: `p-${crypto.randomUUID()}`,
              subject,
              topic: '',
              tags: [],
              difficulty: undefined,
              count: 1,
              points: 1,
              penalty: 0,
            },
          ])
        }
      >
        Add pool section
      </Button>
      <p className="notice notice-warning">
        Randomized variants can differ in difficulty. Equal available marks do not establish
        psychometric equivalence.
      </p>
    </section>
  );
}
export function PublicationReview({ exam, onClose, onPublished }) {
  const resource = useResource(`/admin/exams/${exam.id}/publication-checklist`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await post(`/admin/exams/${exam.id}/publish`);
      await onPublished();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Publish examination?" onClose={onClose}>
      <div className="editor-form">
        <ErrorMessage error={error || resource.error} />
        {resource.loading ? (
          <Loading />
        ) : (
          resource.data && (
            <>
              <p>
                Publication freezes eligible question versions, scoring, selection rules and
                schedule. Changes afterward require a new draft.
              </p>
              <dl>
                <div>
                  <dt>Schedule timezone</dt>
                  <dd>{resource.data.exam.timeZone}</dd>
                </div>
                <div>
                  <dt>Opens (your local display)</dt>
                  <dd>{formatDate(exam.opensAt)}</dd>
                </div>
                <div>
                  <dt>Closes (your local display)</dt>
                  <dd>{formatDate(exam.closesAt)}</dd>
                </div>
                <div>
                  <dt>UTC availability</dt>
                  <dd>
                    {new Date(exam.opensAt).toISOString()} — {new Date(exam.closesAt).toISOString()}
                  </dd>
                </div>
                <div>
                  <dt>Duration / attempt limit</dt>
                  <dd>
                    {exam.durationMinutes} minutes / {exam.maxAttempts} attempt(s)
                  </dd>
                </div>
                <div>
                  <dt>Attempt controls (locked on publication)</dt>
                  <dd>
                    {Object.entries(ATTEMPT_CONTROLS)
                      .filter(([key]) => exam.attemptControls?.[key])
                      .map(([, label]) => label)
                      .join('; ') || 'No additional browser restrictions'}
                  </dd>
                </div>
              </dl>
              <ul>
                {resource.data.checks.map((check) => (
                  <li key={check.label}>
                    {check.passed ? 'Ready: ' : 'Needs attention: '}
                    {check.label}
                  </li>
                ))}
              </ul>
              <p>
                {resource.data.questionCount} questions per attempt; {resource.data.totalMarks}{' '}
                available marks.
              </p>
              {resource.data.sections.map((section) => (
                <p key={section.id}>
                  Section {section.id}: choose {section.required} from {section.eligible};{' '}
                  {section.points} points and {section.penalty} penalty per question.
                </p>
              ))}
              <details>
                <summary>Feasible selection preview (not a future student variant)</summary>
                {resource.data.sample.map((question) => (
                  <p key={question.id}>
                    v{question.revision}: {question.prompt} — {question.points} points;{' '}
                    {question.penalty} penalty
                  </p>
                ))}
              </details>
              <p className="notice">{resource.data.notice}</p>
              <p>{resource.data.releaseRule}</p>
            </>
          )
        )}
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} disabled={!resource.data?.ready} onClick={publish}>
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
