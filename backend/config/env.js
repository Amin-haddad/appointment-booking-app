// File: backend/config/env.js
// SRS References: SRS Section 5, Page 9 — "Environment variables for all configuration"
// Centralised validated config — throws at startup if required vars are missing

import 'dotenv/config';

/**
 * Assert a required environment variable is present.
 * Fails fast at startup rather than at runtime.
 */
function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`[Config] Required environment variable "${name}" is not set.`);
  }
  return value.trim();
}

function optional(name, defaultValue = '') {
  return (process.env[name] || defaultValue).trim();
}

function requiredInt(name) {
  const val = required(name);
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`[Config] "${name}" must be an integer, got: ${val}`);
  return n;
}

function optionalInt(name, defaultValue) {
  const val = process.env[name];
  if (!val) return defaultValue;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`[Config] "${name}" must be an integer, got: ${val}`);
  return n;
}

export const config = {
  env:          optional('NODE_ENV', 'development'),
  port:         optionalInt('PORT', 5000),
  frontendUrl:  optional('FRONTEND_URL', 'http://localhost:3000'),
  isProd:       optional('NODE_ENV', 'development') === 'production',

  // Database — SRS Section 5
  db: {
    host:        optional('DB_HOST', '127.0.0.1'),
    port:        optionalInt('DB_PORT', 3306),
    name:        required('DB_NAME'),
    user:        required('DB_USER'),
    password:    required('DB_PASSWORD'),
    poolMin:     optionalInt('DB_POOL_MIN', 2),
    poolMax:     optionalInt('DB_POOL_MAX', 20),
    idleTimeout: optionalInt('DB_IDLE_TIMEOUT', 10000),
  },

  // JWT RS256 — NFR Security, Page 8
  jwt: {
    // Base64-encoded PEM strings decoded at runtime — never stored as raw text in env
    privateKey:     Buffer.from(required('JWT_PRIVATE_KEY_BASE64'), 'base64').toString('utf8'),
    publicKey:      Buffer.from(required('JWT_PUBLIC_KEY_BASE64'), 'base64').toString('utf8'),
    accessExpiry:   optional('JWT_ACCESS_EXPIRY', '1h'),
    refreshExpiry:  optional('JWT_REFRESH_EXPIRY', '7d'),
  },

  // bcrypt — NFR Security, Page 8: cost factor 12+
  bcrypt: {
    costFactor: optionalInt('BCRYPT_COST_FACTOR', 12),
  },

  // Rate limiting — FR-02, Page 6
  rateLimit: {
    loginWindowMs:  optionalInt('RATE_LIMIT_LOGIN_WINDOW_MS', 900000), // 15 min
    loginMax:       optionalInt('RATE_LIMIT_LOGIN_MAX', 5),
    apiWindowMs:    optionalInt('RATE_LIMIT_API_WINDOW_MS', 60000),
    apiMax:         optionalInt('RATE_LIMIT_API_MAX', 100),
  },

  // Email — FR-10, Pages 7-8
  email: {
    host:        required('SMTP_HOST'),
    port:        optionalInt('SMTP_PORT', 587),
    secure:      optional('SMTP_SECURE', 'false') === 'true',
    user:        required('SMTP_USER'),
    password:    required('SMTP_PASSWORD'),
    fromAddress: required('EMAIL_FROM_ADDRESS'),
    fromName:    optional('EMAIL_FROM_NAME', 'Appointment Booking'),
    verificationTokenTtl: optionalInt('EMAIL_VERIFICATION_TOKEN_TTL', 86400), // 24h in seconds
  },

  // Redis for job queue — FR-10
  redis: {
    host:     optional('REDIS_HOST', '127.0.0.1'),
    port:     optionalInt('REDIS_PORT', 6379),
    password: optional('REDIS_PASSWORD', ''),
  },

  maintenance: {
    unverifiedRetentionDays: optionalInt('UNVERIFIED_ACCOUNT_RETENTION_DAYS', 7),
    purgeIntervalMinutes: optionalInt('UNVERIFIED_PURGE_INTERVAL_MINUTES', 60),
  },

  reminders: {
    pollIntervalMinutes: optionalInt('REMINDER_POLL_INTERVAL_MINUTES', 5),
  },
};
