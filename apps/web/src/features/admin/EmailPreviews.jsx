import { useState } from 'react';
import { useResource } from '../../hooks/useResource';
import { api, formatDate, post } from '../../lib/api';
import { Button, ErrorMessage, Modal, PageHeading, Table, Loading } from '../../components/ui';
export default function EmailPreviews() {
  const resource = useResource('/admin/email-previews');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function open(row) {
    setError(null);
    setBusy(true);
    try {
      setMessage(await api(`/admin/email-previews/${row.id}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (resource.loading && !resource.data) return <Loading />;
  return (
    <>
      <PageHeading
        eyebrow="LOCAL DEVELOPMENT ONLY"
        title="Email previews"
        description="Latest 50 delivery records. No real email is sent in preview mode. Links are private and single-use."
        action={
          <Button variant="secondary" onClick={resource.refresh}>
            Refresh
          </Button>
        }
      />
      <ErrorMessage error={error || resource.error} />
      <section className="panel">
        <Table
          rows={resource.data?.items || []}
          columns={[
            { key: 'recipient', label: 'Recipient' },
            { key: 'purpose', label: 'Purpose' },
            { key: 'status', label: 'Delivery status' },
            { key: 'attempts', label: 'Delivery attempts' },
            { key: 'createdAt', label: 'Created', render: (row) => formatDate(row.createdAt) },
            {
              key: 'action',
              label: 'Preview',
              render: (row) => (
                <div className="row-actions">
                  <Button variant="text" busy={busy} onClick={() => open(row)}>
                    View email
                  </Button>
                  {row.status === 'failed' && (
                    <Button
                      variant="text"
                      busy={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await post(`/admin/email-deliveries/${row.id}/retry`);
                          await resource.refresh();
                        } catch (err) {
                          setError(err);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Retry delivery
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          empty="No invitation or recovery messages have been queued."
        />
      </section>
      {message && (
        <Modal title={message.subject} onClose={() => setMessage(null)}>
          <p className="notice">Private local preview. Do not share or screenshot this link.</p>
          <pre className="email-preview">{message.text}</pre>
          <a
            className="inline-link"
            href={message.text.match(/https?:\/\/\S+/)?.[0]}
            rel="noreferrer"
            target="_blank"
          >
            Open account link
          </a>
        </Modal>
      )}
    </>
  );
}
