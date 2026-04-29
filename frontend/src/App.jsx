// File: frontend/src/App.jsx
// SRS References: SRS Section 5 (Page 9) — React v18+ functional components
// NFR Usability, Page 8 — responsive layout, 3-click booking flow route structure
// SRS Section 2 (Page 5) — Client and Admin actor routing

import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

// Pages
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Slots from './pages/Slots.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AdminSlots from './pages/AdminSlots.jsx';
import AdminBookings from './pages/AdminBookings.jsx';

// ── Navbar Component ────────────────────────────────────────────────────────
function Navbar() {
  const { isAuthenticated, isAdmin, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <Link to="/" className="navbar-brand" id="nav-brand">
        Appointment Booking
      </Link>
      <ul className="navbar-links">
        {!isAuthenticated ? (
          <>
            <li><Link to="/slots" id="nav-slots">Browse Slots</Link></li>
            <li><Link to="/login" id="nav-login">Sign In</Link></li>
            <li><Link to="/register" id="nav-register">Register</Link></li>
          </>
        ) : (
          <>
            <li><Link to="/slots" id="nav-slots">Browse Slots</Link></li>
            {isAdmin ? (
              <>
                <li><Link to="/admin" id="nav-admin">Dashboard</Link></li>
                <li><Link to="/admin/slots" id="nav-admin-slots">Slots</Link></li>
                <li><Link to="/admin/bookings" id="nav-admin-bookings">Bookings</Link></li>
              </>
            ) : (
              <li><Link to="/dashboard" id="nav-dashboard">My Bookings</Link></li>
            )}
            <li>
              <span style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-sm)' }}>
                {user?.full_name}
              </span>
            </li>
            <li>
              <button onClick={handleLogout} id="nav-logout" aria-label="Sign out">
                Sign Out
              </button>
            </li>
          </>
        )}
      </ul>
    </nav>
  );
}

// ── Home Page (public slot browsing placeholder) ───────────────────────────
function HomePage() {
  const { isAuthenticated, isAdmin } = useAuth();

  return (
    <div className="main-content">
      <div className="dashboard-header" style={{ textAlign: 'center', paddingTop: 'var(--space-3xl)' }}>
        <h1 style={{
          fontSize: 'var(--fs-3xl)',
          fontWeight: 800,
          background: 'linear-gradient(135deg, var(--clr-gradient-start), var(--clr-gradient-end))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          marginBottom: 'var(--space-md)',
        }}>
          Book Your Appointment
        </h1>
        <p style={{ color: 'var(--clr-text-secondary)', fontSize: 'var(--fs-md)', maxWidth: '500px', margin: '0 auto var(--space-xl)' }}>
          Browse available time slots and schedule your appointment in just a few clicks.
        </p>
        {!isAuthenticated && (
          <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/register" className="btn btn-primary" style={{ width: 'auto', padding: '14px 32px' }} id="hero-register">
              Get Started
            </Link>
            <Link to="/login" className="btn btn-secondary" style={{ padding: '14px 32px' }} id="hero-login">
              Sign In
            </Link>
          </div>
        )}
        {isAuthenticated && !isAdmin && (
          <Link to="/dashboard" className="btn btn-primary" style={{ width: 'auto', padding: '14px 32px' }} id="hero-dashboard">
            Go to Dashboard
          </Link>
        )}
        {isAuthenticated && isAdmin && (
          <Link to="/admin" className="btn btn-primary" style={{ width: 'auto', padding: '14px 32px' }} id="hero-admin">
            Admin Dashboard
          </Link>
        )}
      </div>

      {/* Feature cards */}
      <div className="stats-grid" style={{ marginTop: 'var(--space-3xl)', maxWidth: '900px', marginLeft: 'auto', marginRight: 'auto' }}>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>24/7</div>
          <div className="stat-label">Available anytime — no phone calls needed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>Instant</div>
          <div className="stat-label">Real-time confirmation with email notification</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>Secure</div>
          <div className="stat-label">Enterprise-grade encryption and authentication</div>
        </div>
      </div>
    </div>
  );
}

// ── 404 Page ─────────────────────────────────────────────────────────────────
function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-card verify-card">
        <div className="verify-icon">🔍</div>
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>Page Not Found</h1>
        <p className="subtitle" style={{ marginBottom: 'var(--space-lg)' }}>
          The page you're looking for doesn't exist.
        </p>
        <Link to="/" className="btn btn-primary" style={{ maxWidth: '200px', margin: '0 auto' }} id="btn-go-home">
          Go Home
        </Link>
      </div>
    </div>
  );
}

// ── App Router ──────────────────────────────────────────────────────────────
function AppRouter() {
  return (
    <div className="app-wrapper">
      <Navbar />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        {/* FR-04: Browse slots is public */}
        <Route path="/slots" element={<Slots />} />

        {/* Protected — Client [SRS Section 2: Client actor] */}
        <Route element={<ProtectedRoute allowedRoles={['client', 'admin']} />}>
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>

        {/* Protected — Admin only [SRS Section 2: Administrator actor] */}
        <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/slots" element={<AdminSlots />} />
          <Route path="/admin/bookings" element={<AdminBookings />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}

// ── App Entry ───────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  );
}
