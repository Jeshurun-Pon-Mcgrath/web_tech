import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Layers3,
  BookOpen,
  ListChecks,
  FileText,
  ClipboardList,
  Timer,
  ChartNoAxesColumn,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  KeyRound,
  Mail,
} from 'lucide-react';
import { Brand, ErrorMessage } from '../components/ui';
import { useAuth } from '../features/auth/AuthContext';
import { useResource } from '../hooks/useResource';
const adminLinks = [
  ['', 'Overview', LayoutDashboard],
  ['students', 'Students', Users],
  ['cohorts', 'Cohorts', Layers3],
  ['subjects', 'Subjects', BookOpen],
  ['questions', 'Question bank', ListChecks],
  ['exams', 'Exams', FileText],
  ['assignments', 'Assignments', ClipboardList],
  ['attempts', 'Attempts', Timer],
  ['results', 'Results', ChartNoAxesColumn],
  ['integrity', 'Integrity reviews', ShieldCheck],
];
const studentLinks = [
  ['', 'My examinations', LayoutDashboard],
  ['results', 'My results', ChartNoAxesColumn],
];
export default function PortalLayout() {
  const { user, logout } = useAuth();
  const config = useResource('/auth/config');
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const links = [
    ...(user.role === 'admin' ? adminLinks : studentLinks),
    ['account', 'Account security', KeyRound],
    ...(user.role === 'admin' && config.data?.emailPreview
      ? [['email-previews', 'Email previews', Mail]]
      : []),
  ];
  const current =
    links.find(([path]) => location.pathname === `/${user.role}${path ? '/' + path : ''}`)?.[1] ||
    'Examination';
  const primary =
    user.role === 'admin'
      ? links.filter(([path]) =>
          ['', 'students', 'subjects', 'questions', 'exams', 'results'].includes(path),
        )
      : links;
  const secondary = links.filter((link) => !primary.includes(link));
  const secondaryActive = secondary.some(([path]) => location.pathname === `/admin/${path}`);
  const navigationLink = ([path, label, Icon]) => (
    <NavLink
      key={path}
      end
      to={`/${user.role}${path ? '/' + path : ''}`}
      onClick={() => setOpen(false)}
    >
      <Icon size={19} strokeWidth={1.7} />
      {label}
    </NavLink>
  );
  async function signOut() {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <p className="nav-label">
          {user.role === 'admin' ? 'ADMINISTRATION' : 'STUDENT WORKSPACE'}
        </p>
        <nav aria-label="Main navigation">
          {primary.map(navigationLink)}
          {secondary.length > 0 && (
            <details className="nav-more" open={secondaryActive || undefined}>
              <summary>
                <ChevronDown size={18} aria-hidden="true" />
                More tools
              </summary>
              {secondary.map(navigationLink)}
            </details>
          )}
        </nav>
        <div className="sidebar-footer">
          <button className="signout" onClick={signOut}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>{user.role === 'admin' ? 'Administration' : 'Student portal'}</span>
            <ChevronRight size={14} />
            <strong>{current}</strong>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              {user.name}
              <small>{user.role === 'admin' ? 'Administrator' : 'Student'}</small>
            </div>
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          <ErrorMessage error={error} />
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>ExamLedger</span>
          <span>A considered space for academic assessment.</span>
        </footer>
      </div>
    </div>
  );
}
