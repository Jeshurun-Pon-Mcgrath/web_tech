import { useState } from 'react';
import { Upload, Download, History } from 'lucide-react';
import { api, post } from '../../lib/api';
import { useResource } from '../../hooks/useResource';
import { Button, Input, Select, ErrorMessage, Modal, Table, Loading } from '../../components/ui';
import Pagination from '../../components/ui/Pagination';
async function download(path, body) {
  const file = body ? await post(path, body) : await api(path);
  const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function QuestionTools({ selection, clearSelection, refresh }) {
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [summary, setSummary] = useState(null);
  const [tags, setTags] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  function open(kind) {
    setDialog(kind);
    setError(null);
    setSummary(null);
    setPreview(null);
    setDecisions({});
  }
  async function upload(event) {
    const file = event.target.files[0];
    if (!file) return;
    setPreview(null);
    setSummary(null);
    await run(async () => {
      if (file.size > 262144) throw new Error('Choose a file no larger than 256 KiB.');
      if (!/\.(json|csv)$/i.test(file.name)) throw new Error('Choose a .json or .csv file.');
      setProgress('Reading file…');
      const content = await file.text();
      setProgress('Validating file on the server…');
      const result = await post('/admin/question-imports/preview', {
        format: file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json',
        content,
      });
      setPreview(result);
      setDecisions(
        Object.fromEntries(
          result.rows.map((row) => [
            row.row,
            row.existingDuplicates?.length || row.duplicateRows?.length ? '' : 'import',
          ]),
        ),
      );
    });
  }
  async function commit() {
    await run(async () => {
      setProgress('Committing the validated batch…');
      const result = await post(`/admin/question-imports/${preview.id}/commit`, {
        digest: preview.digest,
        decisions: preview.rows.map((row) => ({ row: row.row, action: decisions[row.row] })),
      });
      await refresh();
      setSummary(result);
    });
  }
  async function bulk() {
    await run(async () => {
      const result = await post('/admin/questions/bulk', {
        items: selection,
        operation: dialog === 'tag' ? 'tag' : 'archive',
        ...(dialog === 'tag'
          ? {
              tags: tags
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : { archived: dialog === 'archive' }),
      });
      clearSelection();
      await refresh();
      setDialog(null);
      setNotice(`${result.updated} question versions saved.`);
    });
  }
  return (
    <>
      <div className="panel-toolbar question-tools">
        <Button variant="secondary" onClick={() => open('import')}>
          <Upload size={16} />
          Import questions
        </Button>
        <Button variant="text" onClick={() => open('audit')}>
          <History size={16} />
          Import history
        </Button>
        <span>{selection.length} selected (maximum 100)</span>
        <Button
          variant="text"
          disabled={!selection.length || busy}
          onClick={() =>
            run(() =>
              download('/admin/questions/export', {
                format: 'json',
                ids: selection.map((item) => item.id),
              }),
            )
          }
        >
          <Download size={16} />
          Export JSON
        </Button>
        <Button
          variant="text"
          disabled={!selection.length || busy}
          onClick={() =>
            run(() =>
              download('/admin/questions/export', {
                format: 'csv',
                ids: selection.map((item) => item.id),
              }),
            )
          }
        >
          Export CSV
        </Button>
        <Button variant="text" disabled={!selection.length} onClick={() => open('tag')}>
          Tag selected
        </Button>
        <Button variant="text" disabled={!selection.length} onClick={() => open('archive')}>
          Archive selected
        </Button>
        <Button variant="text" disabled={!selection.length} onClick={() => open('unarchive')}>
          Unarchive selected
        </Button>
        <Button variant="text" onClick={clearSelection} disabled={!selection.length}>
          Clear selection
        </Button>
      </div>
      {notice && (
        <p className="notice notice-success" role="status">
          {notice}
        </p>
      )}
      {!dialog && <ErrorMessage error={error} />}
      {dialog === 'import' && (
        <Modal title="Import questions" onClose={() => !busy && setDialog(null)}>
          <div className="editor-form">
            <p>
              Version 1 JSON or RFC 4180 CSV; 1–100 rows, at most 256 KiB. Subject codes must
              already exist. Imported text is displayed as text, never HTML.
            </p>
            <div className="row-actions">
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => run(() => download('/admin/questions/templates/json'))}
              >
                Download JSON template
              </Button>
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => run(() => download('/admin/questions/templates/csv'))}
              >
                Download CSV template
              </Button>
            </div>
            <Input
              label="Question import file"
              type="file"
              accept=".json,.csv,application/json,text/csv"
              disabled={busy}
              onChange={upload}
            />
            <ErrorMessage error={error} />
            {progress && <p role="status">{progress}</p>}
            {summary ? (
              <section className="notice notice-success" role="status">
                <div>
                  <h3>Import committed</h3>
                  <p>
                    {summary.imported} imported; {summary.skipped} skipped. Audit receipt:{' '}
                    {summary.batchId}. Retrying this exact batch cannot create a second import.
                  </p>
                </div>
              </section>
            ) : (
              preview && (
                <>
                  <p role="status">
                    {preview.validRows} valid rows; {preview.errorRows} invalid rows.{' '}
                    {preview.valid
                      ? 'Review every decision before confirming.'
                      : 'Nothing can be imported until the entire file is valid.'}
                  </p>
                  {preview.rows.map((row) => (
                    <section className="question-preview" key={row.row}>
                      <h3>
                        Row {row.row}
                        {row.data ? ` — ${row.data.prompt.slice(0, 100)}` : ''}
                      </h3>
                      {row.errors.map((issue, index) => (
                        <p className="text-warning" key={index}>
                          {issue.field}: {issue.message}
                        </p>
                      ))}
                      {!!(row.existingDuplicates?.length || row.duplicateRows?.length) && (
                        <p className="notice notice-warning">
                          Duplicate content: {row.existingDuplicates.length} existing question(s);
                          other file rows: {row.duplicateRows.join(', ') || 'none'}. Explicitly
                          choose import or skip.
                        </p>
                      )}
                      {row.data && (
                        <details>
                          <summary>Inspect validated question</summary>
                          <pre className="data-preview">{JSON.stringify(row.data, null, 2)}</pre>
                        </details>
                      )}
                      {preview.valid && (
                        <Select
                          label={`Decision for row ${row.row}`}
                          value={decisions[row.row] || ''}
                          onChange={(event) =>
                            setDecisions((current) => ({
                              ...current,
                              [row.row]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Choose explicitly</option>
                          <option value="import">Import a new question</option>
                          <option value="skip">Skip this row</option>
                        </Select>
                      )}
                    </section>
                  ))}
                  {preview.valid && (
                    <Button
                      busy={busy}
                      disabled={preview.rows.some((row) => !decisions[row.row])}
                      onClick={commit}
                    >
                      Confirm import decisions
                    </Button>
                  )}
                </>
              )
            )}
          </div>
        </Modal>
      )}
      {['tag', 'archive', 'unarchive'].includes(dialog) && (
        <Modal title="Confirm bulk question changes" onClose={() => !busy && setDialog(null)}>
          <div className="editor-form">
            <p>
              {selection.length} selected questions will receive new versions. Published snapshots
              and historical attempts remain unchanged. Any version conflict rejects the entire
              batch.
            </p>
            {dialog === 'tag' && (
              <Input
                label="Tags to add (comma-separated)"
                value={tags}
                maxLength={500}
                onChange={(event) => setTags(event.target.value)}
              />
            )}
            <ErrorMessage error={error} />
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button busy={busy} onClick={bulk}>
                Confirm {dialog}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === 'audit' && (
        <Modal title="Question import audit" onClose={() => setDialog(null)}>
          <ImportAudit />
        </Modal>
      )}
    </>
  );
}
function ImportAudit() {
  const resource = useResource('/admin/question-imports');
  if (resource.loading) return <Loading />;
  return (
    <>
      <ErrorMessage error={resource.error} />
      <Table
        rows={resource.data?.items || []}
        columns={[
          { key: 'administrator', label: 'Administrator' },
          {
            key: 'committedAt',
            label: 'Committed',
            render: (row) => new Date(row.committedAt).toLocaleString(),
          },
          { key: 'imported', label: 'Imported' },
          { key: 'skipped', label: 'Skipped' },
        ]}
        empty="No batches have been committed."
      />
    </>
  );
}
export function QuestionHistory({ question, onClose }) {
  const [page, setPage] = useState(1);
  const resource = useResource(`/admin/questions/${question.id}/history?page=${page}`);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const current = resource.data?.currentVersion || question.revision;
  async function compare() {
    setBusy(true);
    setError(null);
    try {
      setComparison(
        await api(
          `/admin/questions/${question.id}/compare?from=${from || Math.max(1, current - 1)}&to=${to || current}`,
        ),
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Question version history" onClose={onClose}>
      <div className="editor-form">
        <p>{question.prompt}</p>
        <p>
          Current version {current}. Included in {resource.data?.publishedExamCount || 0} published
          definitions (pool eligibility does not imply selection in every variant).
        </p>
        <ErrorMessage error={error || resource.error} />
        <div className="form-grid">
          <Input
            label="Compare from version"
            type="number"
            min={1}
            max={current}
            value={from || Math.max(1, current - 1)}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="Compare to version"
            type="number"
            min={1}
            max={current}
            value={to || current}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button variant="secondary" busy={busy} onClick={compare}>
          Compare versions
        </Button>
        {comparison && (
          <section>
            <h3>Changed fields</h3>
            {comparison.changes.length ? (
              comparison.changes.map((change) => (
                <div className="question-preview" key={change.field}>
                  <strong>{change.field}</strong>
                  <pre className="data-preview">
                    {JSON.stringify({ before: change.before, after: change.after }, null, 2)}
                  </pre>
                </div>
              ))
            ) : (
              <p>No content changes between these versions.</p>
            )}
          </section>
        )}
        {resource.loading ? (
          <Loading />
        ) : (
          <>
            {resource.data?.legacyBaseline && (
              <p>Legacy version 1 is preserved on first edit; no earlier edit history exists.</p>
            )}
            {resource.data?.items.map((version) => (
              <details key={version.revision}>
                <summary>
                  Version {version.revision} — {version.reason} — {version.administrator}
                </summary>
                <pre className="data-preview">{JSON.stringify(version.snapshot, null, 2)}</pre>
              </details>
            ))}
            <Pagination
              label="Question versions"
              pagination={resource.data?.pagination}
              loading={resource.loading}
              pageSizes={false}
              onChange={(_field, value) => setPage(value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
