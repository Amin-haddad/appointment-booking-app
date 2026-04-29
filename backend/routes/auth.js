// File: backend/routes/auth.js
// SRS References: FR-01 (Page 5-6), FR-02 (Page 6), FR-10 (Pages 7-8)
// Complete auth routes with controller logic inline.
// POST /api/auth/register  — FR-01
// POST /api/auth/login     — FR-02
// GET  /api/auth/verify-email — FR-01
// POST /api/auth/refresh-token — FR-02 / NFR Security
// POST /api/auth/logout    — NFR Security

import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { query, getConnection } from '../database/connection.js';
import {
  signAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../utils/jwt.js';
import { enqueueEmail } from '../utils/email.js';
import { loginRateLimiter, dbLoginRateLimitMiddleware, recordLoginAttempt } from '../middleware/rateLimit.js';
import { authenticateJWT } from '../middleware/auth.js';
import { validateRegister, validateLogin, validateVerifyEmail, validateRefreshToken } from '../middleware/validation.js';

const router = Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getFailedAttemptsForEmail(email) {
  const windowStart = new Date(Date.now() - config.rateLimit.loginWindowMs);
  const [rows] = await query(
    `SELECT COUNT(*) AS attempt_count
     FROM login_attempts
     WHERE email = ?
       AND attempted_at > ?
       AND was_successful = 0`,
    [email, windowStart]
  );
  return rows[0].attempt_count;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/check-email?email=... — FR-01: real-time email uniqueness
// ═══════════════════════════════════════════════════════════════════════════
router.get('/check-email', async (req, res, next) => {
  try {
    const email = (req.query.email || '').toString().trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        error: 'A valid email address is required.',
        code: 'VALIDATION_ERROR',
      });
    }

    const [rows] = await query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    return res.status(200).json({
      email,
      available: rows.length === 0,
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/register — FR-01: User Registration
// [SRS Section 3.1, Pages 5-6]
// ═══════════════════════════════════════════════════════════════════════════
router.post('/register', validateRegister, async (req, res, next) => {
  try {
    const { full_name, email, password } = req.body;

    // FR-01: Check for existing email — 409 Conflict if duplicate
    const [existing] = await query(
      `SELECT id FROM users WHERE email = ?`,
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        error: 'An account with this email address already exists.',
        code:  'EMAIL_EXISTS',
      });
    }

    // NFR Security, Page 8: hash with bcrypt, cost factor 12+
    const passwordHash = await bcrypt.hash(password, config.bcrypt.costFactor);

    // Insert user — unverified by default [FR-01]
    const [result] = await query(
      `INSERT INTO users (full_name, email, password_hash, role, is_verified)
       VALUES (?, ?, ?, 'client', 0)`,
      [full_name, email, passwordHash]
    );

    const userId = result.insertId;

    // FR-01: Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + config.email.verificationTokenTtl * 1000);

    await query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES (?, ?, ?)`,
      [userId, verificationToken, tokenExpiry]
    );

    // FR-01 + FR-10: Send verification email asynchronously
    const verificationUrl = `${config.frontendUrl}/verify-email?token=${verificationToken}`;

    await enqueueEmail(
      'registration_verification',
      email,
      userId,
      { name: full_name, verificationUrl },
      null
    );

    // 201 Created — FR-01 success response
    return res.status(201).json({
      message: 'Account created successfully. Please check your email to verify your account.',
      user: {
        id:        userId,
        full_name,
        email,
        role:      'client',
        is_verified: false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/verify-email?token=xxx — FR-01: Email Verification
// [SRS Section 3.1, Pages 5-6]
// ═══════════════════════════════════════════════════════════════════════════
router.get('/verify-email', validateVerifyEmail, async (req, res, next) => {
  try {
    const { token } = req.query;

    // Look up token — check expiry and usage status
    const [rows] = await query(
      `SELECT evt.id, evt.user_id, evt.expires_at, evt.used_at,
              u.is_verified
       FROM   email_verification_tokens evt
       JOIN   users u ON u.id = evt.user_id
       WHERE  evt.token = ?`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid verification token.',
        code:  'INVALID_TOKEN',
      });
    }

    const record = rows[0];

    // Already verified — idempotent success
    if (record.is_verified) {
      return res.status(200).json({
        message: 'Email is already verified.',
      });
    }

    // Token already used
    if (record.used_at !== null) {
      return res.status(400).json({
        error: 'This verification link has already been used.',
        code:  'TOKEN_USED',
      });
    }

    // Token expired
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({
        error: 'Verification link has expired. Please request a new one.',
        code:  'TOKEN_EXPIRED',
      });
    }

    // Mark token as used and verify user — atomic transaction
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?`,
        [record.id]
      );

      await conn.execute(
        `UPDATE users SET is_verified = 1 WHERE id = ?`,
        [record.user_id]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return res.status(200).json({
      message: 'Email verified successfully. You may now log in.',
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/login — FR-02: User Authentication
// [SRS Section 3.2, Page 6]
// Rate limited: 5 attempts / 15-min / IP [FR-02]
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/login',
  loginRateLimiter,            // Layer 1: in-memory fast path [FR-02]
  dbLoginRateLimitMiddleware,  // Layer 2: persistent DB check [FR-02]
  validateLogin,
  async (req, res, next) => {
    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;
    const ipAddress = req.ip;

    try {
      // Look up user by email
      const [users] = await query(
        `SELECT id, full_name, email, password_hash, role, is_verified, is_active
         FROM users
         WHERE email = ?`,
        [email]
      );

      // Generic error message to prevent user enumeration [NFR Security, Page 8]
      const INVALID_CREDENTIALS = 'Invalid email or password.';

      if (users.length === 0) {
        // Log failed attempt even when user doesn't exist [FR-02]
        await recordLoginAttempt(ipAddress, email, false);
        return res.status(401).json({ error: INVALID_CREDENTIALS, code: 'AUTH_FAILED' });
      }

      const user = users[0];

      const failedAttemptsForEmail = await getFailedAttemptsForEmail(email);
      if (failedAttemptsForEmail >= config.rateLimit.loginMax) {
        return res.status(429).json({
          error: 'Account temporarily locked due to too many failed login attempts. Please try again in 15 minutes.',
          code: 'ACCOUNT_LOCKED',
        });
      }

      // Check if account is active
      if (!user.is_active) {
        await recordLoginAttempt(ipAddress, email, false);
        return res.status(401).json({
          error: 'This account has been deactivated. Contact support.',
          code:  'ACCOUNT_INACTIVE',
        });
      }

      // FR-01: email must be verified before login
      if (!user.is_verified) {
        await recordLoginAttempt(ipAddress, email, false);
        return res.status(403).json({
          error: 'Please verify your email before logging in.',
          code:  'EMAIL_NOT_VERIFIED',
        });
      }

      // NFR Security: bcrypt comparison — constant-time [Page 8]
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        await recordLoginAttempt(ipAddress, email, false);

        const updatedFailedAttempts = await getFailedAttemptsForEmail(email);
        if (updatedFailedAttempts >= config.rateLimit.loginMax) {
          await enqueueEmail(
            'account_locked',
            user.email,
            user.id,
            {
              name: user.full_name,
              minutes: Math.ceil(config.rateLimit.loginWindowMs / 60000),
            },
            null
          );

          return res.status(429).json({
            error: 'Account temporarily locked due to too many failed login attempts. Please try again in 15 minutes.',
            code: 'ACCOUNT_LOCKED',
          });
        }

        return res.status(401).json({ error: INVALID_CREDENTIALS, code: 'AUTH_FAILED' });
      }

      // ── Success ─────────────────────────────────────────────
      await recordLoginAttempt(ipAddress, email, true);

      // Generate RS256 access token [NFR Security, Page 8]
      const accessToken = signAccessToken({
        id:        user.id,
        email:     user.email,
        role:      user.role,
        full_name: user.full_name,
      });

      // Generate refresh token with rotation support [SRS Risk #2]
      const { refreshToken, expiresAt } = await generateRefreshToken(
        user.id,
        ipAddress,
        req.headers['user-agent']
      );

      return res.status(200).json({
        message: 'Login successful.',
        access_token:  accessToken,
        refresh_token: refreshToken,
        token_type:    'Bearer',
        expires_in:    config.jwt.accessExpiry,
        user: {
          id:        user.id,
          full_name: user.full_name,
          email:     user.email,
          role:      user.role,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/refresh-token — FR-02 / NFR Security
// SRS Section 8, Risk #2: "refresh token rotation"
// ═══════════════════════════════════════════════════════════════════════════
router.post('/refresh-token', validateRefreshToken, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await rotateRefreshToken(refresh_token, ipAddress, userAgent);

    if (!result) {
      return res.status(401).json({
        error: 'Invalid or expired refresh token. Please log in again.',
        code:  'REFRESH_TOKEN_INVALID',
      });
    }

    return res.status(200).json({
      access_token:  result.accessToken,
      refresh_token: result.refreshToken,
      token_type:    'Bearer',
      expires_in:    config.jwt.accessExpiry,
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout — NFR Security
// Revokes the refresh token so it cannot be reused.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/logout', authenticateJWT, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (refresh_token) {
      await revokeRefreshToken(refresh_token);
    }

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/me — convenience endpoint
// Returns the authenticated user's profile. SRS Section 2, Page 5.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/me', authenticateJWT, async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT id, full_name, email, role, is_verified, created_at
       FROM users WHERE id = ? AND is_active = 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
