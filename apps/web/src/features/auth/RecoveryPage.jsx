import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Button, Input, ErrorMessage } from '../../components/ui';
import { post } from '../../lib/api';
import { useAuth } from './AuthContext';
export default function RecoveryPage({ mode }) {
  const { clearUser } = useAuth();
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') || '',
  );
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState(false);
  const forgot = mode === 'forgot';
  const purpose = mode === 'invitation' ? 'invitation' : 'reset';
  useEffect(() => {
    // Never put a bearer token into network URLs, local storage or referrers.
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (forgot) return;
    if (!/^[a-f\d]{64}$/.test(token)) {
      setError('This link is malformed or missing. Reopen the newest email or request a new link.');
      return;
    }
    let mounted = true;
    post('/auth/token-status', { token, purpose })
      .then(() => {
        if (mounted) setValid(true);
      })
      .catch((err) => {
        if (mounted) setError(err);
      });
    return () => {
      mounted = false;
    };
  }, [forgot, purpose, token]);
  async function submit(event) {
    event.preventDefault();
    setError(null);
    const fields = new FormData(event.currentTarget);
    if (!forgot && fields.get('password') !== fields.get('confirmation')) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const result = await post(
        forgot ? '/auth/forgot-password' : '/auth/redeem-token',
        forgot
          ? { email: fields.get('email') }
          : { token, purpose, password: fields.get('password') },
      );
      setMessage(result.message);
      if (!forgot) clearUser();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="recovery-shell">
      <section className="panel padded recovery-card">
        <Brand />
        <p className="eyebrow">ACCOUNT ACCESS</p>
        <h1>
          {forgot
            ? 'Forgot your password?'
            : purpose === 'invitation'
              ? 'Accept your invitation'
              : 'Set a new password'}
        </h1>
        <p className="muted">
          {forgot
            ? 'Enter your account email. Enrollment remains administrator-controlled.'
            : 'Use 12–128 characters. Password managers and paste are welcome. This link is consumed only when you submit.'}
        </p>
        <ErrorMessage error={error} />
        {message ? (
          <p className="notice notice-success" role="status">
            {message}
          </p>
        ) : (
          <form className="editor-form" onSubmit={submit}>
            {forgot ? (
              <Input
                label="Email address"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
              />
            ) : valid ? (
              <>
                <Input
                  label="New password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
                <Input
                  label="Confirm new password"
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </>
            ) : (
              !error && <p role="status">Checking your link…</p>
            )}
            {(forgot || valid) && (
              <Button type="submit" busy={busy}>
                {forgot
                  ? 'Send reset link'
                  : purpose === 'invitation'
                    ? 'Activate account'
                    : 'Reset password'}
              </Button>
            )}
          </form>
        )}
        <p>
          <Link className="inline-link" to="/login">
            Student sign in
          </Link>{' '}
          ·{' '}
          <Link className="inline-link" to="/admin/login">
            Admin sign in
          </Link>
        </p>
        {!forgot && (
          <p>
            <Link to="/forgot-password">Request a new reset link</Link>. For a new invitation,
            contact your administrator.
          </p>
        )}
      </section>
    </main>
  );
}
