import { useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Clock3, BookOpen } from 'lucide-react';
import { Brand, Button, Input, ErrorMessage } from '../../components/ui';
import { useAuth } from './AuthContext';
export default function Login({ portal = 'student' }) {
  const { user, login, error: authError, sessionExpired } = useAuth();
  const location = useLocation();
  const destination = (role) =>
    location.state?.from?.startsWith(`/${role}/`) && !location.state.from.includes('login')
      ? location.state.from
      : `/${role}`;
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={destination(user.role)} replace />;
  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fields = new FormData(e.currentTarget);
    try {
      const u = await login({
        email: fields.get('email'),
        password: fields.get('password'),
        portal,
      });
      navigate(destination(u.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <Brand light />
        <div className="login-copy">
          <p className="eyebrow">KNOWLEDGE, THOUGHTFULLY ASSESSED.</p>
          <h1>
            A clear path
            <br />
            from learning
            <br />
            to achievement.
          </h1>
          <p>
            A considered space for examinations.
            <br />
            Built around focus, fairness, and your next step.
          </p>
          <div className="story-rule" />
          <div className="story-features">
            <span>
              <BookOpen size={18} /> Purposeful assessment
            </span>
            <span>
              <ShieldCheck size={18} /> Accountable by design
            </span>
            <span>
              <Clock3 size={18} /> A reliable exam experience
            </span>
          </div>
        </div>
        <footer>
          EXAMLEDGER <span>Online Quiz Management System</span>
        </footer>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <p className="eyebrow">{portal.toUpperCase()} PORTAL</p>
          <h2>Welcome back.</h2>
          <p className="muted">
            Sign in to your {portal === 'admin' ? 'assessment workspace' : 'academic workspace'}.
          </p>
          <ErrorMessage error={error || authError} />
          {sessionExpired && (
            <p className="notice" role="status">
              Your session expired. Sign in again to continue. Answers already saved are preserved;
              your examination deadline has not changed.
            </p>
          )}
          <form onSubmit={submit}>
            <Input
              label="Email address"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@institution.edu"
              required
              maxLength={254}
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              maxLength={128}
            />
            <Button busy={busy} type="submit" className="w-full">
              Sign in to {portal} portal <ArrowRight size={17} />
            </Button>
          </form>
          <p className="login-help">
            <Link to="/forgot-password">Forgot your password?</Link> Need an invitation? Contact
            your exam administrator.
          </p>
          <div className="portal-switch">
            {portal === 'student' ? 'Managing examinations?' : 'Here to take an exam?'}{' '}
            <Link to={portal === 'student' ? '/admin/login' : '/login'}>
              {portal === 'student' ? 'Admin sign in' : 'Student sign in'} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <p className="login-bottom">Focused assessment. Meaningful progress.</p>
      </section>
    </main>
  );
}
