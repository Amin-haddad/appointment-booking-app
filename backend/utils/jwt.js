// File: backend/utils/jwt.js
// SRS References: NFR Security (Page 8) — "JWT tokens with RS256 signing"
// FR-02: Authentication — access token + refresh token
// SRS Section 8, Risk #2: "Short-lived JWTs with refresh token rotation"

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { query, getConnection } from '../database/connection.js';

// ── Access Token ─────────────────────────────────────────────────────────────
// RS256 asymmetric signing [NFR Security, Page 8]
// Short-lived (default 1h) — SRS Section 8 Risk #2

/**
 * Generate a signed JWT access token.
 *
 * @param {{ id: number, email: string, role: string, full_name: string }} user
 * @returns {string} Signed JWT (RS256)
 */
export function signAccessToken(user) {
  const payload = {
    sub:       user.id,
    id:        user.id,
    email:     user.email,
    role:      user.role,
    full_name: user.full_name,
    type:      'access',
  };

  return jwt.sign(payload, config.jwt.privateKey, {
    algorithm: 'RS256',                  // NFR Security, Page 8
    expiresIn: config.jwt.accessExpiry,  // Default: 1h
    issuer:    'appointment-booking-api',
  });
}

// ── Refresh Token ────────────────────────────────────────────────────────────
// Opaque random token stored as SHA-256 hash in refresh_tokens table.
// Never stored in plaintext [NFR Security, Page 8].
// Rotation: old token revoked on each refresh [SRS Risk #2: "refresh token rotation"].

/**
 * Generate a cryptographically random refresh token and persist its hash.
 *
 * @param {number} userId
 * @param {string} ipAddress
 * @param {string} userAgent
 * @returns {Promise<{ refreshToken: string, expiresAt: Date }>}
 */
export async function generateRefreshToken(userId, ipAddress, userAgent) {
  // Generate 64-byte random token, encode as URL-safe base64
  const rawToken = crypto.randomBytes(64).toString('base64url');

  // Store only the SHA-256 hash — never the raw token [NFR Security, Page 8]
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Calculate expiry from JWT_REFRESH_EXPIRY env var (default: '7d')
  const expiresAt = calculateExpiry(config.jwt.refreshExpiry);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, tokenHash, expiresAt, ipAddress, userAgent || null]
  );

  return { refreshToken: rawToken, expiresAt };
}

/**
 * Verify a refresh token: look up hash, check expiry, check revocation.
 *
 * @param {string} rawToken
 * @returns {Promise<{ valid: boolean, userId: number|null, tokenId: number|null }>}
 */
export async function verifyRefreshToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const [rows] = await query(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
            u.role, u.email, u.full_name, u.is_active, u.is_verified
     FROM   refresh_tokens rt
     JOIN   users u ON u.id = rt.user_id
     WHERE  rt.token_hash = ?`,
    [tokenHash]
  );

  if (rows.length === 0) {
    return { valid: false, userId: null, tokenId: null };
  }

  const row = rows[0];

  // Check revocation
  if (row.revoked_at !== null) {
    return { valid: false, userId: row.user_id, tokenId: row.id };
  }

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    return { valid: false, userId: row.user_id, tokenId: row.id };
  }

  // Check user is active and verified
  if (!row.is_active || !row.is_verified) {
    return { valid: false, userId: row.user_id, tokenId: row.id };
  }

  return {
    valid:   true,
    userId:  row.user_id,
    tokenId: row.id,
    user: {
      id:        row.user_id,
      email:     row.email,
      role:      row.role,
      full_name: row.full_name,
    },
  };
}

/**
 * Rotate a refresh token: revoke the old one and issue a new one atomically.
 * SRS Section 8, Risk #2: "refresh token rotation"
 *
 * @param {string} oldRawToken
 * @param {string} ipAddress
 * @param {string} userAgent
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: Date } | null>}
 */
export async function rotateRefreshToken(oldRawToken, ipAddress, userAgent) {
  const verification = await verifyRefreshToken(oldRawToken);

  if (!verification.valid) {
    // If invalid token was already used (replay attack), revoke ALL tokens for user
    if (verification.userId) {
      await revokeAllUserTokens(verification.userId);
    }
    return null;
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Revoke old token
    const oldHash = crypto.createHash('sha256').update(oldRawToken).digest('hex');
    await conn.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?`,
      [oldHash]
    );

    // Issue new refresh token
    const newRawToken = crypto.randomBytes(64).toString('base64url');
    const newHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
    const expiresAt = calculateExpiry(config.jwt.refreshExpiry);

    await conn.execute(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [verification.userId, newHash, expiresAt, ipAddress, userAgent || null]
    );

    await conn.commit();

    // Issue new access token
    const accessToken = signAccessToken(verification.user);

    return { accessToken, refreshToken: newRawToken, expiresAt };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Revoke a single refresh token by raw value.
 * @param {string} rawToken
 */
export async function revokeRefreshToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL`,
    [tokenHash]
  );
}

/**
 * Revoke ALL refresh tokens for a user — used on logout-all or detected replay.
 * @param {number} userId
 */
export async function revokeAllUserTokens(userId) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
}

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Parse a duration string (e.g. '7d', '1h', '30m') into a future Date.
 * @param {string} durationStr
 * @returns {Date}
 */
function calculateExpiry(durationStr) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = durationStr.match(/^(\d+)([smhd])$/);

  if (!match) {
    throw new Error(`Invalid duration format: "${durationStr}". Expected: 7d, 1h, 30m, etc.`);
  }

  const amount = parseInt(match[1], 10);
  const unit   = match[2];
  return new Date(Date.now() + amount * units[unit]);
}
