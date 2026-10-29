import { useEffect, useState } from 'react';
import { ATTEMPT_CONTROLS } from '@examledger/contracts';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock3,
  FileText,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { useResource } from '../../hooks/useResource';
import { usePagedResource } from '../../hooks/usePagedResource';
import Pagination from '../../components/ui/Pagination';
import {
  Badge,
  Button,
  Empty,
  ErrorMessage,
  Loading,
  PageHeading,
  Input,
  Select,
} from '../../components/ui';
import { api, formatDate, post } from '../../lib/api';
import PerformancePanel from '../results/PerformancePanel';
export default function StudentWorkspace({ detail, resultsOnly }) {
  const { id } = useParams();
  const list = usePagedResource(
    detail ? null : '/student/exams',
    resultsOnly ? 'results' : '',
    resultsOnly ? 'view=completed' : '',
  );
  const detailResource = useResource(detail ? `/student/exams/${id}` : null);
  const { loading, error, refresh } = detail ? detailResource : list;
  const data = detail ? (detailResource.data ? [detailResource.data] : null) : list.items;
  const navigate = useNavigate();
  const [acknowledged, setAcknowledged] = useState(false);
  const [connection, setConnection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => {
      refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  if (loading && !data) return <Loading />;
  if (!data)
    return (
      <>
        <ErrorMessage error={error} />
        <Button onClick={refresh}>Try again</Button>
      </>
    );
  const exam = detail ? data.find((e) => e.id === id) : null;
  const now = (e) => new Date(e.serverNow).getTime();
  const isOpen = (e) =>
    !e.closedAt &&
    !e.archivedAt &&
    now(e) >= new Date(e.opensAt).getTime() &&
    now(e) < new Date(e.closesAt).getTime();
  const status = (e) =>
    e.view
      ? e.view[0].toUpperCase() + e.view.slice(1)
      : now(e) < new Date(e.opensAt).getTime()
        ? 'Upcoming'
        : now(e) >= new Date(e.closesAt).getTime()
          ? 'Closed'
          : 'Open';
  async function checkConnection() {
    setBusy(true);
    try {
      await api('/health');
      setConnection(true);
      setActionError(null);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setActionError(null);
    try {
      await post(`/student/exams/${id}/readiness`, { acknowledged, connectionChecked: connection });
      const a = await post(`/student/exams/${id}/start`);
      navigate(`/student/attempts/${a.id}`);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="STUDENT WORKSPACE"
        title={
          detail
            ? exam?.title || 'Examination unavailable'
            : resultsOnly
              ? 'Your results'
              : 'Your examinations'
        }
        description={
          detail
            ? 'Take a moment to prepare before you begin.'
            : resultsOnly
              ? 'Review your progress after your administrator releases the results.'
              : 'A focused space for your next academic milestone.'
        }
        action={
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
        }
      />
      <ErrorMessage error={actionError || error} />
      {resultsOnly && <PerformancePanel />}
      {!detail && (
        <section className="panel padded" aria-busy={loading || undefined}>
          <div className="list-filters">
            <Input
              label="Search examinations"
              value={list.search}
              maxLength={100}
              onChange={(event) => list.setSearch(event.target.value)}
            />
            {!resultsOnly && (
              <Select
                label="Examination view"
                value={list.query.get('view') || 'all'}
                onChange={(event) => list.update('view', event.target.value)}
              >
                {['all', 'upcoming', 'available', 'completed', 'missed'].map((view) => (
                  <option key={view} value={view}>
                    {view[0].toUpperCase() + view.slice(1)}
                  </option>
                ))}
              </Select>
            )}
            <Select
              label="Sort examinations"
              value={list.query.get('sort') || 'createdAt'}
              onChange={(event) => list.update('sort', event.target.value)}
            >
              <option value="createdAt">Date assigned</option>
              <option value="title">Title</option>
              <option value="opensAt">Opening time</option>
              <option value="closesAt">Closing time</option>
            </Select>
            <Select
              label="Sort direction"
              value={list.query.get('order') || 'desc'}
              onChange={(event) => list.update('order', event.target.value)}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </Select>
          </div>
          {loading && <p role="status">Loading examinations…</p>}
        </section>
      )}
      {detail ? (
        !exam ? (
          <Empty title="Exam not found">This examination is not assigned to your account.</Empty>
        ) : (
          <div className="readiness-layout">
            <section className="panel padded">
              <p className="eyebrow">BEFORE YOU BEGIN</p>
              <h2>Set yourself up for a focused attempt.</h2>
              <p className="instructions">
                {exam.instructions ||
                  'Read every question carefully and select one answer. Your saved answers will be graded when you submit or time expires.'}
              </p>
              <div className="notice">
                <ShieldCheck size={20} />
                <span>
                  Focus changes and connection interruptions may be recorded for review. These
                  signals are contextual and do not prove misconduct.
                </span>
              </div>
              <section className="attempt-controls" aria-label="Exam controls">
                <h3>Exam controls</h3>
                <ul>
                  {Object.entries(ATTEMPT_CONTROLS)
                    .filter(([key]) => exam.attemptControls?.[key])
                    .map(([key, label]) => (
                      <li key={key}>{label}</li>
                    ))}
                </ul>
                {!Object.values(exam.attemptControls || {}).some(Boolean) && (
                  <p>No additional browser restrictions for this exam.</p>
                )}
                {exam.attemptControls?.requireFullscreen && (
                  <p>
                    After starting or resuming, select Enter fullscreen. Exiting pauses question
                    access, while the timer continues. Check browser support before starting;
                    contact your administrator for an accommodation if needed.
                  </p>
                )}
                {exam.attemptControls?.requireFullscreen && !document.fullscreenEnabled && (
                  <p className="text-warning" role="alert">
                    This browser does not support fullscreen. Use a supported desktop browser before
                    starting.
                  </p>
                )}
                <p className="muted small">
                  Controls apply only inside the attempt. Browser events are incomplete signals, not
                  proof of cheating.
                </p>
              </section>
              <div className="readiness-item">
                <Wifi size={23} />
                <div>
                  <h3>Check your connection</h3>
                  <p>A stable connection helps keep your answers saved.</p>
                  <Button variant="secondary" busy={busy} onClick={checkConnection}>
                    {connection ? 'Connection checked' : 'Check connection'}
                  </Button>
                </div>
              </div>
              <label className="check readiness-check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  I have read the instructions. I understand that the timer continues during
                  refreshes and connection loss, and that answers must reach the server before the
                  deadline.
                </span>
              </label>
              {exam.attempts.find((a) => a.status === 'active') ? (
                <Link
                  className="button button-primary"
                  to={`/student/attempts/${exam.attempts.find((a) => a.status === 'active').id}`}
                >
                  Resume attempt <ArrowRight size={17} />
                </Link>
              ) : (
                <Button
                  disabled={
                    !acknowledged ||
                    !connection ||
                    (exam.attemptControls?.requireFullscreen && !document.fullscreenEnabled) ||
                    !isOpen(exam) ||
                    exam.attemptsUsed >= exam.maxAttempts
                  }
                  busy={busy}
                  onClick={start}
                >
                  Begin examination <ArrowRight size={17} />
                </Button>
              )}
              <p className="muted small">
                Readiness is valid for 30 minutes. Beginning an attempt starts your timer.
              </p>
            </section>
            <aside className="panel exam-summary">
              <BookOpen size={28} strokeWidth={1.3} />
              <h2>Examination details</h2>
              <dl>
                <div>
                  <dt>Duration</dt>
                  <dd>{exam.durationMinutes} minutes</dd>
                </div>
                <div>
                  <dt>Questions</dt>
                  <dd>{exam.questionCount}</dd>
                </div>
                <div>
                  <dt>Attempts used</dt>
                  <dd>
                    {exam.attemptsUsed} of {exam.maxAttempts}
                  </dd>
                </div>
                <div>
                  <dt>Opens</dt>
                  <dd>{formatDate(exam.opensAt)}</dd>
                </div>
                <div>
                  <dt>Closes</dt>
                  <dd>{formatDate(exam.closesAt)}</dd>
                </div>
              </dl>
              <p className="muted small">
                Your attempt ends at the earlier of your time limit or the examination closing time.
              </p>
            </aside>
          </div>
        )
      ) : resultsOnly ? (
        <div className="exam-grid">
          {data.flatMap((e) =>
            e.attempts
              .filter((a) => a.status === 'submitted')
              .map((a) => (
                <article className="panel exam-card" key={a.id}>
                  <div className="exam-card-top">
                    <FileText size={22} />
                    <Badge tone={e.resultsReleased ? 'teal' : 'amber'}>
                      {e.resultsReleased ? 'Released' : 'Awaiting release'}
                    </Badge>
                  </div>
                  <h2>{e.title}</h2>
                  <p className="muted">
                    Attempt {a.number} · Submitted {formatDate(a.submittedAt)}
                  </p>
                  {e.resultsReleased ? (
                    <Link className="inline-link" to={`/student/results/${a.id}`}>
                      View result <ArrowRight size={16} />
                    </Link>
                  ) : (
                    <p className="small muted">
                      Your administrator will release the result after the exam closes.
                    </p>
                  )}
                </article>
              )),
          )}
          {!data.some((e) => e.attempts.some((a) => a.status === 'submitted')) && (
            <Empty title="Your results will appear here">
              Complete an assigned examination to get started.
            </Empty>
          )}
        </div>
      ) : (
        <>
          <section className="student-intro">
            <div>
              <p className="eyebrow">PREPARE. FOCUS. PROGRESS.</p>
              <h2>Every assessment is a step forward.</h2>
              <p>Review your schedule and instructions, then begin when you are ready.</p>
            </div>
            <BookOpen size={52} strokeWidth={1} />
          </section>
          <div className="section-heading">
            <h2>Assigned examinations</h2>
            <span className="muted small">
              {list.pagination?.total || 0} examination{list.pagination?.total !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="exam-grid">
            {data.map((e) => (
              <article key={e.id} className="panel exam-card">
                <div className="exam-card-top">
                  <span className="exam-icon">
                    <FileText size={21} />
                  </span>
                  <Badge tone={isOpen(e) ? 'teal' : 'neutral'}>{status(e)}</Badge>
                </div>
                <h2>{e.title}</h2>
                <div className="exam-meta">
                  <span>
                    <Clock3 size={16} />
                    {e.durationMinutes} minutes
                  </span>
                  <span>
                    <FileText size={16} />
                    {e.questionCount} questions
                  </span>
                </div>
                <p className="exam-date">
                  <CalendarDays size={16} />
                  <span>
                    {formatDate(e.opensAt)}
                    <small>Closes {formatDate(e.closesAt)}</small>
                  </span>
                </p>
                <div className="exam-card-footer">
                  <small>
                    {e.attemptsUsed} / {e.maxAttempts} attempts used
                  </small>
                  <Link className="inline-link" to={`/student/exams/${e.id}`}>
                    {e.attempts.some((a) => a.status === 'active') ? 'Resume exam' : 'View details'}{' '}
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </article>
            ))}
            {!data.length && (
              <Empty title="A little room to prepare">
                Your administrator has not assigned an examination yet. Check back when your
                schedule is available.
              </Empty>
            )}
          </div>
        </>
      )}
      {!detail && (
        <Pagination
          label="Examinations"
          pagination={list.pagination}
          loading={loading}
          onChange={list.update}
        />
      )}
    </>
  );
}
