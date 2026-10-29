import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, ErrorMessage, Modal, PageHeading } from '../../components/ui';
import { post } from '../../lib/api';
import { useAuth } from './AuthContext';
export default function AccountSecurity() {
  const { clearUser, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function change(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError(null);
    setMessage('');
    if (values.get('newPassword') !== values.get('confirmation')) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await post('/auth/change-password', {
        currentPassword: values.get('currentPassword'),
        newPassword: values.get('newPassword'),
      });
      form.reset();
      setMessage('Password changed. This session was rotated; other sessions were signed out.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function logoutAll() {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/logout-all');
      clearUser();
      navigate(user.role === 'admin' ? '/admin/login' : '/login', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR ACCOUNT"
        title="Account security"
        description="Manage your password and signed-in sessions."
      />
      <section className="panel padded security-card">
        <ErrorMessage error={error} />
        {message && (
          <p className="notice notice-success" role="status">
            {message}
          </p>
        )}
        <form className="editor-form" onSubmit={change}>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={user.email}
            readOnly
            className="sr-only"
            tabIndex={-1}
            aria-label="Account email"
          />
          <Input
            label="Current password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
          <Input
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
          <Input
            label="Confirm new password"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
          <Button type="submit" busy={busy}>
            Change password
          </Button>
        </form>
        <h2>Signed-in sessions</h2>
        <p>
          Sign out every device, including this one. Saved exam answers and original deadlines are
          retained.
        </p>
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Sign out all sessions
        </Button>
      </section>
      {confirm && (
        <Modal title="Sign out all sessions?" onClose={() => setConfirm(false)}>
          <p>You will need to sign in again. Examination timers continue.</p>
          <ErrorMessage error={error} />
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button busy={busy} onClick={logoutAll}>
              Confirm sign out
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
