import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../features/auth/AuthContext';
import Login from '../features/auth/Login';
import RecoveryPage from '../features/auth/RecoveryPage';
import AccountSecurity from '../features/auth/AccountSecurity';
import EmailPreviews from '../features/admin/EmailPreviews';
import PortalLayout from '../layouts/PortalLayout';
import AdminWorkspace from '../features/admin/AdminWorkspace';
import StudentWorkspace from '../features/student/StudentWorkspace';
import AttemptPage from '../features/attempts/AttemptPage';
import ResultPage from '../features/results/ResultPage';
import { Loading } from '../components/ui';
function Guard({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user)
    return (
      <Navigate
        to={role === 'admin' ? '/admin/login' : '/login'}
        replace
        state={{ from: location.pathname }}
      />
    );
  if (user.role !== role) return <Navigate to={`/${user.role}`} replace />;
  return <Outlet />;
}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/login" element={<Login portal="admin" />} />
          <Route path="/forgot-password" element={<RecoveryPage mode="forgot" />} />
          <Route path="/reset-password" element={<RecoveryPage mode="reset" />} />
          <Route path="/accept-invitation" element={<RecoveryPage mode="invitation" />} />
          <Route element={<Guard role="admin" />}>
            <Route path="/admin" element={<PortalLayout />}>
              <Route path="account" element={<AccountSecurity />} />
              <Route path="email-previews" element={<EmailPreviews />} />
              <Route index element={<AdminWorkspace section="overview" />} />
              {[
                'students',
                'cohorts',
                'subjects',
                'questions',
                'exams',
                'assignments',
                'attempts',
                'results',
                'integrity',
              ].map((section) => (
                <Route
                  key={section}
                  path={section}
                  element={<AdminWorkspace key={section} section={section} />}
                />
              ))}
            </Route>
          </Route>
          <Route element={<Guard role="student" />}>
            <Route path="/student" element={<PortalLayout />}>
              <Route path="account" element={<AccountSecurity />} />
              <Route index element={<StudentWorkspace />} />
              <Route path="results" element={<StudentWorkspace resultsOnly />} />
              <Route path="exams/:id" element={<StudentWorkspace detail />} />
              <Route path="results/:id" element={<ResultPage />} />
            </Route>
            <Route path="/student/attempts/:id" element={<AttemptPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
