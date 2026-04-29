// File: frontend/src/pages/VerifyEmail.jsx
// SRS References: FR-01 (Pages 5-6) — Email Verification
// GET /api/auth/verify-email?token=xxx

import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const [searchParams]  = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus]   = useState('loading'); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('');
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    if (!token) {
      setStatus('error');
      setMessage('No verification token provided. Please check your email link.');
      return;
    }

    (async () => {
      try {
        const data = await verifyEmail(token);
        setStatus('success');
        setMessage(data.message || 'Your email has been verified successfully!');
      } catch (err) {
        setStatus('error');
        const data = err.response?.data;
        if (data?.code === 'TOKEN_EXPIRED') {
          setMessage('This verification link has expired. Please register again or request a new link.');
        } else if (data?.code === 'TOKEN_USED') {
          setMessage('This link has already been used. You can proceed to sign in.');
        } else {
          setMessage(data?.error || 'Verification failed. The token may be invalid or expired.');
        }
      }
    })();
  }, [token, verifyEmail]);

  return (
    <div className="auth-page">
      <div className="auth-card verify-card">
        {status === 'loading' && (
          <>
            <div className="verify-icon">
              <div className="spinner" style={{ width: 48, height: 48, borderWidth: 3, margin: '0 auto' }} />
            </div>
            <h1 style={{ fontSize: 'var(--fs-xl)', marginTop: 'var(--space-md)' }}>
              Verifying Your Email
            </h1>
            <p className="subtitle">Please wait while we confirm your address…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="verify-icon">✅</div>
            <h1 style={{ fontSize: 'var(--fs-xl)' }}>Email Verified!</h1>
            <p className="subtitle" style={{ marginBottom: 'var(--space-lg)' }}>
              {message}
            </p>
            <Link
              to="/login"
              className="btn btn-primary"
              style={{ maxWidth: '200px', margin: '0 auto' }}
              id="verify-login-btn"
            >
              Sign In Now
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="verify-icon">❌</div>
            <h1 style={{ fontSize: 'var(--fs-xl)' }}>Verification Failed</h1>
            <p className="subtitle" style={{ marginBottom: 'var(--space-lg)' }}>
              {message}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                to="/register"
                className="btn btn-secondary"
                id="verify-register-btn"
              >
                Register Again
              </Link>
              <Link
                to="/login"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                id="verify-login-fallback"
              >
                Sign In
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
