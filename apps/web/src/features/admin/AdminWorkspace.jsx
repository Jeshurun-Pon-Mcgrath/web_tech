import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Plus,
  Search,
  Users,
  FileText,
  ListChecks,
  Timer,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { useResource } from '../../hooks/useResource';
import { usePagedResource } from '../../hooks/usePagedResource';
import Pagination from '../../components/ui/Pagination';
import ListFilters from './ListFilters';
import {
  Badge,
  Button,
  ErrorMessage,
  Loading,
  Modal,
  PageHeading,
  Select,
  Table,
  Textarea,
} from '../../components/ui';
import { api, formatDate, post, put } from '../../lib/api';
import { useAuth } from '../auth/AuthContext';
import AdminEditor from './AdminEditor';
import QuestionTools, { QuestionHistory } from './QuestionTools';
import { PublicationReview } from './ExamControls';
import PerformancePanel from '../results/PerformancePanel';
const titles = {
  overview: ['Assessment overview', 'A clear view of your academic assessment workspace.'],
  students: ['Students', 'Manage student access and cohort membership.'],
  cohorts: ['Cohorts', 'Organize students into academic groups.'],
  subjects: ['Subjects', 'Define the subjects at the heart of your assessments.'],
  questions: ['Question bank', 'Write, review, and maintain your assessment material.'],
  exams: ['Examinations', 'From first draft to final result, manage every examination.'],
  assignments: ['Assignments', 'Keep track of who has been invited to each examination.'],
  attempts: ['Exam attempts', 'Follow examination progress and submission records.'],
  results: ['Results & release', 'Review scores and release results when the exam has closed.'],
  integrity: ['Integrity reviews', 'Review contextual signals with care and human judgment.'],
};
const singular = {
  students: 'student',
  cohorts: 'cohort',
  subjects: 'subject',
  questions: 'question',
  exams: 'exam',
};
export default function AdminWorkspace({ section }) {
  const catalog = useResource(section === 'overview' ? '/admin/overview' : null);
  const list = usePagedResource(
    section === 'overview' ? null : `/admin/${section === 'results' ? 'exams' : section}`,
  );
  const attemptData = usePagedResource(
    section === 'results' ? '/admin/attempts' : null,
    'scores',
    'status=submitted',
  );
  const assignments = list;
  const { user } = useAuth();
  const [editor, setEditor] = useState(null);
  const search = list.search;
  const setSearch = list.setSearch;
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [review, setReview] = useState(null);
  const [selection, setSelection] = useState([]);
  const [questionHistory, setQuestionHistory] = useState(null);
  const [publication, setPublication] = useState(null);
  const [eventType, setEventType] = useState('');
  const c =
    section !== 'overview'
      ? { exams: list.items }
      : catalog.data
        ? { ...catalog.data, exams: section === 'overview' ? catalog.data.recentExams : list.items }
        : null;
  async function refresh() {
    await Promise.all([catalog.refresh(), attemptData.refresh(), list.refresh()]);
  }
  async function action(path, message, body = {}) {
    setBusy(true);
    setError(null);
    try {
      const result = await post(path, body);
      await refresh();
      setNotice(
        result.closing
          ? `${message} ${result.remaining} attempts are still being finalized; refresh to check progress.`
          : message,
      );
      setConfirm(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function openReview(row) {
    setError(null);
    setBusy(true);
    setEventType('');
    try {
      const detail = await api(`/admin/attempts/${row.id}/integrity`);
      setReview({ ...detail, row });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function reviewHistoryPage(page) {
    const id = review.id;
    setBusy(true);
    setError(null);
    try {
      const detail = await api(`/admin/attempts/${id}/integrity?historyPage=${page}`);
      setReview((current) =>
        current?.id === id ? { ...current, history: detail.history } : current,
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  if (section === 'overview' && catalog.loading && !catalog.data) return <Loading />;
  if (!c)
    return (
      <>
        <ErrorMessage error={catalog.error} />
        <Button onClick={catalog.refresh}>Try again</Button>
      </>
    );
  const editAction = (row) => (
    <Button variant="text" onClick={() => setEditor({ type: section, record: row })}>
      Edit <ChevronRight size={14} />
    </Button>
  );
  const subjectName = () => 'Subject';
  const rows = list.items;
  const attempts = section === 'results' ? attemptData.items : list.items;
  let columns = [];
  if (section === 'students')
    columns = [
      {
        key: 'name',
        label: 'Student',
        render: (s) => (
          <div className="person-cell">
            <span className="avatar small-avatar">{s.name[0]}</span>
            <div>
              <strong>{s.name}</strong>
              <small>{s.email}</small>
            </div>
          </div>
        ),
      },
      { key: 'cohort', label: 'Cohort', render: (s) => s.cohortName || 'Unassigned' },
      {
        key: 'active',
        label: 'Status',
        render: (s) => (
          <Badge tone={s.status === 'pending' ? 'amber' : s.active ? 'teal' : 'danger'}>
            {s.status || (s.active ? 'active' : 'deactivated')}
          </Badge>
        ),
      },
      {
        key: 'actions',
        label: 'Manage',
        render: (student) => (
          <div className="row-actions">
            {editAction(student)}
            {student.status === 'pending' && (
              <>
                <Button
                  variant="text"
                  onClick={() =>
                    setConfirm({
                      title: 'Resend invitation?',
                      description:
                        'The earlier link will become invalid. Resends require a one-minute wait.',
                      path: `/admin/students/${student.id}/invitation/resend`,
                      message: 'A replacement invitation was queued.',
                    })
                  }
                >
                  Resend invitation
                </Button>
                <Button
                  variant="text"
                  onClick={() =>
                    setConfirm({
                      title: 'Revoke invitation?',
                      description:
                        'The student remains pending, but cannot use the current invitation.',
                      path: `/admin/students/${student.id}/invitation/revoke`,
                      message: 'Invitation revoked.',
                    })
                  }
                >
                  Revoke invitation
                </Button>
              </>
            )}
            {student.status !== 'deactivated' && (
              <Button
                variant="text"
                onClick={() =>
                  setConfirm({
                    title: 'Deactivate student?',
                    description:
                      'Sessions and account links will be revoked. Historical examination records remain unchanged.',
                    path: `/admin/students/${student.id}/deactivate`,
                    message: 'Student deactivated.',
                  })
                }
              >
                Deactivate
              </Button>
            )}
          </div>
        ),
      },
    ];
  if (section === 'cohorts')
    columns = [
      { key: 'name', label: 'Cohort', render: (r) => <strong>{r.name}</strong> },
      { key: 'description', label: 'Description' },
      {
        key: 'count',
        label: 'Students',
        render: (r) => r.studentCount ?? '—',
      },
      { key: 'actions', label: 'Manage', render: editAction },
    ];
  if (section === 'subjects')
    columns = [
      { key: 'code', label: 'Code', render: (r) => <span className="subject-code">{r.code}</span> },
      { key: 'name', label: 'Subject', render: (r) => <strong>{r.name}</strong> },
      { key: 'description', label: 'Description' },
      { key: 'actions', label: 'Manage', render: editAction },
    ];
  if (section === 'questions')
    columns = [
      {
        key: 'selection',
        label: (
          <input
            type="checkbox"
            aria-label="Select questions on this page"
            checked={
              rows.length > 0 && rows.every((row) => selection.some((item) => item.id === row.id))
            }
            onChange={(event) =>
              setSelection((current) =>
                event.target.checked
                  ? [
                      ...current.filter((item) => !rows.some((row) => row.id === item.id)),
                      ...rows.map((row) => ({ id: row.id, expectedVersion: row.revision })),
                    ].slice(0, 100)
                  : current.filter((item) => !rows.some((row) => row.id === item.id)),
              )
            }
          />
        ),
        render: (question) => (
          <input
            type="checkbox"
            aria-label={`Select question ${question.prompt}`}
            checked={selection.some((item) => item.id === question.id)}
            onChange={(event) =>
              setSelection((current) =>
                event.target.checked
                  ? [...current, { id: question.id, expectedVersion: question.revision }].slice(
                      0,
                      100,
                    )
                  : current.filter((item) => item.id !== question.id),
              )
            }
          />
        ),
      },
      {
        key: 'prompt',
        label: 'Question',
        render: (r) => (
          <div className="question-cell">
            <strong>{r.prompt}</strong>
            <small>
              {r.choices.length} options · {r.points} points
            </small>
          </div>
        ),
      },
      { key: 'subject', label: 'Subject', render: (r) => r.subjectName || subjectName(r.subject) },
      {
        key: 'archived',
        label: 'Status',
        render: (r) => (
          <Badge tone={r.archived ? 'neutral' : 'teal'}>
            {r.archived ? 'Archived' : 'Available'}
          </Badge>
        ),
      },
      {
        key: 'organization',
        label: 'Organization',
        render: (question) => (
          <span>
            {question.topic || 'No topic'} / {question.difficulty}
            <small>
              v{question.revision}; {question.tags.join(', ') || 'No tags'};{' '}
              {question.publishedExamCount} published definitions
            </small>
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Manage',
        render: (question) => (
          <div className="row-actions">
            {editAction(question)}
            <Button variant="text" onClick={() => setQuestionHistory(question)}>
              Version history
            </Button>
          </div>
        ),
      },
    ];
  const examColumns = [
    {
      key: 'title',
      label: 'Examination',
      render: (e) => (
        <div>
          <strong>{e.title}</strong>
          <small>
            {e.subjectName || subjectName(e.subject)} · {e.questionCount} questions ·{' '}
            {e.durationMinutes} min
          </small>
        </div>
      ),
    },
    {
      key: 'schedule',
      label: 'Schedule',
      render: (e) => (
        <div className="small">
          {formatDate(e.opensAt)}
          <small>to {formatDate(e.closesAt)}</small>
          <small>
            Schedule label: {e.timeZone}; displayed in{' '}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </small>
          {e.closedAt && (
            <small>
              Closed {formatDate(e.closedAt)} by {e.closedBy}: {e.closeReason}
            </small>
          )}
          {e.archivedAt && (
            <small>
              Archived {formatDate(e.archivedAt)}: {e.archiveReason}
            </small>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (e) => (
        <Badge tone={e.status === 'draft' ? 'amber' : 'teal'}>
          {e.archivedAt
            ? 'Archived'
            : e.closedAt
              ? 'Closed by administrator'
              : e.status === 'draft'
                ? 'Draft'
                : new Date(e.closesAt) < new Date()
                  ? 'Closed'
                  : 'Published'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Manage',
      render: (e) => (
        <div className="row-actions">
          {section === 'results' ? (
            e.resultsReleased ? (
              <Badge tone="teal">Released</Badge>
            ) : (
              <Button
                variant="secondary"
                disabled={
                  e.status !== 'published' || (!e.closedAt && new Date(e.closesAt) > new Date())
                }
                onClick={() =>
                  setConfirm({
                    title: 'Release results?',
                    description:
                      'Students will be able to see their scores, correct answers, and explanations.',
                    path: `/admin/exams/${e.id}/release`,
                    message: 'Results released to students.',
                  })
                }
              >
                Release results
              </Button>
            )
          ) : e.status === 'draft' && !e.archivedAt ? (
            <>
              <Button variant="text" onClick={() => setEditor({ type: 'exams', record: e })}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => setPublication(e)}>
                Publish
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              disabled={
                Boolean(e.closedAt || e.archivedAt) ||
                e.status !== 'published' ||
                new Date(e.closesAt) < new Date()
              }
              onClick={() => setEditor({ type: 'assign', record: e })}
            >
              Assign students
            </Button>
          )}
          {section === 'exams' && (
            <>
              <Button
                variant="text"
                onClick={() =>
                  setConfirm({
                    title: 'Duplicate into a new draft?',
                    description:
                      'Only authoring settings and question references are copied. Review current bank versions and schedule before publishing; assignments, attempts and results are not copied.',
                    path: `/admin/exams/${e.id}/duplicate`,
                    message: 'A new draft copy was created.',
                  })
                }
              >
                Duplicate draft
              </Button>
              {e.status === 'published' && !e.closedAt && !e.archivedAt && (
                <Button
                  variant="text"
                  onClick={() =>
                    setConfirm({
                      title: 'Close examination?',
                      description:
                        'New attempts will be blocked. Active attempts are finalized using saved responses; original schedules and deadlines are retained. This cannot be reopened.',
                      requiresReason: true,
                      reason: '',
                      path: `/admin/exams/${e.id}/close`,
                      message: 'Examination closed.',
                    })
                  }
                >
                  Close exam
                </Button>
              )}
              {!e.archivedAt && (
                <Button
                  variant="text"
                  disabled={
                    e.status === 'published' && !e.closedAt && new Date(e.closesAt) > new Date()
                  }
                  onClick={() =>
                    setConfirm({
                      title: 'Archive examination?',
                      description:
                        'This hides it from active administration when filtered, without deleting snapshots, assignments or historical results. Published exams must be closed and finalized first.',
                      requiresReason: true,
                      reason: '',
                      path: `/admin/exams/${e.id}/archive`,
                      message: 'Examination archived.',
                    })
                  }
                >
                  Archive exam
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];
  const attemptColumns = [
    {
      key: 'student',
      label: 'Student',
      render: (a) => (
        <div>
          <strong>{a.student?.name}</strong>
          <small>{a.student?.email}</small>
        </div>
      ),
    },
    {
      key: 'exam',
      label: 'Examination',
      render: (a) => (
        <div>
          {a.exam?.title}
          <small>Attempt {a.number}</small>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (a) => (
        <Badge tone={a.status === 'submitted' ? 'teal' : 'amber'}>
          {a.status === 'submitted'
            ? 'Submitted'
            : new Date(a.deadline) <= new Date()
              ? 'Finalizing'
              : 'In progress'}
        </Badge>
      ),
    },
    {
      key: 'score',
      label: 'Score',
      render: (a) => (a.status === 'submitted' ? `${a.score} / ${a.maxScore}` : '—'),
    },
    { key: 'submittedAt', label: 'Submitted', render: (a) => formatDate(a.submittedAt) },
  ];
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title={titles[section][0]}
        description={titles[section][1]}
        action={
          (section === 'overview' || singular[section]) && (
            <Button
              onClick={() => {
                setNotice('');
                setEditor({ type: section === 'overview' ? 'students' : section });
              }}
            >
              <Plus size={17} /> Add {section === 'overview' ? 'student' : singular[section]}
            </Button>
          )
        }
      />
      <ErrorMessage error={error || catalog.error || attemptData.error || list.error} />
      {notice && (
        <div className="notice notice-success" role="status">
          {notice}
        </div>
      )}
      {section === 'results' && <PerformancePanel admin />}
      {section === 'overview' ? (
        <>
          <section className="welcome-banner">
            <div>
              <p className="eyebrow">YOUR ASSESSMENT DESK</p>
              <h2>Good to see you, {user.name.split(' ')[0]}.</h2>
              <p>
                Make room for meaningful assessment.
                <br />
                Your students, examinations, and results, together.
              </p>
              <Link className="inline-link" to="/admin/exams">
                Manage examinations <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="banner-emblem">
              <BookOpen size={76} strokeWidth={0.8} />
              <span>EXAMLEDGER</span>
              <small>LEARNING · ASSESSMENT · PROGRESS</small>
            </div>
          </section>
          <div className="stats-grid">
            {[
              [Users, 'Active students', c.counts.activeStudents, 'students'],
              [FileText, 'Published exams', c.counts.publishedExams, 'exams'],
              [ListChecks, 'Available questions', c.counts.availableQuestions, 'questions'],
              [Timer, 'Submitted attempts', c.counts.submittedAttempts, 'attempts'],
            ].map(([Icon, label, count, path]) => (
              <Link key={label} to={`/admin/${path}`} className="stat-card">
                <div>
                  <span>{label}</span>
                  <Icon size={20} strokeWidth={1.5} />
                </div>
                <strong>{count}</strong>
                <small>
                  View records <ArrowUpRight size={14} />
                </small>
              </Link>
            ))}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recent examinations</h2>
                <p>Your latest assessment records.</p>
              </div>
              <Link className="inline-link" to="/admin/exams">
                View all <ArrowRightIcon />
              </Link>
            </div>
            <Table
              columns={examColumns.slice(0, 3)}
              rows={c.exams.slice(0, 5)}
              empty="Create a subject, add questions, then build your first examination."
            />
          </section>
          <div className="overview-bottom">
            <section className="panel getting-started">
              <p className="eyebrow">A SIMPLE WORKFLOW</p>
              <h2>From question to achievement.</h2>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <strong>Prepare your material</strong>
                    <p>Set up subjects and write questions.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Invite your students</strong>
                    <p>Publish an exam and assign a cohort.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Review and release</strong>
                    <p>Check submissions and share results.</p>
                  </div>
                </li>
              </ol>
            </section>
            <section className="integrity-note">
              <ShieldIcon />
              <p className="eyebrow">FAIR ASSESSMENT</p>
              <h2>Context before conclusions.</h2>
              <p>
                Connection changes and focus events can have ordinary explanations. Review them
                alongside the full attempt before making a decision.
              </p>
              <Link to="/admin/integrity" className="inline-link">
                Open integrity reviews <ArrowUpRight size={16} />
              </Link>
            </section>
          </div>
        </>
      ) : (
        <section className="panel" aria-busy={list.loading || undefined}>
          <div className="panel-toolbar">
            <div>
              <h2>{section === 'results' ? 'Examination results' : titles[section][0]}</h2>
              <p>
                {section === 'integrity'
                  ? 'Signals support review; they do not establish misconduct.'
                  : 'Records from your assessment workspace.'}
              </p>
            </div>
            <label className="search">
              <Search size={17} />
              <input
                aria-label="Search records"
                placeholder="Search records…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <Button variant="text" onClick={refresh}>
              Refresh
            </Button>
          </div>
          <ListFilters section={section} list={list} />
          {section === 'questions' && (
            <details className="advanced-question-tools">
              <summary>Advanced question tools: import, export and bulk actions</summary>
              <QuestionTools
                selection={selection}
                clearSelection={() => setSelection([])}
                refresh={refresh}
              />
            </details>
          )}
          {list.loading && (
            <div className="list-loading" role="status">
              Loading records…
            </div>
          )}
          {columns.length > 0 && (
            <Table
              columns={columns}
              rows={rows}
              empty={`No ${section} found. Add a ${singular[section]} to get started.`}
            />
          )}
          {(section === 'exams' || section === 'results') && (
            <Table columns={examColumns} rows={c.exams} />
          )}
          {section === 'assignments' && (
            <Table
              columns={[
                { key: 'student', label: 'Student', render: (a) => a.student?.name },
                { key: 'exam', label: 'Examination', render: (a) => a.exam?.title },
                { key: 'attemptsUsed', label: 'Attempts used' },
                {
                  key: 'ready',
                  label: 'Readiness recorded',
                  render: (a) => (a.ready ? 'Yes' : 'No'),
                },
              ]}
              rows={assignments.items}
              empty="Open a published exam to assign students or a cohort."
            />
          )}
          {section === 'attempts' && <Table columns={attemptColumns} rows={attempts} />}
          {section === 'results' && (
            <>
              <div className="panel-heading">
                <h2>Attempt scores</h2>
              </div>
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Search attempt scores"
                  placeholder="Search attempt scores…"
                  value={attemptData.search}
                  onChange={(e) => attemptData.setSearch(e.target.value)}
                />
              </label>
              <Table columns={attemptColumns} rows={attempts} />
              <Pagination
                pagination={attemptData.pagination}
                loading={attemptData.loading}
                label="Attempt scores"
                onChange={attemptData.update}
              />
            </>
          )}
          {section === 'integrity' && (
            <Table
              columns={[
                ...attemptColumns.slice(0, 2),
                { key: 'events', label: 'Signals', render: (a) => a.eventCount },
                {
                  key: 'reviewStatus',
                  label: 'Review',
                  render: (a) => (
                    <Badge
                      tone={
                        a.reviewStatus === 'flagged'
                          ? 'danger'
                          : a.reviewStatus === 'cleared'
                            ? 'teal'
                            : 'amber'
                      }
                    >
                      {a.reviewStatus}
                    </Badge>
                  ),
                },
                {
                  key: 'action',
                  label: 'Manage',
                  render: (a) => (
                    <Button variant="text" onClick={() => openReview(a)}>
                      Review <ChevronRight size={14} />
                    </Button>
                  ),
                },
              ]}
              rows={attempts}
            />
          )}
          <Pagination
            pagination={list.pagination}
            loading={list.loading}
            label={titles[section][0]}
            onChange={list.update}
          />
        </section>
      )}
      {editor && (
        <Modal
          title={
            editor.type === 'assign'
              ? 'Assign examination'
              : `${editor.record ? 'Edit' : 'Add'} ${singular[editor.type]}`
          }
          onClose={() => setEditor(null)}
        >
          <AdminEditor
            key={`${editor.type}-${editor.record?.id || 'new'}`}
            type={editor.type}
            record={editor.record}
            catalog={c}
            onCancel={() => setEditor(null)}
            onSaved={async () => {
              await refresh();
              setEditor(null);
              setNotice('Your changes have been saved.');
            }}
          />
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <div className="editor-form">
            <p>{confirm.description}</p>
            {confirm.requiresReason && (
              <Textarea
                label="Administrative reason"
                required
                maxLength={1000}
                value={confirm.reason}
                onChange={(event) =>
                  setConfirm((current) => ({ ...current, reason: event.target.value }))
                }
              />
            )}
            <ErrorMessage error={error} />
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                busy={busy}
                disabled={confirm.requiresReason && !confirm.reason.trim()}
                onClick={() =>
                  action(
                    confirm.path,
                    confirm.message,
                    confirm.requiresReason ? { reason: confirm.reason } : {},
                  )
                }
              >
                Confirm
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          title={`Integrity review · ${review.row.student?.name}`}
          onClose={() => setReview(null)}
        >
          <form
            className="editor-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await put(`/admin/attempts/${review.id}/review`, {
                  status: review.status,
                  note: review.note,
                  expectedReviewVersion: review.reviewVersion,
                });
                await refresh();
                setReview(null);
                setNotice('Integrity review saved.');
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="muted">
              Browser signals are incomplete and can have ordinary causes. A flag does not alter the
              student’s score.
            </p>
            <dl>
              <div>
                <dt>Started</dt>
                <dd>{formatDate(review.startedAt)}</dd>
              </div>
              <div>
                <dt>Original deadline</dt>
                <dd>{formatDate(review.deadline)}</dd>
              </div>
              <div>
                <dt>Finalized</dt>
                <dd>{formatDate(review.submittedAt)}</dd>
              </div>
            </dl>
            <Select
              label="Timeline signal filter"
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
            >
              <option value="">All received signals</option>
              {['visibility-hidden', 'offline', 'fullscreen-exit'].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
            <div className="event-log">
              {review.events.some((event) => !eventType || event.type === eventType) ? (
                review.events
                  .filter((event) => !eventType || event.type === eventType)
                  .map((event, i) => (
                    <div key={i}>
                      <strong>{event.type}</strong>
                      <small>{formatDate(event.receivedAt)}</small>
                    </div>
                  ))
              ) : (
                <p>
                  {eventType ? 'No received signals match this filter.' : 'No signals recorded.'}
                </p>
              )}
            </div>
            <p className="small muted">
              Server receipt times; at most 200 browser signals are retained. Missing or repeated
              signals are not proof of misconduct. Filtering does not change grades.
            </p>
            <h3>Decision audit</h3>
            {review.legacyDecision && (
              <p>
                Legacy decision: {review.legacyDecision.status} at{' '}
                {formatDate(review.legacyDecision.decidedAt)}. Older changes were not audited; this
                baseline will be preserved on the next save.
              </p>
            )}
            {review.history?.items.length ? (
              review.history.items.map((decision) => (
                <section className="question-preview" key={decision.id}>
                  <strong>
                    {decision.legacy
                      ? 'Legacy baseline'
                      : `${decision.previousStatus} → ${decision.status}`}{' '}
                    — {decision.reviewer}
                  </strong>
                  <small>{formatDate(decision.decidedAt)}</small>
                  <p className="instructions">{decision.note}</p>
                </section>
              ))
            ) : (
              <p>No audited decisions yet.</p>
            )}
            <Pagination
              label="Review decisions"
              pagination={review.history?.pagination}
              loading={busy}
              pageSizes={false}
              onChange={(_field, page) => reviewHistoryPage(page)}
            />
            <Select
              label="Review status"
              value={review.status}
              onChange={(e) => setReview((v) => ({ ...v, status: e.target.value }))}
            >
              <option value="pending">Pending</option>
              <option value="cleared">Cleared</option>
              <option value="flagged">Flagged</option>
            </Select>
            <Textarea
              label="Review note"
              required
              maxLength={4000}
              value={review.note}
              onChange={(e) => setReview((v) => ({ ...v, note: e.target.value }))}
            />
            <ErrorMessage error={error} />
            {error?.code === 'REVIEW_CONFLICT' && (
              <Button type="button" variant="secondary" onClick={() => openReview(review.row)}>
                Discard local note and reload decision
              </Button>
            )}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setReview(null)}>
                Cancel
              </Button>
              <Button busy={busy}>Save review</Button>
            </div>
          </form>
        </Modal>
      )}
      {questionHistory && (
        <QuestionHistory question={questionHistory} onClose={() => setQuestionHistory(null)} />
      )}
      {publication && (
        <PublicationReview
          exam={publication}
          onClose={() => setPublication(null)}
          onPublished={async () => {
            await refresh();
            setPublication(null);
            setNotice('Examination published.');
          }}
        />
      )}
    </>
  );
}
function ArrowRightIcon() {
  return <ChevronRight size={16} />;
}
function ShieldIcon() {
  return <BookOpen size={30} strokeWidth={1.3} aria-hidden="true" />;
}
