// File: frontend/src/pages/Login.jsx
// SRS References: FR-02 (Page 6) — User Authentication
// NFR Security (Page 8) — Input validation, error handling
// NFR Usability (Page 8) — Responsive, WCAG 2.1 AA

import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect destination after successful login (from ProtectedRoute state)
  const from = location.state?.from || null;

  // ── Form state ──────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    email:    '',
    password: '',
  });

  const [errors, setErrors]       = useState({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect if already authenticated — prevent accessing login when logged in
  useEffect(() => {
    if (isAuthenticated) {
      navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
    }
  }, [isAuthenticated, isAdmin, navigate]);

  // ── Client-side validation ──────────────────────────────────────────────
  // FR-02: validates email format and non-empty password
  function validateForm() {
    const newErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address.';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // ── Input handler ───────────────────────────────────────────────────────
  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Clear field-level error on change
    if (errors[name]) {
      setErrors((prev) => { const copy = { ...prev }; delete copy[name]; return copy; });
    }
    if (serverError) setServerError('');
  }

  // ── Submit handler ──────────────────────────────────────────────────────
  // FR-02: POST /api/auth/login — errors: 401 (bad creds), 429 (rate limit),
  //        403 (unverified)
  async function handleSubmit(e) {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setServerError('');

    try {
      await login({
        email:    formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      // Redirect to original destination or role-based default
      const destination = from || (isAdmin ? '/admin' : '/dashboard');
      navigate(destination, { replace: true });

    } catch (err) {
      const status  = err.response?.status;
      const data    = err.response?.data;

      if (status === 429) {
        // FR-02: rate limiting — 5 attempts / 15 min
        setServerError(data?.error || 'Too many login attempts. Please try again in 15 minutes.');
      } else if (status === 403 && data?.code === 'EMAIL_NOT_VERIFIED') {
        // FR-01: unverified user
        setServerError('Please verify your email before logging in. Check your inbox.');
      } else if (status === 401) {
        setServerError(data?.error || 'Invalid email or password.');
      } else {
        setServerError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo-area">
          <div className="auth-logo-badge" aria-hidden="true">+</div>
          <div>
            <p className="auth-app-name">MedBook</p>
            <p className="auth-app-tagline">Professional Appointment Portal</p>
          </div>
        </div>
        <h1>Welcome Back</h1>
        <p className="subtitle">Sign in to manage your appointments</p>

        {/* Server error alert */}
        {serverError && (
          <div className="alert alert-error" role="alert" id="login-error">
            <span>{serverError}</span>
          </div>
        )}

        {/* Redirect notice */}
        {from && !serverError && (
          <div className="alert alert-warning" role="status">
            <span>Please sign in to access that page.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate autoComplete="on">
          {/* Email field */}
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              className={`form-input ${errors.email ? 'error' : ''}`}
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              aria-required="true"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
            />
            {errors.email && (
              <div className="form-error" id="login-email-error" role="alert">
                {errors.email}
              </div>
            )}
          </div>

          {/* Password field */}
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className={`form-input ${errors.password ? 'error' : ''}`}
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your password"
              autoComplete="current-password"
              aria-required="true"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
            />
            {errors.password && (
              <div className="form-error" id="login-password-error" role="alert">
                {errors.password}
              </div>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
            id="login-submit"
          >
            {isSubmitting ? (
              <>
                <span className="spinner" />
                Signing In…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="auth-footer">
          Don&apos;t have an account?{' '}
          <Link to="/register" id="login-register-link">Create one</Link>
        </div>
      </div>
    </div>
  );
}
