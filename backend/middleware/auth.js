// File: backend/middleware/auth.js
// SRS References: NFR Security (Page 8), FR-02, SRS Section 2 RBAC (Page 5)
// JWT RS256 verification middleware — express-jwt replacement using jsonwebtoken directly
// to give us full control over error messaging matching SRS error codes exactly.

import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/**
 * authenticateJWT
 * ───────────────
 * Validates the Bearer token in the Authorization header.
 * Uses RS256 asymmetric signing [NFR Security, Page 8].
 *
 * On success:  attaches decoded payload to req.user and calls next().
 * On failure:  returns 401 with a message that does NOT reveal key details
 *              (prevents information leakage — NFR Security, Page 8).
 *
 * Error response shape matches SRS-implied contract:
 *   { error: string }
 */
export function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Provide a valid Bearer token.',
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: ['RS256'], // NFR Security, Page 8: RS256 only — reject HS256 downgrade
    });

    // Attach user payload to request — used by requireRole middleware
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Token has expired. Please log in again.',
        code:  'TOKEN_EXPIRED',
      });
    }

    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Invalid token.',
        code:  'TOKEN_INVALID',
      });
    }

    // Unexpected error — do not expose internals
    return res.status(401).json({ error: 'Authentication failed.' });
  }
}

/**
 * requireRole(...roles)
 * ──────────────────────
 * RBAC middleware factory — SRS Section 2, Page 5.
 * Must be applied AFTER authenticateJWT.
 *
 * Usage: router.get('/admin/slots', authenticateJWT, requireRole('admin'), handler)
 *
 * Returns 403 Forbidden when the authenticated user's role is not in the allowed list.
 * Returns 401 if authenticateJWT was bypassed (belt-and-suspenders).
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }

    next();
  };
}

/**
 * optionalAuth
 * ────────────
 * Attaches req.user if a valid token is present, but does NOT block the request
 * if no token is provided. Useful for public routes that behave differently for
 * authenticated users (e.g., slot listing showing personalised availability).
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);

  try {
    req.user = jwt.verify(token, config.jwt.publicKey, { algorithms: ['RS256'] });
  } catch {
    req.user = null; // Invalid or expired token — treat as unauthenticated
  }

  next();
}
