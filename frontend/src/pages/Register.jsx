// File: frontend/src/pages/Register.jsx
// SRS References: FR-01 (Pages 5-6) — User Registration
// NFR Security (Page 8) — bcrypt password policy enforcement
// NFR Usability (Page 8) — WCAG 2.1 AA, responsive

import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// ── Password strength evaluator ─────────────────────────────────────────────
// FR-01: password complexity — visual feedback for user
function evaluatePasswordStrength(password) {
  const checks = {
    length:     password.length >= 8,
    uppercase:  /[A-Z]/.test(password),
    lowercase:  /[a-z]/.test(password),
    digit:      /[0-9]/.test(password),
    special:    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  const passed = Object.values(checks).filter(Boolean).length;

  let level = 'weak';
  let label = 'Weak';
  if (passed >= 5)      { level = 'strong'; label = 'Strong'; }
  else if (passed >= 4) { level = 'good';   label = 'Good'; }
  else if (passed >= 3) { level = 'fair';   label = 'Fair'; }

  return { checks, passed, level, label };
}

export default function Register() {
  const { register, isAuthenticated, api } = useAuth();
  const navigate = useNavigate();

  // ── Form state ──────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    full_name: '',
    email:     '',
    password:  '',
    confirm:   '',
  });

  const [errors, setErrors]             = useState({});
  const [serverError, setServerError]   = useState('');
  const [successMsg, setSuccessMsg]     = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailAvailability, setEmailAvailability] = useState(null); // null | true | false
  const [checkingEmail, setCheckingEmail] = useState(false);

  // Password strength — recalculated on each keystroke
  const strength = useMemo(
    () => evaluatePasswordStrength(formData.password),
    [formData.password]
  );

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const email = formData.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailAvailability(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const { data } = await api.get('/auth/check-email', { params: { email } });
        setEmailAvailability(!!data.available);
      } catch {
        setEmailAvailability(null);
      } finally {
        setCheckingEmail(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [formData.email, api]);

  // ── Client-side validation ──────────────────────────────────────────────
  // FR-01: validates name, email, password complexity, password match
  function validateForm() {
    const e = {};

    // Full name
    if (!formData.full_name.trim()) {
      e.full_name = 'Full name is required.';
    } else if (formData.full_name.trim().length < 2) {
      e.full_name = 'Name must be at least 2 characters.';
    } else if (formData.full_name.trim().length > 150) {
      e.full_name = 'Name must not exceed 150 characters.';
    }

    // Email
    if (!formData.email.trim()) {
      e.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      e.email = 'Please enter a valid email address.';
    } else if (emailAvailability === false) {
      e.email = 'An account with this email already exists.';
    }

    // Password — must satisfy all checks
    if (!formData.password) {
      e.password = 'Password is required.';
    } else {
      if (!strength.checks.length)    e.password = 'Password must be at least 8 characters.';
      else if (!strength.checks.uppercase) e.password = 'Password must contain an uppercase letter.';
      else if (!strength.checks.lowercase) e.password = 'Password must contain a lowercase letter.';
      else if (!strength.checks.digit)     e.password = 'Password must contain a digit.';
      else if (!strength.checks.special)   e.password = 'Password must contain a special character.';
    }

    // Confirm password
    if (!formData.confirm) {
      e.confirm = 'Please confirm your password.';
    } else if (formData.password !== formData.confirm) {
      e.confirm = 'Passwords do not match.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Input handler ───────────────────────────────────────────────────────
  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (errors[name]) {
      setErrors((prev) => { const copy = { ...prev }; delete copy[name]; return copy; });
    }
    if (serverError) setServerError('');
  }

  // ── Submit handler ──────────────────────────────────────────────────────
  // FR-01: POST /api/auth/register — errors: 400 (validation), 409 (email exists)
  async function handleSubmit(e) {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setServerError('');
    setSuccessMsg('');

    try {
      const data = await register({
        full_name: formData.full_name.trim(),
        email:     formData.email.trim().toLowerCase(),
        password:  formData.password,
      });

      // FR-01: "verification email sent upon registration"
      setSuccessMsg(
        data.message || 'Account created! Please check your email to verify your account.'
      );
      setFormData({ full_name: '', email: '', password: '', confirm: '' });

    } catch (err) {
      const status = err.response?.status;
      const data   = err.response?.data;

      if (status === 409) {
        // FR-01: email already registered — 409 Conflict
        setServerError(data?.error || 'An account with this email already exists.');
      } else if (status === 400 && data?.details) {
        // Validation errors from backend
        const fieldErrors = {};
        data.details.forEach((d) => { fieldErrors[d.field] = d.message; });
        setErrors(fieldErrors);
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
        <h1>Create Account</h1>
        <p className="subtitle">Sign up to start booking appointments</p>

        {/* Server error */}
        {serverError && (
          <div className="alert alert-error" role="alert" id="register-error">
            <span>{serverError}</span>
          </div>
        )}

        {/* Success message — FR-01: "verify your email" */}
        {successMsg && (
          <div className="alert alert-success" role="status" id="register-success">
            <span>{successMsg}</span>
          </div>
        )}

        {!successMsg && (
          <form onSubmit={handleSubmit} noValidate autoComplete="on">
            {/* Full Name */}
            <div className="form-group">
              <label htmlFor="register-name">Full Name</label>
              <input
                id="register-name"
                className={`form-input ${errors.full_name ? 'error' : ''}`}
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                placeholder="John Doe"
                autoComplete="name"
                autoFocus
                aria-required="true"
                aria-invalid={!!errors.full_name}
                aria-describedby={errors.full_name ? 'register-name-error' : undefined}
              />
              {errors.full_name && (
                <div className="form-error" id="register-name-error" role="alert">
                  {errors.full_name}
                </div>
              )}
            </div>

            {/* Email */}
            <div className="form-group">
              <label htmlFor="register-email">Email Address</label>
              <input
                id="register-email"
                className={`form-input ${errors.email ? 'error' : ''}`}
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                autoComplete="email"
                aria-required="true"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'register-email-error' : undefined}
              />
               {errors.email && (
                 <div className="form-error" id="register-email-error" role="alert">
                   {errors.email}
                 </div>
               )}
               {!errors.email && checkingEmail && (
                 <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--clr-text-secondary)', marginTop: 6 }}>
                   Checking email availability…
                 </div>
               )}
               {!errors.email && !checkingEmail && emailAvailability === true && (
                 <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--clr-success)', marginTop: 6 }}>
                   Email is available.
                 </div>
               )}
               {!errors.email && !checkingEmail && emailAvailability === false && (
                 <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--clr-error)', marginTop: 6 }}>
                   An account with this email already exists.
                 </div>
               )}
             </div>

            {/* Password */}
            <div className="form-group">
              <label htmlFor="register-password">Password</label>
              <input
                id="register-password"
                className={`form-input ${errors.password ? 'error' : ''}`}
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Create a strong password"
                autoComplete="new-password"
                aria-required="true"
                aria-invalid={!!errors.password}
                aria-describedby="register-password-strength register-password-reqs"
              />
              {errors.password && (
                <div className="form-error" role="alert">
                  {errors.password}
                </div>
              )}

              {/* Password strength indicator */}
              {formData.password.length > 0 && (
                <div className="password-strength" id="register-password-strength">
                  <div className="strength-bar-container" role="progressbar" aria-valuenow={strength.passed} aria-valuemin={0} aria-valuemax={5}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`strength-bar ${i <= strength.passed ? `active ${strength.level}` : ''}`}
                      />
                    ))}
                  </div>
                  <span className={`strength-text ${strength.level}`}>
                    Password strength: {strength.label}
                  </span>
                </div>
              )}

              {/* Password requirements checklist */}
              {formData.password.length > 0 && (
                <ul className="password-requirements" id="register-password-reqs" aria-label="Password requirements">
                  <li className={strength.checks.length ? 'met' : ''}>
                    <span className="icon">{strength.checks.length ? '✓' : '○'}</span>
                    At least 8 characters
                  </li>
                  <li className={strength.checks.uppercase ? 'met' : ''}>
                    <span className="icon">{strength.checks.uppercase ? '✓' : '○'}</span>
                    One uppercase letter
                  </li>
                  <li className={strength.checks.lowercase ? 'met' : ''}>
                    <span className="icon">{strength.checks.lowercase ? '✓' : '○'}</span>
                    One lowercase letter
                  </li>
                  <li className={strength.checks.digit ? 'met' : ''}>
                    <span className="icon">{strength.checks.digit ? '✓' : '○'}</span>
                    One digit
                  </li>
                  <li className={strength.checks.special ? 'met' : ''}>
                    <span className="icon">{strength.checks.special ? '✓' : '○'}</span>
                    One special character
                  </li>
                </ul>
              )}
            </div>

            {/* Confirm Password */}
            <div className="form-group">
              <label htmlFor="register-confirm">Confirm Password</label>
              <input
                id="register-confirm"
                className={`form-input ${errors.confirm ? 'error' : ''}`}
                type="password"
                name="confirm"
                value={formData.confirm}
                onChange={handleChange}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                aria-required="true"
                aria-invalid={!!errors.confirm}
                aria-describedby={errors.confirm ? 'register-confirm-error' : undefined}
              />
              {errors.confirm && (
                <div className="form-error" id="register-confirm-error" role="alert">
                  {errors.confirm}
                </div>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
              id="register-submit"
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" />
                  Creating Account…
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>
        )}

        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" id="register-login-link">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
