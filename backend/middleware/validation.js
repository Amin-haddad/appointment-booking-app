// File: backend/middleware/validation.js
// SRS References: NFR Security (Page 8) — "Input sanitization against XSS and SQL injection"
// FR-01: Registration field validation
// FR-02: Login field validation
// All validation uses express-validator chains — parameterised queries handle SQL injection.

import { body, param, query as queryValidator, validationResult } from 'express-validator';
import DOMPurify from 'isomorphic-dompurify';

// ── Sanitization middleware ─────────────────────────────────────────────────
// NFR Security, Page 8: "Input sanitization against XSS and SQL injection"
// Runs on EVERY request before route handlers.
export function sanitizeInput(req, _res, next) {
  const clean = (obj) => {
    if (typeof obj === 'string') return DOMPurify.sanitize(obj.trim());
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj !== null && typeof obj === 'object') {
      const out = {};
      for (const [key, val] of Object.entries(obj)) {
        out[key] = clean(val);
      }
      return out;
    }
    return obj;
  };

  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  if (req.query && typeof req.query === 'object') req.query = clean(req.query);
  if (req.params && typeof req.params === 'object') req.params = clean(req.params);

  next();
}

// ── Validation result handler ───────────────────────────────────────────────
// Returns 400 with structured error array matching SRS error-message conventions.
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error:   'Validation failed.',
      details: errors.array().map((e) => ({
        field:   e.path,
        message: e.msg,
      })),
    });
  }
  next();
}

// ── FR-01: Registration validation ──────────────────────────────────────────
// SRS Section 3.1, Page 5-6: User Registration
export const validateRegister = [
  body('full_name')
    .exists({ checkFalsy: true }).withMessage('Full name is required.')
    .isLength({ min: 2, max: 150 }).withMessage('Full name must be between 2 and 150 characters.')
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/).withMessage('Full name may only contain letters, spaces, hyphens, and apostrophes.'),

  body('email')
    .exists({ checkFalsy: true }).withMessage('Email is required.')
    .isEmail().withMessage('A valid email address is required.')
    .isLength({ max: 255 }).withMessage('Email must not exceed 255 characters.')
    .normalizeEmail({ gmail_remove_dots: false }),

  body('password')
    .exists({ checkFalsy: true }).withMessage('Password is required.')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be between 8 and 128 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one digit.')
    .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/).withMessage('Password must contain at least one special character.'),

  handleValidationErrors,
];

// ── FR-02: Login validation ─────────────────────────────────────────────────
// SRS Section 3.2, Page 6: User Authentication
export const validateLogin = [
  body('email')
    .exists({ checkFalsy: true }).withMessage('Email is required.')
    .isEmail().withMessage('A valid email address is required.')
    .normalizeEmail({ gmail_remove_dots: false }),

  body('password')
    .exists({ checkFalsy: true }).withMessage('Password is required.')
    .isLength({ min: 1 }).withMessage('Password cannot be empty.'),

  handleValidationErrors,
];

// ── FR-01: Verify-email token validation ────────────────────────────────────
export const validateVerifyEmail = [
  queryValidator('token')
    .exists({ checkFalsy: true }).withMessage('Verification token is required.')
    .isLength({ min: 10, max: 255 }).withMessage('Invalid token format.'),

  handleValidationErrors,
];

// ── Refresh token validation ────────────────────────────────────────────────
export const validateRefreshToken = [
  body('refresh_token')
    .exists({ checkFalsy: true }).withMessage('Refresh token is required.'),

  handleValidationErrors,
];

// ── FR-03: Slot creation validation ─────────────────────────────────────────
// SRS Section 3.3, Pages 5-6
export const validateCreateSlot = [
  body('title')
    .exists({ checkFalsy: true }).withMessage('Slot title is required.')
    .isLength({ min: 2, max: 255 }).withMessage('Title must be between 2 and 255 characters.'),

  body('date')
    .exists({ checkFalsy: true }).withMessage('Date is required.')
    .isISO8601({ strict: true }).withMessage('Date must be a valid ISO 8601 date (YYYY-MM-DD).')
    .custom((value) => {
      const slotDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (slotDate < today) {
        throw new Error('Slot date cannot be in the past.');
      }
      return true;
    }),

  body('start_time')
    .exists({ checkFalsy: true }).withMessage('Start time is required.')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Start time must be in HH:MM format.'),

  body('end_time')
    .exists({ checkFalsy: true }).withMessage('End time is required.')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('End time must be in HH:MM format.'),

  body('capacity')
    .optional()
    .isInt({ min: 1, max: 1000 }).withMessage('Capacity must be between 1 and 1000.'),

  handleValidationErrors,
];

// ── FR-05: Booking validation ───────────────────────────────────────────────
// SRS Section 3.5, Pages 6-7
export const validateCreateBooking = [
  body('slot_id')
    .exists({ checkFalsy: true }).withMessage('Slot ID is required.')
    .isInt({ min: 1 }).withMessage('Slot ID must be a positive integer.'),

  handleValidationErrors,
];

// ── Common param validators ─────────────────────────────────────────────────
export const validateIdParam = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID parameter must be a positive integer.'),

  handleValidationErrors,
];

// ── Pagination and filter query validators ──────────────────────────────────
// FR-04: "date-range filtering and pagination"
// FR-07: "filtering by status and date range"
export const validatePaginationQuery = [
  queryValidator('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),

  queryValidator('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),

  queryValidator('start_date')
    .optional()
    .isISO8601({ strict: true }).withMessage('start_date must be a valid ISO 8601 date.'),

  queryValidator('end_date')
    .optional()
    .isISO8601({ strict: true }).withMessage('end_date must be a valid ISO 8601 date.'),

  queryValidator('status')
    .optional()
    .isIn(['confirmed', 'cancelled', 'active', 'inactive']).withMessage('Invalid status filter.'),

  handleValidationErrors,
];
