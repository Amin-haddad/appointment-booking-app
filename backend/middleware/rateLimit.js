// File: backend/middleware/rateLimit.js
// SRS References: FR-02 (Page 6), NFR Security (Page 8)
// FR-02: "5 attempts per 15-minute window per IP address"
// Returns 429 Too Many Requests when limit is exceeded.
// Two layers: in-memory express-rate-limit (fast path) +
// DB-backed login_attempts log (persistent, survives restarts).

import rateLimit from 'express-rate-limit';
import { config }  from '../config/env.js';
import { query }   from '../database/connection.js';

// ── Layer 1: In-memory rate limiter (express-rate-limit) ──────────────────
// Fast path — blocks before DB hit. Resets on server restart (acceptable for
// our scale; DB layer provides durable enforcement per FR-02).

/**
 * loginRateLimiter
 * ─────────────────
 * FR-02: 5 login attempts per 15-minute window per IP address.
 * Responds with 429 and a Retry-After header on breach.
 */
export const loginRateLimiter = rateLimit({
  windowMs:       config.rateLimit.loginWindowMs, // 900,000 ms = 15 minutes
  max:            config.rateLimit.loginMax,       // 5 attempts
  standardHeaders: true,   // Return RateLimit-* headers per RFC 6585
  legacyHeaders:   false,
  keyGenerator:   (req) => req.ip,  // Per IP — FR-02
  skipSuccessfulRequests: false,    // Count successful logins too
  handler: (_req, res) => {
    // FR-02 specifies 429 implicitly via "5 attempts per 15-minute window"
    res.status(429).json({
      error:      'Too many login attempts. Please try again in 15 minutes.',
      code:       'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(config.rateLimit.loginWindowMs / 1000),
    });
  },
});

/**
 * apiRateLimiter
 * ───────────────
 * General API rate limiter — prevents abuse of non-login endpoints [BP].
 * 100 requests per minute per IP.
 */
export const apiRateLimiter = rateLimit({
  windowMs:        config.rateLimit.apiWindowMs,
  max:             config.rateLimit.apiMax,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many requests. Please slow down.',
      code:  'RATE_LIMIT_EXCEEDED',
    });
  },
});


// ── Layer 2: DB-backed attempt logging ───────────────────────────────────
// Persists login attempts to login_attempts table [FR-02].
// Provides durable rate enforcement and audit trail across restarts.

/**
 * recordLoginAttempt
 * ───────────────────
 * Inserts a login attempt record.
 * Call this from the login controller after every attempt (pass or fail).
 *
 * @param {string}  ipAddress
 * @param {string|null} email
 * @param {boolean} wasSuccessful
 */
export async function recordLoginAttempt(ipAddress, email, wasSuccessful) {
  await query(
    `INSERT INTO login_attempts (ip_address, email, was_successful)
     VALUES (?, ?, ?)`,
    [ipAddress, email || null, wasSuccessful ? 1 : 0]
  );
}

/**
 * checkLoginRateLimit
 * ────────────────────
 * DB-level rate limit check — counts failed attempts in the sliding window.
 * FR-02: 5 attempts per 15-minute window per IP.
 *
 * Returns { blocked: boolean, attemptCount: number, remainingMs: number }
 *
 * @param {string} ipAddress
 * @returns {Promise<{ blocked: boolean, attemptCount: number }>}
 */
export async function checkLoginRateLimit(ipAddress) {
  const windowStart = new Date(Date.now() - config.rateLimit.loginWindowMs);

  const [rows] = await query(
    `SELECT COUNT(*) AS attempt_count
     FROM   login_attempts
     WHERE  ip_address   = ?
       AND  attempted_at > ?
       AND  was_successful = 0`,
    [ipAddress, windowStart]
  );

  const attemptCount = rows[0].attempt_count;
  return {
    blocked:      attemptCount >= config.rateLimit.loginMax,
    attemptCount,
  };
}

/**
 * dbLoginRateLimitMiddleware
 * ───────────────────────────
 * Express middleware that checks the DB-backed login attempt count.
 * Placed on POST /api/auth/login AFTER loginRateLimiter.
 * Provides a durable second layer that survives server restarts.
 *
 * FR-02: "5 attempts per 15-minute window per IP address"
 */
export async function dbLoginRateLimitMiddleware(req, res, next) {
  try {
    const { blocked, attemptCount } = await checkLoginRateLimit(req.ip);

    if (blocked) {
      return res.status(429).json({
        error:        'Too many failed login attempts. Please try again in 15 minutes.',
        code:         'RATE_LIMIT_EXCEEDED',
        attemptCount,
      });
    }

    next();
  } catch (err) {
    // If DB check fails at this stage, fail open (allow request) but log error.
    // Fail-open is safer than denying all logins if DB is momentarily unavailable.
    console.error('[RateLimit] DB check failed — failing open:', err.message);
    next();
  }
}
