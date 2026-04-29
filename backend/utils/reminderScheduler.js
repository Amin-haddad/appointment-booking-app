import { config } from '../config/env.js';
import { query } from '../database/connection.js';
import { enqueueEmail } from './email.js';

let reminderTimer = null;

const ALLOWED_REMINDER_HOURS = new Set([24, 48, 168]);

async function loadReminderSettings() {
  const [rows] = await query(
    `SELECT reminders_enabled, reminder_hours
     FROM reminder_settings
     WHERE id = 1
     LIMIT 1`
  );

  if (rows.length === 0) {
    return { reminders_enabled: 0, reminder_hours: 24 };
  }

  const reminderHours = ALLOWED_REMINDER_HOURS.has(rows[0].reminder_hours)
    ? rows[0].reminder_hours
    : 24;

  return {
    reminders_enabled: rows[0].reminders_enabled ? 1 : 0,
    reminder_hours: reminderHours,
  };
}

async function dispatchScheduledReminders() {
  const settings = await loadReminderSettings();
  if (!settings.reminders_enabled) {
    return;
  }

  const now = new Date();
  const leadHours = settings.reminder_hours;
  const windowStart = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
  const windowEnd = new Date(
    windowStart.getTime() + config.reminders.pollIntervalMinutes * 60 * 1000
  );

  const [rows] = await query(
    `SELECT b.id AS booking_id, b.client_id,
            u.email AS client_email, u.full_name AS client_name,
            s.title AS slot_title, s.date AS slot_date, s.start_time, s.end_time,
            TIMESTAMP(s.date, s.start_time) AS slot_start_at
     FROM bookings b
     JOIN users u ON u.id = b.client_id
     JOIN slots s ON s.id = b.slot_id
     WHERE b.status = 'confirmed'
       AND s.status = 'active'
       AND s.deleted_at IS NULL
       AND TIMESTAMP(s.date, s.start_time) >= ?
       AND TIMESTAMP(s.date, s.start_time) < ?`,
    [windowStart, windowEnd]
  );

  for (const row of rows) {
    const [insertResult] = await query(
      `INSERT IGNORE INTO booking_reminder_log
         (booking_id, reminder_hours, scheduled_for)
       VALUES (?, ?, ?)`,
      [row.booking_id, leadHours, row.slot_start_at]
    );

    if (insertResult.affectedRows === 0) {
      continue;
    }

    try {
      await enqueueEmail(
        'appointment_reminder',
        row.client_email,
        row.client_id,
        {
          name: row.client_name,
          slotTitle: row.slot_title,
          slotDate: row.slot_date,
          startTime: row.start_time,
          endTime: row.end_time,
          bookingId: row.booking_id,
        },
        row.booking_id
      );

      await query(
        `UPDATE booking_reminder_log
         SET sent_at = NOW(), error_message = NULL
         WHERE booking_id = ? AND reminder_hours = ?`,
        [row.booking_id, leadHours]
      );
    } catch (err) {
      await query(
        `UPDATE booking_reminder_log
         SET error_message = ?
         WHERE booking_id = ? AND reminder_hours = ?`,
        [err.message, row.booking_id, leadHours]
      );
    }
  }
}

export function startReminderScheduler() {
  if (reminderTimer) return;

  const intervalMs = config.reminders.pollIntervalMinutes * 60 * 1000;

  dispatchScheduledReminders().catch((err) => {
    console.error('[ReminderScheduler] Initial run failed:', err.message);
  });

  reminderTimer = setInterval(() => {
    dispatchScheduledReminders().catch((err) => {
      console.error('[ReminderScheduler] Scheduled run failed:', err.message);
    });
  }, intervalMs);
}

export function stopReminderScheduler() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

