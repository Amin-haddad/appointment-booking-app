// File: backend/server.js
// SRS References: NFR Security (Page 8), SRS Section 5 (Page 9),
//                 NFR Availability (Page 8), FR-02, FR-10
// Express 4.18+ application entry point.
// Middleware order matters — each layer is documented with SRS reference.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/env.js';
import { initPool, closePool } from './database/connection.js';
import { query } from './database/connection.js';
import { verifyEmailTransport } from './utils/email.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { sanitizeInput } from './middleware/validation.js';
import authRoutes from './routes/auth.js';
import slotRoutes from './routes/slots.js';
import bookingRoutes from './routes/bookings.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { startAccountMaintenance, stopAccountMaintenance } from './utils/accountMaintenance.js';
import { startReminderScheduler, stopReminderScheduler } from './utils/reminderScheduler.js';

const app = express();

// ── 1. HTTPS Enforcement ────────────────────────────────────────────────────
// NFR Security, Page 8: "HTTPS enforced on all endpoints"
// In production: Nginx terminates TLS; this middleware redirects if HTTP leaks through.
app.use((req, res, next) => {
  if (config.isProd && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// ── 2. Trust proxy ──────────────────────────────────────────────────────────
// Required for express-rate-limit to see the real client IP behind Nginx/LB.
// SRS Section 5, Page 9: "Deployment on a Linux-based hosting environment"
app.set('trust proxy', 1);

// ── 3. Security Headers ────────────────────────────────────────────────────
// NFR Security, Page 8
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── 4. CORS ─────────────────────────────────────────────────────────────────
// SRS Section 5, Page 9: "Environment variables for all configuration"
// Origin restricted to FRONTEND_URL — never wildcard in production.
app.use(cors({
  origin:      config.frontendUrl,
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── 5. Request Logging ──────────────────────────────────────────────────────
app.use(morgan(config.isProd ? 'combined' : 'dev'));

// ── 6. Body Parsing ─────────────────────────────────────────────────────────
// Limit body size to prevent payload bomb attacks [BP]
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ── 7. Input Sanitization ───────────────────────────────────────────────────
// NFR Security, Page 8: "Input sanitization against XSS and SQL injection"
app.use(sanitizeInput);

// ── 8. General API Rate Limiter ─────────────────────────────────────────────
// Prevents abuse — 100 req/min/IP by default [BP]
app.use('/api', apiRateLimiter);

// ── 9. Routes ───────────────────────────────────────────────────────────────
// Authentication — FR-01, FR-02
app.use('/api/auth', authRoutes);

// Slots — FR-03 (create), FR-04 (browse), FR-09 (delete)
app.use('/api/slots', slotRoutes);
// Admin slot management uses same router but mounted at /api/admin/slots
app.use('/api/admin/slots', slotRoutes);

// Bookings — FR-05 (book), FR-06 (cancel), FR-07 (history)
app.use('/api/bookings', bookingRoutes);

// Admin — FR-07 admin (all bookings), FR-08 (schedule overview)
app.use('/api/admin', adminRoutes);

// Notifications — FR-10 fallback in-app notifications
app.use('/api/notifications', notificationRoutes);

// ── 10. Health Check ────────────────────────────────────────────────────────
// NFR Availability, Page 8: "Automated health checks"
app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1 AS ok');
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: 'connected',
    });
  } catch {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      db: 'disconnected',
    });
  }
});

// ── 11. 404 Handler ─────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: 'The requested endpoint does not exist.',
    code:  'NOT_FOUND',
  });
});

// ── 12. Global Error Handler ────────────────────────────────────────────────
// NFR Availability, Page 8: "Graceful degradation with user-friendly error pages"
// Never leak stack traces to the client in production [NFR Security]
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.stack || err.message);

  const statusCode = err.statusCode || 500;
  const response = {
    error: config.isProd ? 'An internal server error occurred.' : err.message,
    code:  'INTERNAL_ERROR',
  };

  if (!config.isProd && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
});

// ── Server Bootstrap ────────────────────────────────────────────────────────

async function startServer() {
  try {
    // 1. Connect to MySQL pool — NFR Scalability [Page 8]
    await initPool();

    // 2. Verify SMTP transport — FR-10 [Pages 7-8]
    await verifyEmailTransport();

    // 3. Start maintenance jobs
    startAccountMaintenance();
    startReminderScheduler();

    // 4. Start listening
    const server = app.listen(config.port, () => {
      console.info(`
╔══════════════════════════════════════════════════════╗
║   Appointment Booking API                            ║
║   Environment: ${config.env.padEnd(38)}║
║   Port:        ${String(config.port).padEnd(38)}║
║   Frontend:    ${config.frontendUrl.padEnd(38)}║
╚══════════════════════════════════════════════════════╝
      `.trim());
    });

    // ── Graceful shutdown ───────────────────────────────────
    // NFR Availability: clean teardown preserves data integrity
    const shutdown = async (signal) => {
      console.info(`\n[${signal}] Shutting down gracefully...`);
      server.close(async () => {
        stopReminderScheduler();
        stopAccountMaintenance();
        await closePool();
        console.info('[Server] Shut down complete.');
        process.exit(0);
      });

      // Force kill if graceful takes > 10s
      setTimeout(() => {
        console.error('[Server] Forced shutdown after 10s timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[Startup] Fatal error during boot:', err);
    process.exit(1);
  }
}

startServer();

export default app;
