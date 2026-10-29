import { useState } from 'react';
import { QUESTION_LABELS, ATTEMPT_CONTROLS, attemptControls } from '@examledger/contracts';
import { ResourceSelect, ResourceChecklist } from '../../components/ui/ResourcePicker';
import { Button, Input, Select, Textarea, ErrorMessage } from '../../components/ui';
import { api, post, put, localDateValue } from '../../lib/api';
import { PoolBuilder } from './ExamControls';
export default function AdminEditor({ type, record, onSaved, onCancel }) {
  const defaults = {
    students: { name: '', email: '', password: '', cohort: '', active: true },
    cohorts: { name: '', description: '' },
    subjects: { name: '', code: '', description: '' },
    questions: {
      subject: '',
      prompt: '',
      choices: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '' })),
      correctChoiceId: 'a',
      correctChoiceIds: ['a'],
      type: 'single',
      penalty: 0,
      explanation: '',
      points: 1,
      archived: false,
      topic: '',
      difficulty: 'unspecified',
      tagsText: '',
    },
    exams: {
      title: '',
      subject: '',
      instructions: '',
      durationMinutes: 30,
      opensAt: localDateValue(Date.now()),
      closesAt: localDateValue(Date.now() + 86400000),
      maxAttempts: 1,
      attemptControls: attemptControls({
        requireFullscreen: true,
        disableCopyPaste: true,
        disableContextMenu: true,
      }),
      questionIds: [],
      mode: 'fixed',
      poolRules: [],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    assign: { studentIds: [], cohortIds: [] },
  };
  const [value, setValue] = useState(() => ({
    ...defaults[type],
    ...(type !== 'assign' && record
      ? {
          ...record,
          ...(type === 'questions'
            ? {
                type: record.type || 'single',
                correctChoiceIds: record.correctChoiceIds || [record.correctChoiceId],
                correctChoiceId: record.correctChoiceIds?.[0] || record.correctChoiceId,
                penalty: record.penalty || 0,
                tagsText: (record.tags || []).join(', '),
              }
            : {}),
          ...(type === 'exams'
            ? { opensAt: localDateValue(record.opensAt), closesAt: localDateValue(record.closesAt) }
            : {}),
          ...(type === 'students' ? { password: '', cohort: record.cohort || '' } : {}),
        }
      : {}),
  }));
  const [error, setError] = useState(null);
  const [enrollment, setEnrollment] = useState('invitation');
  const [busy, setBusy] = useState(false);
  const [assignmentPreview, setAssignmentPreview] = useState(null);
  const change = (e) =>
    setValue((v) => ({
      ...v,
      [e.target.name]:
        e.target.type === 'checkbox'
          ? e.target.checked
          : e.target.type === 'number'
            ? Number(e.target.value)
            : e.target.value,
    }));
  const input = (name, label, props = {}) => (
    <Input
      key={name}
      label={label}
      name={name}
      value={value[name]}
      onChange={change}
      required
      {...props}
    />
  );
  const area = (name, label, props = {}) => (
    <Textarea
      label={label}
      name={name}
      value={value[name]}
      onChange={change}
      maxLength={4000}
      {...props}
    />
  );
  const toggle = (name, id) => {
    setAssignmentPreview(null);
    setValue((v) => ({
      ...v,
      [name]: v[name].includes(id) ? v[name].filter((x) => x !== id) : [...v[name], id],
    }));
  };
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let data;
      if (type === 'students')
        data = {
          name: value.name,
          email: value.email,
          cohort: value.cohort || null,
          ...(record ? { active: value.active } : {}),
          ...((!record && enrollment === 'password') || (record && value.password)
            ? { password: value.password }
            : {}),
        };
      if (type === 'cohorts') data = { name: value.name, description: value.description };
      if (type === 'subjects')
        data = { name: value.name, code: value.code, description: value.description };
      if (type === 'questions')
        data = {
          subject: value.subject,
          prompt: value.prompt,
          choices: value.choices,
          type: value.type,
          correctChoiceIds:
            value.type === 'multiple' ? value.correctChoiceIds : [value.correctChoiceId],
          penalty: value.penalty,
          explanation: value.explanation,
          points: value.points,
          archived: value.archived,
          topic: value.topic,
          difficulty: value.difficulty,
          tags: value.tagsText
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          ...(record ? { expectedVersion: value.revision } : {}),
        };
      if (type === 'exams')
        data = {
          title: value.title,
          subject: value.subject,
          instructions: value.instructions,
          durationMinutes: value.durationMinutes,
          opensAt: new Date(value.opensAt).toISOString(),
          closesAt: new Date(value.closesAt).toISOString(),
          maxAttempts: value.maxAttempts,
          attemptControls: attemptControls(value.attemptControls),
          questionIds: value.questionIds,
          mode: value.mode,
          timeZone: value.timeZone,
          poolRules: value.poolRules.map(({ tagsText, ...rule }) => ({
            ...rule,
            tags:
              tagsText === undefined
                ? rule.tags
                : tagsText
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
          })),
        };
      if (type === 'assign') {
        const body = {
          studentIds: value.studentIds,
          cohortIds: value.cohortIds,
        };
        if (!assignmentPreview) {
          setAssignmentPreview(await post(`/admin/exams/${record.id}/assignment-preview`, body));
          return;
        }
        await post(`/admin/exams/${record.id}/assign`, body);
      } else if (record) await put(`/admin/${type}/${record.id}`, data);
      else
        await post(
          type === 'students' && enrollment === 'invitation'
            ? '/admin/student-invitations'
            : `/admin/${type}`,
          data,
        );
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="editor-form">
      <ErrorMessage error={error} />
      {error?.code === 'QUESTION_CONFLICT' && record && (
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            try {
              const latest = await api(`/admin/questions/${record.id}`);
              setValue((current) => ({
                ...current,
                ...latest,
                tagsText: latest.tags.join(', '),
                correctChoiceId: latest.correctChoiceIds[0],
              }));
              setError(null);
            } catch (failure) {
              setError(failure);
            }
          }}
        >
          Discard local edits and load latest version
        </Button>
      )}
      {type === 'students' && (
        <>
          {input('name', 'Full name', { maxLength: 120 })}
          {input('email', 'Email address', { type: 'email', maxLength: 254 })}
          {record?.status === 'pending' && (
            <p className="notice">
              Changing this email revokes its existing link. Resend an invitation after saving.
            </p>
          )}
          {!record && (
            <Select
              label="Enrollment method"
              value={enrollment}
              onChange={(event) => setEnrollment(event.target.value)}
            >
              <option value="invitation">Send invitation</option>
              <option value="password">Set initial password manually</option>
            </Select>
          )}
          {!record && enrollment === 'invitation' && (
            <p className="notice">
              Creates a pending student and queues a private, single-use link. No password is sent
              by email.
            </p>
          )}
          {record?.status !== 'pending' &&
            (record || enrollment === 'password') &&
            input('password', record ? 'New password (optional)' : 'Initial password', {
              type: 'password',
              minLength: 12,
              maxLength: 128,
              autoComplete: 'new-password',
              required: !record,
              hint: 'At least 12 characters. Share privately with the student.',
            })}
          <ResourceSelect
            resource="cohorts"
            label="Cohort"
            value={value.cohort}
            onChange={(cohort) => setValue((v) => ({ ...v, cohort }))}
          />
          {record && record.status !== 'pending' && (
            <label className="check">
              <input type="checkbox" name="active" checked={value.active} onChange={change} />
              Account active
            </label>
          )}
        </>
      )}
      {type === 'cohorts' && (
        <>
          {input('name', 'Cohort name', { maxLength: 100 })}
          {area('description', 'Description', { maxLength: 1000 })}
        </>
      )}
      {type === 'subjects' && (
        <>
          {input('name', 'Subject name', { maxLength: 120 })}
          {input('code', 'Subject code', { maxLength: 20 })}
          {area('description', 'Description', { maxLength: 1000 })}
        </>
      )}
      {type === 'questions' && (
        <>
          {record && <p>Editing version {value.revision}. Saving creates a new version.</p>}
          {record?.publishedExamCount > 0 && (
            <p className="notice notice-warning">
              Included in {record.publishedExamCount} published definition(s). Editing or archiving
              cannot change those frozen versions or existing grades.
            </p>
          )}
          {input('topic', 'Topic', { required: false, maxLength: 120 })}
          <Select label="Difficulty" name="difficulty" value={value.difficulty} onChange={change}>
            {['unspecified', 'easy', 'medium', 'hard'].map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </Select>
          {input('tagsText', 'Tags (comma-separated)', { required: false, maxLength: 500 })}
          <ResourceSelect
            resource="subjects"
            label="Subject"
            value={value.subject}
            autoFirst
            required
            onChange={(subject) => setValue((v) => ({ ...v, subject }))}
          />
          <Select
            label="Question type"
            value={value.type}
            onChange={(e) => {
              const nextType = e.target.value;
              const choices =
                nextType === 'true-false'
                  ? [
                      { id: 'true', text: 'True' },
                      { id: 'false', text: 'False' },
                    ]
                  : value.type === 'true-false'
                    ? ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '' }))
                    : value.choices;
              setValue((v) => ({
                ...v,
                type: nextType,
                choices,
                correctChoiceId: choices[0].id,
                correctChoiceIds: [choices[0].id],
              }));
            }}
          >
            {Object.entries(QUESTION_LABELS).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </Select>
          {area('prompt', 'Question', { required: true })}
          <fieldset className="choice-fields">
            <legend>Answer choices</legend>
            {value.choices.map((c, index) => (
              <Input
                key={c.id}
                label={`Option ${String.fromCharCode(65 + index)}`}
                readOnly={value.type === 'true-false'}
                value={c.text}
                maxLength={1000}
                required
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    choices: v.choices.map((o, i) =>
                      i === index ? { ...o, text: e.target.value } : o,
                    ),
                  }))
                }
              />
            ))}
          </fieldset>
          {value.type !== 'true-false' && (
            <div className="row-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={value.choices.length >= 8}
                onClick={() =>
                  setValue((v) => ({
                    ...v,
                    choices: [...v.choices, { id: `o-${crypto.randomUUID()}`, text: '' }],
                  }))
                }
              >
                Add option
              </Button>
              <Button
                type="button"
                variant="text"
                disabled={value.choices.length <= 2}
                onClick={() =>
                  setValue((v) => {
                    const choices = v.choices.slice(0, -1);
                    return {
                      ...v,
                      choices,
                      correctChoiceIds: v.correctChoiceIds.filter((id) =>
                        choices.some((c) => c.id === id),
                      ),
                      correctChoiceId: choices.some((c) => c.id === v.correctChoiceId)
                        ? v.correctChoiceId
                        : choices[0].id,
                    };
                  })
                }
              >
                Remove last option
              </Button>
            </div>
          )}
          {value.type === 'multiple' ? (
            <fieldset className="selection-list">
              <legend>Correct options — exact set required</legend>
              {value.choices.map((c, i) => (
                <label className="check" key={c.id}>
                  <input
                    type="checkbox"
                    checked={value.correctChoiceIds.includes(c.id)}
                    onChange={() => toggle('correctChoiceIds', c.id)}
                  />
                  <span>Mark option {String.fromCharCode(65 + i)} correct</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <Select
              label="Correct answer"
              name="correctChoiceId"
              value={value.correctChoiceId}
              onChange={change}
            >
              {value.choices.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {value.type === 'true-false' ? c.text : `Option ${String.fromCharCode(65 + i)}`}
                </option>
              ))}
            </Select>
          )}
          {input('penalty', 'Incorrect-answer penalty', {
            type: 'number',
            min: 0,
            max: value.points,
            step: '0.01',
            hint: 'Deducted for an incorrect non-empty answer. Unanswered questions score zero; no partial credit.',
          })}
          <section className="question-preview">
            <h3>Question preview</h3>
            <p>{value.prompt || 'Your question will appear here.'}</p>
            <small>
              {QUESTION_LABELS[value.type]}
              {value.type === 'multiple' ? ' — select all that apply' : ' — choose one'}
            </small>
            {value.choices.map((c, i) => (
              <label className="check" key={c.id}>
                <input
                  type={value.type === 'multiple' ? 'checkbox' : 'radio'}
                  name="preview-choice"
                  disabled
                />
                <span>
                  {String.fromCharCode(65 + i)}. {c.text || 'Option text'}
                </span>
              </label>
            ))}
          </section>
          {area('explanation', 'Explanation (shown after result release)')}
          {input('points', 'Points', { type: 'number', min: 1, max: 100 })}
          <label className="check">
            <input type="checkbox" name="archived" checked={value.archived} onChange={change} />
            Archive question
          </label>
        </>
      )}
      {type === 'exams' && (
        <>
          {input('title', 'Exam title', { maxLength: 180 })}
          <ResourceSelect
            resource="subjects"
            label="Subject"
            value={value.subject}
            autoFirst
            required
            onChange={(subject) => setValue((v) => ({ ...v, subject, questionIds: [] }))}
          />
          {area('instructions', 'Instructions', { maxLength: 8000 })}
          <fieldset className="attempt-controls">
            <legend>Attempt controls</legend>
            <p className="muted small">
              Applies to students taking this exam only. Choose these before publishing. Turn
              controls off when accessibility accommodations or device support require it.
            </p>
            {Object.entries(ATTEMPT_CONTROLS).map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={value.attemptControls?.[key] === true}
                  onChange={(event) =>
                    setValue((current) => ({
                      ...current,
                      attemptControls: {
                        ...attemptControls(current.attemptControls),
                        [key]: event.target.checked,
                      },
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
            <p className="muted small">
              Fullscreen requires a supported browser and student permission. Browser controls
              discourage casual copying; they cannot prevent screenshots or guarantee exam
              integrity.
            </p>
          </fieldset>
          <div className="form-grid">
            {input('durationMinutes', 'Duration (minutes)', { type: 'number', min: 1, max: 240 })}
            {input('maxAttempts', 'Maximum attempts', { type: 'number', min: 1, max: 5 })}
            {input('opensAt', 'Opens at (local time)', { type: 'datetime-local' })}
            {input('closesAt', 'Closes at (local time)', { type: 'datetime-local' })}
          </div>
          <p>
            Schedule input timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Absolute
            instants are stored in UTC; publication review shows both. Display label:{' '}
            {value.timeZone}.
          </p>
          <Select
            label="Question selection mode"
            value={value.mode}
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                mode: event.target.value,
                questionIds: [],
                poolRules: [],
              }))
            }
          >
            <option value="fixed">Fixed questions</option>
            <option value="pool">Configurable pool</option>
          </Select>
          {value.mode === 'pool' && (
            <PoolBuilder
              rules={value.poolRules}
              subject={value.subject}
              onChange={(poolRules) => setValue((current) => ({ ...current, poolRules }))}
            />
          )}
          {value.mode === 'fixed' && value.subject && (
            <ResourceChecklist
              resource="questions"
              label="Questions"
              filter={`subject=${value.subject}&archived=false`}
              values={value.questionIds}
              onToggle={(id) => toggle('questionIds', id)}
            />
          )}
          <p className="muted small">
            Publishing locks the exam and its question snapshot. Check the schedule and answers
            before publishing.
          </p>
        </>
      )}
      {type === 'assign' && (
        <>
          <p className="muted">
            Assign “{record.title}” to individual students or every current active member of a
            cohort. Existing assignments are kept.
          </p>
          <ResourceChecklist
            resource="cohorts"
            label="Cohorts"
            values={value.cohortIds}
            onToggle={(id) => toggle('cohortIds', id)}
          />
          <ResourceChecklist
            resource="students"
            label="Individual students"
            filter="active=true"
            values={value.studentIds}
            onToggle={(id) => toggle('studentIds', id)}
          />
          {assignmentPreview && (
            <div className="notice" role="status">
              <div>
                <strong>Deduplicated assignment preview</strong>
                <p>
                  {assignmentPreview.eligible} eligible; {assignmentPreview.alreadyAssigned} already
                  assigned; {assignmentPreview.newAssignments} new assignments.
                </p>
                <p>{assignmentPreview.notice}</p>
              </div>
            </div>
          )}
        </>
      )}
      <div className="form-actions">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {type === 'assign'
            ? assignmentPreview
              ? 'Assign exam'
              : 'Preview assignment'
            : record
              ? 'Save changes'
              : 'Create record'}
        </Button>
      </div>
    </form>
  );
}
