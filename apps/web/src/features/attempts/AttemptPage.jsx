import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Clock3,
  Flag,
  WifiOff,
  Maximize,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAttempt } from './useAttempt';
import { useAttemptControls } from './useAttemptControls';
import { Brand, Button, ErrorMessage, Loading, Modal } from '../../components/ui';
import { formatDate } from '../../lib/api';
import { selectionIds } from '@examledger/contracts';
export default function AttemptPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const exam = useAttempt(id, user.id);
  const [index, setIndex] = useState(0);
  const [flagged, setFlagged] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { attempt: a, answers, state, remaining } = exam;
  const protection = useAttemptControls(a);
  if (!a)
    return (
      <main className="attempt-loading">
        {state === 'loading' ? (
          <Loading />
        ) : (
          <>
            <ErrorMessage error={exam.error} />
            <Button onClick={exam.retry}>Retry connection</Button>
            <Link to="/student">Back to examinations</Link>
          </>
        )}
      </main>
    );
  if (a.status === 'submitted')
    return (
      <main className="receipt-page">
        <Brand />
        <section className="panel receipt">
          <span className="receipt-icon">
            <CheckCheck size={35} />
          </span>
          <p className="eyebrow">SUBMISSION RECORDED</p>
          <h1>Your work is in.</h1>
          <p>
            Your examination has been submitted
            {a.submissionReason === 'deadline'
              ? ' because the time limit ended'
              : a.submissionReason === 'admin-close'
                ? ' because the administrator closed the examination'
                : ''}
            .
          </p>
          <dl>
            <div>
              <dt>Attempt</dt>
              <dd>{a.number}</dd>
            </div>
            <div>
              <dt>Recorded at</dt>
              <dd>{formatDate(a.submittedAt)}</dd>
            </div>
            <div>
              <dt>Receipt ID</dt>
              <dd className="mono">{a.id}</dd>
            </div>
          </dl>
          <p className="muted small">
            Your result will appear once your administrator releases it. Your score is based on
            answers saved before the deadline.
          </p>
          <Link className="button button-primary" to="/student">
            Back to examinations <ArrowRight size={16} />
          </Link>
        </section>
      </main>
    );
  const question = a.questions[Math.min(index, a.questions.length - 1)];
  const selected = selectionIds(answers.find((v) => v.questionId === question.id));
  const time = `${Math.floor(remaining / 60)
    .toString()
    .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
  const saveLabel =
    {
      saved: 'All answers saved',
      pending: 'Answers waiting to save',
      saving: 'Saving answers…',
      offline: 'Offline · draft kept on this device',
      conflict: 'Answer conflict · action needed',
    }[state] || state;
  return (
    <div className="attempt-shell">
      <a className="skip-link" href="#question">
        Skip to question
      </a>
      <header className="attempt-top">
        <Brand />
        <div className="attempt-title">
          <strong>{a.title}</strong>
          <small>Attempt {a.number}</small>
        </div>
        <div
          className={`exam-timer ${remaining < 60 ? 'timer-warning' : ''}`}
          role="timer"
          aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}
        >
          <Clock3 size={21} />
          <div>
            <small>TIME REMAINING</small>
            <strong>{time}</strong>
          </div>
        </div>
      </header>
      <div className="attempt-status">
        <span className={state === 'saved' ? 'text-teal' : 'text-warning'}>
          {state === 'saved' ? <Check size={16} /> : <WifiOff size={16} />}
          <span role="status">{saveLabel}</span>
        </span>
        <span>Deadline: {formatDate(a.deadline)}</span>
      </div>
      {protection.blocked && (
        <section className="panel fullscreen-gate" aria-labelledby="fullscreen-heading">
          <Maximize size={28} aria-hidden="true" />
          <h1 id="fullscreen-heading">Fullscreen is required for this exam</h1>
          <p>
            Your administrator enabled fullscreen. Enter fullscreen to view and answer questions. If
            you exit, return here to continue; saved answers and your original deadline remain
            unchanged.
          </p>
          <p className="muted small">
            The timer continues while this screen is open. Use a supported browser; contact your
            administrator if you need an accommodation.
          </p>
          <ErrorMessage error={protection.error} />
          <Button id="enter-fullscreen" onClick={protection.enterFullscreen}>
            <Maximize size={17} />
            Enter fullscreen
          </Button>
          <Link className="button button-secondary" to="/student">
            Back to examinations
          </Link>
        </section>
      )}
      <main className="attempt-body" hidden={protection.blocked}>
        <section className="question-area">
          {Object.values(protection.controls).some(Boolean) && (
            <div className="notice attempt-policy">
              <ShieldCheck size={18} />
              <span>
                Exam controls:{' '}
                {[
                  protection.controls.requireFullscreen && 'fullscreen required',
                  protection.controls.disableCopyPaste && 'copy, cut and paste disabled',
                  protection.controls.disableContextMenu && 'right-click menu disabled',
                ]
                  .filter(Boolean)
                  .join('; ')}
                .
              </span>
            </div>
          )}
          <ErrorMessage error={exam.error || error} />
          {exam.conflict && (
            <div className="notice notice-warning conflict-notice">
              <div>
                <strong>This attempt changed in another tab.</strong>
                <p>
                  Choose the saved server answers or explicitly replace them with this tab’s local
                  draft.
                </p>
                <div className="row-actions">
                  <Button variant="secondary" onClick={() => exam.resolve(false)}>
                    Use server answers
                  </Button>
                  <Button onClick={() => exam.resolve(true)}>Use this tab’s answers</Button>
                </div>
              </div>
            </div>
          )}
          {remaining === 0 && (
            <div className="notice notice-warning" role="status">
              Time has ended. Finalizing your saved answers; reconnect if needed.
            </div>
          )}
          <div className="question-heading">
            <p className="eyebrow">
              QUESTION {index + 1} OF {a.questions.length}
            </p>
            <Button
              variant="text"
              onClick={() =>
                setFlagged((v) =>
                  v.includes(question.id)
                    ? v.filter((x) => x !== question.id)
                    : [...v, question.id],
                )
              }
            >
              <Flag size={16} />
              {flagged.includes(question.id) ? 'Flagged for review' : 'Flag for review'}
            </Button>
          </div>
          <div className="panel question-panel" id="question" tabIndex={-1}>
            <fieldset disabled={remaining <= 0 || Boolean(exam.conflict)}>
              <legend>{question.prompt}</legend>
              <p className="muted small">
                {question.type === 'multiple'
                  ? 'Select all that apply. Only the exact correct set earns marks.'
                  : 'Select one answer.'}
              </p>
              <div className="answer-options">
                {question.choices.map((choice, choiceIndex) => (
                  <label
                    className={`answer-option ${selected.includes(choice.id) ? 'selected' : ''}`}
                    key={choice.id}
                  >
                    <input
                      type={question.type === 'multiple' ? 'checkbox' : 'radio'}
                      name={question.id}
                      value={choice.id}
                      checked={selected.includes(choice.id)}
                      onChange={() =>
                        exam.choose(
                          question.id,
                          question.type === 'multiple'
                            ? selected.includes(choice.id)
                              ? selected.filter((id) => id !== choice.id)
                              : [...selected, choice.id]
                            : [choice.id],
                        )
                      }
                    />
                    <span className="choice-letter">{String.fromCharCode(65 + choiceIndex)}</span>
                    <span>{choice.text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button
              variant="text"
              disabled={!selected.length || remaining <= 0 || Boolean(exam.conflict)}
              onClick={() => exam.choose(question.id, null)}
            >
              Clear response
            </Button>
          </div>
          <div className="question-navigation">
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={() => setIndex((v) => v - 1)}
            >
              <ArrowLeft size={16} />
              Previous
            </Button>
            <span>
              {index + 1} / {a.questions.length}
            </span>
            <Button
              variant="secondary"
              disabled={index >= a.questions.length - 1}
              onClick={() => setIndex((v) => v + 1)}
            >
              Next question
              <ArrowRight size={16} />
            </Button>
          </div>
          <p className="exam-reminder">
            Your timer continues during interruptions. Pending answers must reach the server before
            time ends.
          </p>
        </section>
        <aside className="panel question-map">
          <p className="eyebrow">YOUR PROGRESS</p>
          <h2>Question navigator</h2>
          <p>
            <strong>{answers.length}</strong> of {a.questions.length} answered
          </p>
          <div className="progress-track">
            <div style={{ width: `${(answers.length / a.questions.length) * 100}%` }} />
          </div>
          <div className="question-numbers">
            {a.questions.map((q, i) => (
              <button
                key={q.id}
                aria-label={`Question ${i + 1}${answers.some((v) => v.questionId === q.id) ? ', answered' : ', unanswered'}${flagged.includes(q.id) ? ', flagged' : ''}`}
                aria-current={i === index ? 'step' : undefined}
                className={`${answers.some((v) => v.questionId === q.id) ? 'answered' : ''} ${i === index ? 'current' : ''} ${flagged.includes(q.id) ? 'flagged' : ''}`}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="map-key">
            <span>
              <i className="key-answered" />
              Answered
            </span>
            <span>
              <i />
              Unanswered
            </span>
            <span>
              <i className="key-flagged" />
              Flagged
            </span>
          </div>
          <Button
            disabled={remaining <= 0 || Boolean(exam.conflict)}
            className="w-full"
            onClick={() => setConfirm(true)}
          >
            Review & submit <ArrowRight size={16} />
          </Button>
          <small className="muted">You can revisit any question before submitting.</small>
        </aside>
      </main>
      {confirm && !protection.blocked && (
        <Modal title="Submit your examination?" onClose={() => setConfirm(false)}>
          <div className="editor-form">
            <p>
              You have answered {answers.length} of {a.questions.length} questions.{' '}
              {a.questions.length - answers.length > 0
                ? 'Unanswered questions receive zero points.'
                : 'Your answers are ready for submission.'}
            </p>
            {flagged.length > 0 && <p>{flagged.length} question(s) flagged for your review.</p>}
            <p className="muted">
              Submission is final. Your result will be available after it is released.
            </p>
            <ErrorMessage error={error} />
            <div className="form-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>
                Keep reviewing
              </Button>
              <Button
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await exam.submit();
                    setConfirm(false);
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Submit examination
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
