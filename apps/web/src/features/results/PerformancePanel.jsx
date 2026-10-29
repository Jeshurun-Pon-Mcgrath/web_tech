import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { usePagedResource } from '../../hooks/usePagedResource';
import { ResourceSelect } from '../../components/ui/ResourcePicker';
import Pagination from '../../components/ui/Pagination';
import { Button, ErrorMessage, Input, Select, Table } from '../../components/ui';
import { api, formatDate } from '../../lib/api';
const percent = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`);
export default function PerformancePanel({ admin = false }) {
  const base = admin ? '/admin/analytics' : '/student/performance';
  const list = usePagedResource(base, admin ? 'analytics' : 'performance');
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const data = list.data,
    summary = data?.summary;
  async function download(kind) {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams(list.query);
      if (admin) query.set('kind', kind);
      const file = await api(`${base}/export?${query}`);
      const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel padded performance-panel"
      aria-label={admin ? 'Exam and cohort analytics' : 'Released performance summary'}
      aria-busy={list.loading || undefined}
    >
      <div className="section-heading">
        <h2>{admin ? 'Exam and cohort analytics' : 'Released performance summary'}</h2>
        <Button variant="text" onClick={list.refresh}>
          <RefreshCw size={16} />
          Refresh summary
        </Button>
      </div>
      <div className="list-filters">
        {admin && (
          <>
            <ResourceSelect
              resource="exams"
              label="Analytics exam"
              value={list.query.get('exam')}
              onChange={(value) => list.update('exam', value)}
            />
            <ResourceSelect
              resource="cohorts"
              label="Analytics cohort"
              value={list.query.get('cohort')}
              onChange={(value) => list.update('cohort', value)}
            />
            <Select
              label="Retake handling"
              value={list.query.get('attempts') || 'latest'}
              onChange={(event) => list.update('attempts', event.target.value)}
            >
              <option value="latest">Latest finalized per assignment</option>
              <option value="all">All finalized attempts</option>
            </Select>
          </>
        )}
        <Input
          label="Analytical pass cutoff (%)"
          type="number"
          min={0}
          max={100}
          step={1}
          value={list.query.get('passPercent') || '40'}
          onChange={(event) => list.update('passPercent', event.target.value)}
        />
        <Select
          label="Performance sort"
          value={list.query.get('sort') || 'submittedAt'}
          onChange={(event) => list.update('sort', event.target.value)}
        >
          <option value="submittedAt">Submission time</option>
          <option value="percentage">Percentage</option>
        </Select>
        <Select
          label="Performance order"
          value={list.query.get('order') || 'desc'}
          onChange={(event) => list.update('order', event.target.value)}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </Select>
      </div>
      <ErrorMessage error={error || list.error} />
      {list.loading && <p role="status">Loading finalized performance…</p>}
      {summary && (
        <>
          <dl className="performance-metrics">
            <div>
              <dt>{admin ? 'Assigned exam/student pairs' : 'Released exam/student pairs'}</dt>
              <dd>{summary.assigned}</dd>
            </div>
            <div>
              <dt>Participation (started / assigned)</dt>
              <dd>
                {summary.participated} / {summary.assigned}
              </dd>
            </div>
            <div>
              <dt>Completion (any finalized / assigned)</dt>
              <dd>
                {summary.completed} / {summary.assigned}
              </dd>
            </div>
            <div>
              <dt>Selected score samples / all finalized attempts</dt>
              <dd>
                {summary.sampleSize} / {summary.finalizedAttempts}
              </dd>
            </div>
            <div>
              <dt>Mean / exact median percentage</dt>
              <dd>
                {percent(summary.mean)} / {percent(summary.median)}
              </dd>
            </div>
            <div>
              <dt>At least {summary.passPercent}% (passed / score samples)</dt>
              <dd>
                {summary.passed} / {summary.sampleSize} ({percent(summary.passRate)})
              </dd>
            </div>
          </dl>
          <p className="muted small">
            {data.policy.scores} {data.policy.multipleAttempts} {data.policy.cohort}
          </p>
          <details>
            <summary>Denominators and interpretation</summary>
            <p>{data.policy.denominators}</p>
            <p>{data.policy.pass}</p>
          </details>
          <Table
            rows={data.distribution.map((row) => ({ ...row, id: row.band }))}
            columns={[
              { key: 'band', label: 'Score percentage band' },
              { key: 'count', label: 'Selected finalized samples' },
            ]}
          />
          <div className="section-heading">
            <h3>Finalized results</h3>
            <Button variant="secondary" busy={busy} onClick={() => download('results')}>
              <Download size={16} />
              Export this results page
            </Button>
          </div>
          <Table
            rows={list.items}
            empty="No eligible finalized results match these filters."
            columns={[
              { key: 'exam', label: 'Exam' },
              ...(admin ? [{ key: 'student', label: 'Student' }] : []),
              { key: 'number', label: 'Attempt' },
              {
                key: 'score',
                label: 'Score / maximum',
                render: (row) => `${row.score} / ${row.maxScore}`,
              },
              { key: 'percentage', label: 'Percentage', render: (row) => percent(row.percentage) },
              {
                key: 'submittedAt',
                label: 'Submitted',
                render: (row) => formatDate(row.submittedAt),
              },
              {
                key: 'released',
                label: 'Release',
                render: (row) => (row.released ? 'Released' : 'Administrator only'),
              },
              ...(!admin
                ? [
                    {
                      key: 'view',
                      label: 'Review / print',
                      render: (row) => (
                        <Link className="inline-link" to={`/student/results/${row.id}`}>
                          Released result
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <Pagination
            label="Performance results"
            pagination={list.pagination}
            loading={list.loading}
            onChange={list.update}
          />
          {admin && (
            <>
              <div className="section-heading">
                <h3>Per-question exact-set accuracy</h3>
                <Button variant="secondary" busy={busy} onClick={() => download('questions')}>
                  Export this question page
                </Button>
              </div>
              <p className="small muted">
                Each denominator counts selected finalized variants containing that exam/question
                version; blanks are incorrect. No answer keys are exported.
              </p>
              <Table
                rows={data.questions.items}
                empty="No finalized question samples."
                columns={[
                  { key: 'exam', label: 'Exam' },
                  { key: 'prompt', label: 'Frozen question' },
                  { key: 'revision', label: 'Version' },
                  { key: 'sampleSize', label: 'Samples' },
                  { key: 'correct', label: 'Correct' },
                  { key: 'accuracy', label: 'Accuracy', render: (row) => percent(row.accuracy) },
                ]}
              />
              <Pagination
                label="Question accuracy"
                pagination={data.questions.pagination}
                loading={list.loading}
                pageSizes={false}
                onChange={(_field, value) => list.update('questionPage', value)}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
