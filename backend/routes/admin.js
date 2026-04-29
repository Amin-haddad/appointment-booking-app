// File: backend/routes/admin.js
// SRS References: FR-07 Admin (Page 7), FR-08 (Page 7)
// FR-07: "Administrators shall see all bookings across all clients"
// FR-08: "consolidated view of all slots and their booking status…
//         summary statistics such as total slots, total bookings,
//         and average fill rate"

import { Router } from 'express';
import { query } from '../database/connection.js';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { validatePaginationQuery } from '../middleware/validation.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/bookings — FR-07 Admin: All Bookings
// [SRS Section 3.7, Page 7]
// "Administrators shall see all bookings across all clients,
//  with the ability to filter by client name, date range, and status"
// ═══════════════════════════════════════════════════════════════════════════
router.get('/bookings', authenticateJWT, requireRole('admin'), validatePaginationQuery, async (req, res, next) => {
  try {
    const page       = parseInt(req.query.page, 10) || 1;
    const limit      = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset     = (page - 1) * limit;
    const status     = req.query.status || null;
    const startDate  = req.query.start_date || null;
    const endDate    = req.query.end_date || null;
    const clientName = req.query.client_name || null;
    const clientQuery = req.query.client_query || null;

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('b.status = ?');
      params.push(status);
    }
    if (startDate) {
      conditions.push('s.date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('s.date <= ?');
      params.push(endDate);
    }
    // FR-07: "filter by client name"
    if (clientName) {
      conditions.push('u.full_name LIKE ?');
      params.push(`%${clientName}%`);
    }
    if (clientQuery) {
      conditions.push('(u.full_name LIKE ? OR u.email LIKE ?)');
      params.push(`%${clientQuery}%`, `%${clientQuery}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await query(
      `SELECT COUNT(*) AS total
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN users u ON u.id = b.client_id
       ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const [bookings] = await query(
      `SELECT b.id, b.client_id, b.slot_id, b.status, b.booked_at,
              b.cancelled_at, b.cancellation_reason,
              s.title AS slot_title, s.date AS slot_date,
              s.start_time, s.end_time,
              u.full_name AS client_name, u.email AS client_email
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN users u ON u.id = b.client_id
       ${whereClause}
       ORDER BY b.booked_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return res.status(200).json({
      bookings,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/schedule — FR-08: Admin Schedule Overview
// [SRS Section 3.8, Page 7]
// "consolidated view of all slots and their booking status (empty, partial, full)"
// "summary statistics: total slots, total bookings, average fill rate"
// ═══════════════════════════════════════════════════════════════════════════
router.get('/schedule', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const startDate = req.query.start_date || null;
    const endDate   = req.query.end_date || null;

    const conditions = ['s.deleted_at IS NULL'];
    const params = [];

    if (startDate) {
      conditions.push('s.date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('s.date <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Slot listing with fill status
    const [slots] = await query(
      `SELECT s.id, s.title, s.date, s.start_time, s.end_time,
              s.capacity, s.booking_count, s.status,
              (s.capacity - s.booking_count) AS remaining_capacity,
              CASE
                WHEN s.booking_count = 0 THEN 'empty'
                WHEN s.booking_count >= s.capacity THEN 'full'
                ELSE 'partial'
              END AS fill_status
       FROM slots s
       WHERE ${whereClause}
       ORDER BY s.date ASC, s.start_time ASC`,
      params
    );

    // FR-08: "summary statistics"
    const [statsRows] = await query(
      `SELECT
         COUNT(*) AS total_slots,
         COALESCE(SUM(s.booking_count), 0) AS total_bookings,
         COALESCE(SUM(s.capacity), 0) AS total_capacity,
         CASE
           WHEN SUM(s.capacity) > 0
           THEN CONCAT(ROUND(SUM(s.booking_count) / SUM(s.capacity) * 100, 1), '%')
           ELSE '0%'
         END AS fill_rate,
         SUM(CASE WHEN s.booking_count = 0 THEN 1 ELSE 0 END) AS empty_slots,
         SUM(CASE WHEN s.booking_count > 0 AND s.booking_count < s.capacity THEN 1 ELSE 0 END) AS partial_slots,
         SUM(CASE WHEN s.booking_count >= s.capacity THEN 1 ELSE 0 END) AS full_slots
       FROM slots s
       WHERE ${whereClause}`,
      params
    );

    return res.status(200).json({
      slots,
      stats: statsRows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/reminder-settings — FR-10 optional reminder config
// ═══════════════════════════════════════════════════════════════════════════
router.get('/reminder-settings', authenticateJWT, requireRole('admin'), async (_req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT reminders_enabled, reminder_hours, updated_at
       FROM reminder_settings
       WHERE id = 1
       LIMIT 1`
    );

    if (rows.length === 0) {
      return res.status(200).json({
        settings: {
          reminders_enabled: false,
          reminder_hours: 24,
          updated_at: null,
        },
      });
    }

    return res.status(200).json({
      settings: {
        reminders_enabled: !!rows[0].reminders_enabled,
        reminder_hours: rows[0].reminder_hours,
        updated_at: rows[0].updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/admin/reminder-settings — FR-10 optional reminder config
// ═══════════════════════════════════════════════════════════════════════════
router.put('/reminder-settings', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const remindersEnabled = !!req.body?.reminders_enabled;
    const reminderHours = parseInt(req.body?.reminder_hours, 10);

    if (![24, 48, 168].includes(reminderHours)) {
      return res.status(400).json({
        error: 'reminder_hours must be one of: 24, 48, 168.',
        code: 'VALIDATION_ERROR',
      });
    }

    await query(
      `INSERT INTO reminder_settings (id, reminders_enabled, reminder_hours, updated_by, updated_at)
       VALUES (1, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         reminders_enabled = VALUES(reminders_enabled),
         reminder_hours = VALUES(reminder_hours),
         updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      [remindersEnabled ? 1 : 0, reminderHours, req.user.id]
    );

    return res.status(200).json({
      message: 'Reminder settings updated.',
      settings: {
        reminders_enabled: remindersEnabled,
        reminder_hours: reminderHours,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
