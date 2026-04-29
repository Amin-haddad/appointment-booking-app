// File: frontend/src/components/ProtectedRoute.jsx
// SRS References: SRS Section 2 (Page 5) — RBAC,
//                 NFR Security (Page 8) — JWT-based access control
// Route guard: checks authentication + role before rendering children.

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * ProtectedRoute
 * ───────────────
 * Wraps routes that require authentication or a specific role.
 *
 * Props:
 *  - allowedRoles: string[] — roles that may access (e.g. ['admin']). Omit for "any authenticated".
 *
 * Behaviour:
 *  - Loading state → spinner (prevents flash of redirect).
 *  - Unauthenticated → redirect to /login with ?redirect= for post-login return.
 *  - Wrong role → redirect to / (or /dashboard for clients trying admin pages).
 *  - Authorised → render <Outlet />.
 */
export default function ProtectedRoute({ allowedRoles }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  // While initial auth check runs (token refresh on page load), show a loading state
  if (loading) {
    return (
      <div className="auth-page">
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--clr-text-secondary)' }}>Checking authentication…</p>
        </div>
      </div>
    );
  }

  // Not authenticated — redirect to login with return URL
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Authenticated but wrong role — SRS Section 2 RBAC
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Clients trying admin routes → dashboard; admin trying client routes → admin
    const fallback = user.role === 'admin' ? '/admin' : '/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
