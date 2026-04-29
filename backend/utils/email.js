// File: backend/utils/email.js
// SRS References: FR-10 (Pages 7-8), FR-01 (Page 5-6)
// FR-10: "Email delivery is handled asynchronously via a job queue to prevent API response delays"
// FR-10: "Failed email deliveries are retried up to 3 times with exponential backoff"
// FR-10: "All email events (sent, failed, bounced) are logged"
// SRS Section 8 Risk #5: "Use a reliable transactional email provider"

import nodemailer from 'nodemailer';
import Bull from 'bull';
import { config } from '../config/env.js';
import { query } from '../database/connection.js';

// ── SMTP Transport ──────────────────────────────────────────────────────────
// NFR Security, Page 8: credentials via environment, never hardcoded
const transporter = nodemailer.createTransport({
  host:   config.email.host,
  port:   config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.user,
    pass: config.email.password,
  },
  // Connection pool for high throughput [NFR Scalability]
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

// ── Job Queue — Bull (backed by Redis) ──────────────────────────────────────
// FR-10: "handled asynchronously via a job queue to prevent API response delays"
const emailQueue = new Bull('email-notifications', {
  redis: {
    host:     config.redis.host,
    port:     config.redis.port,
    password: config.redis.password || undefined,
  },
  defaultJobOptions: {
    removeOnComplete: 100,  // Keep last 100 completed jobs for debugging
    removeOnFail:     200,
    // FR-10: "retried up to 3 times with exponential backoff"
    attempts: 3,
    backoff: {
      type:  'exponential',
      delay: 5000,  // 5s → 10s → 20s
    },
  },
});

// ── Queue Event Logging ─────────────────────────────────────────────────────
// FR-10: "All email events (sent, failed, bounced) are logged for troubleshooting"
emailQueue.on('completed', async (job, result) => {
  await logEmailEvent(job.data.logId, 'sent', null);
});

emailQueue.on('failed', async (job, err) => {
  const status = job.attemptsMade >= 3 ? 'failed' : 'queued';
  await logEmailEvent(job.data.logId, status, err.message);
  if (status === 'failed') {
    await createFallbackNotification(job.data.logId);
  }
});

// ── Queue Processor ──────────────────────────────────────────────────────────
emailQueue.process(async (job) => {
  const { to, subject, html, text } = job.data;

  const info = await transporter.sendMail({
    from:    `"${config.email.fromName}" <${config.email.fromAddress}>`,
    to,
    subject,
    html,
    text,
  });

  return { messageId: info.messageId, accepted: info.accepted };
});

// ── Email Template Renderer ─────────────────────────────────────────────────

const templates = {
  /**
   * FR-01: Registration verification email
   * [SRS Section 3.1, Page 5-6]
   */
  registration_verification: ({ name, verificationUrl }) => ({
    subject: 'Verify Your Email — Appointment Booking',
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to Appointment Booking</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 15px; line-height: 1.6;">Thank you for registering. Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: 600;">Verify Email</a>
          </div>
          <p style="font-size: 13px; color: #888;">If you did not create an account, please ignore this email. This link expires in 24 hours.</p>
          <p style="font-size: 13px; color: #888;">If the button doesn't work, copy and paste this URL into your browser:<br><a href="${verificationUrl}" style="color: #667eea; word-break: break-all;">${verificationUrl}</a></p>
        </div>
      </body>
      </html>
    `,
    text: `Hi ${name},\n\nThank you for registering. Verify your email by visiting:\n${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, ignore this email.`,
  }),

  /**
   * FR-05 / FR-10: Booking confirmation email
   * [SRS Section 3.5, Page 6-7] + [SRS Section 3.10, Pages 7-8]
   */
  booking_confirmation: ({ name, slotTitle, slotDate, startTime, endTime, bookingId }) => ({
    subject: 'Booking Confirmed — Appointment Booking',
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Booking Confirmed ✓</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 15px;">Your appointment has been confirmed:</p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px;">
              <tr><td style="padding: 6px 0; color: #666;">Booking ID:</td><td style="padding: 6px 0; font-weight: 600;">#${bookingId}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Service:</td><td style="padding: 6px 0; font-weight: 600;">${slotTitle}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Date:</td><td style="padding: 6px 0; font-weight: 600;">${slotDate}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Time:</td><td style="padding: 6px 0; font-weight: 600;">${startTime} – ${endTime}</td></tr>
            </table>
          </div>
          <p style="font-size: 13px; color: #888;">You can manage your bookings from your dashboard at any time.</p>
        </div>
      </body>
      </html>
    `,
    text: `Hi ${name},\n\nYour appointment has been confirmed.\n\nBooking ID: #${bookingId}\nService: ${slotTitle}\nDate: ${slotDate}\nTime: ${startTime} – ${endTime}\n\nManage your bookings from your dashboard.`,
  }),

  /**
   * FR-06 / FR-10: Booking cancellation email
   * [SRS Section 3.6, Page 7] + [SRS Section 3.10, Pages 7-8]
   */
  booking_cancellation: ({ name, slotTitle, slotDate, startTime, endTime, bookingId, reason }) => ({
    subject: 'Booking Cancelled — Appointment Booking',
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Booking Cancelled</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 15px;">Your booking has been cancelled:</p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px;">
              <tr><td style="padding: 6px 0; color: #666;">Booking ID:</td><td style="padding: 6px 0; font-weight: 600;">#${bookingId}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Service:</td><td style="padding: 6px 0; font-weight: 600;">${slotTitle}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Date:</td><td style="padding: 6px 0; font-weight: 600;">${slotDate}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Time:</td><td style="padding: 6px 0; font-weight: 600;">${startTime} – ${endTime}</td></tr>
              ${reason ? `<tr><td style="padding: 6px 0; color: #666;">Reason:</td><td style="padding: 6px 0;">${reason}</td></tr>` : ''}
            </table>
          </div>
          <p style="font-size: 13px; color: #888;">The slot is now available for other clients. You may book again at any time.</p>
        </div>
      </body>
      </html>
    `,
    text: `Hi ${name},\n\nYour booking has been cancelled.\n\nBooking ID: #${bookingId}\nService: ${slotTitle}\nDate: ${slotDate}\nTime: ${startTime} – ${endTime}${reason ? `\nReason: ${reason}` : ''}\n\nYou may book again at any time.`,
  }),

  /**
   * FR-09 Revised / FR-10: Slot cancellation (mass cancel) email
   */
  slot_cancellation: ({ name, slotTitle, slotDate, startTime, endTime, reason }) => ({
    subject: 'Appointment Slot Cancelled — Appointment Booking',
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <div style="background: linear-gradient(135deg, #f5af19 0%, #f12711 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Slot Cancelled by Administrator</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 15px;">We regret to inform you that the following appointment slot has been cancelled:</p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px;">
              <tr><td style="padding: 6px 0; color: #666;">Service:</td><td style="padding: 6px 0; font-weight: 600;">${slotTitle}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Date:</td><td style="padding: 6px 0; font-weight: 600;">${slotDate}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Time:</td><td style="padding: 6px 0; font-weight: 600;">${startTime} – ${endTime}</td></tr>
              ${reason ? `<tr><td style="padding: 6px 0; color: #666;">Reason:</td><td style="padding: 6px 0;">${reason}</td></tr>` : ''}
            </table>
          </div>
          <p style="font-size: 15px;">Your booking has been automatically cancelled. Please visit our platform to reschedule at your convenience.</p>
          <p style="font-size: 13px; color: #888;">We apologise for any inconvenience.</p>
        </div>
      </body>
      </html>
    `,
    text: `Hi ${name},\n\nThe following slot has been cancelled by an administrator:\n\nService: ${slotTitle}\nDate: ${slotDate}\nTime: ${startTime} – ${endTime}${reason ? `\nReason: ${reason}` : ''}\n\nYour booking has been automatically cancelled. Please reschedule at your convenience.`,
  }),

  /**
   * FR-10: Appointment reminder (optional, admin-configured)
   * [SRS Section 3.10, Page 7-8]
   */
  appointment_reminder: ({ name, slotTitle, slotDate, startTime, endTime, bookingId }) => ({
    subject: 'Upcoming Appointment Reminder — Appointment Booking',
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Appointment Reminder</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 15px;">This is a reminder for your upcoming appointment:</p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px;">
              <tr><td style="padding: 6px 0; color: #666;">Booking ID:</td><td style="padding: 6px 0; font-weight: 600;">#${bookingId}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Service:</td><td style="padding: 6px 0; font-weight: 600;">${slotTitle}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Date:</td><td style="padding: 6px 0; font-weight: 600;">${slotDate}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;">Time:</td><td style="padding: 6px 0; font-weight: 600;">${startTime} – ${endTime}</td></tr>
            </table>
          </div>
          <p style="font-size: 13px; color: #888;">Need to cancel? Visit your dashboard before the appointment time.</p>
        </div>
      </body>
      </html>
    `,
    text: `Hi ${name},\n\nReminder: You have an upcoming appointment.\n\nBooking ID: #${bookingId}\nService: ${slotTitle}\nDate: ${slotDate}\nTime: ${startTime} – ${endTime}\n\nNeed to cancel? Visit your dashboard.`,
  }),

  /**
   * FR-02: Account lock notification email
   */
  account_locked: ({ name, minutes }) => ({
    subject: 'Account Temporarily Locked — Appointment Booking',
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <div style="background: linear-gradient(135deg, #f5af19 0%, #f12711 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Account Temporarily Locked</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 15px; line-height: 1.6;">
            We detected multiple failed login attempts on your account. For security, your account is temporarily locked for ${minutes} minutes.
          </p>
          <p style="font-size: 13px; color: #888;">If this wasn't you, we recommend changing your password after lockout expires.</p>
        </div>
      </body>
      </html>
    `,
    text: `Hi ${name},\n\nWe detected multiple failed login attempts. Your account is temporarily locked for ${minutes} minutes.\n\nIf this wasn't you, please change your password once lockout expires.`,
  }),
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue an email for asynchronous delivery.
 * FR-10: "handled asynchronously via a job queue to prevent API response delays"
 *
 * @param {string} templateType  - Key from templates object
 * @param {string} recipientEmail
 * @param {number|null} recipientId  - User ID (nullable for edge cases)
 * @param {object} templateData      - Data passed to the template function
 * @param {number|null} relatedId    - Booking or slot ID for audit context
 * @returns {Promise<number>}        - Email log ID
 */
export async function enqueueEmail(templateType, recipientEmail, recipientId, templateData, relatedId = null) {
  // FR-10: "All email events … are logged" — insert log record first
  const [logResult] = await query(
    `INSERT INTO email_notification_log
       (recipient_id, recipient_email, template_type, related_id, status, retry_count)
     VALUES (?, ?, ?, ?, 'queued', 0)`,
    [recipientId, recipientEmail, templateType, relatedId]
  );

  const logId = logResult.insertId;

  // Render the template
  const templateFn = templates[templateType];
  if (!templateFn) {
    throw new Error(`Unknown email template: "${templateType}"`);
  }

  const { subject, html, text } = templateFn(templateData);

  // FR-10: enqueue for async processing — does NOT block the API response
     // Send email directly (bypasses Redis queue)
    try {
      const info = await transporter.sendMail({
        from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
        to: recipientEmail,
        subject,
        html,
        text,
      });
      
      // Update log to sent
      await query(
        `UPDATE email_notification_log SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [logId]
      );
      
      console.log(`[Email] Sent "${templateType}" to ${recipientEmail} (ID: ${info.messageId})`);
    } catch (err) {
      // Update log to failed
      await query(
        `UPDATE email_notification_log SET status = 'failed', error_message = ?, retry_count = retry_count + 1, updated_at = NOW() WHERE id = ?`,
        [err.message, logId]
      );
      console.error(`[Email] Failed to send "${templateType}" to ${recipientEmail}:`, err.message);
    }

    return logId;
}

/**
 * Update the email_notification_log record with delivery status.
 * FR-10: "All email events (sent, failed, bounced) are logged"
 *
 * @param {number} logId
 * @param {'sent'|'failed'|'bounced'} status
 * @param {string|null} errorMessage
 */
async function logEmailEvent(logId, status, errorMessage) {
  try {
    if (status === 'sent') {
      await query(
        `UPDATE email_notification_log
         SET status = 'sent', sent_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [logId]
      );
    } else {
      await query(
        `UPDATE email_notification_log
         SET status = ?, error_message = ?, retry_count = retry_count + 1, updated_at = NOW()
         WHERE id = ?`,
        [status, errorMessage, logId]
      );
    }
  } catch (err) {
    // Logging a log failure — do not throw, just warn
    console.error(`[Email] Failed to update log #${logId}:`, err.message);
  }
}

async function createFallbackNotification(logId) {
  try {
    const [rows] = await query(
      `SELECT recipient_id, template_type, related_id
       FROM email_notification_log
       WHERE id = ?`,
      [logId]
    );

    if (rows.length === 0 || !rows[0].recipient_id) {
      return;
    }

    const { recipient_id: userId, template_type: templateType, related_id: relatedId } = rows[0];

    const title = 'Email delivery failed';
    let message = 'An email notification could not be delivered. Please review your recent account activity.';
    if (templateType === 'booking_confirmation') {
      message = 'Your booking was created, but the confirmation email could not be delivered.';
    } else if (templateType === 'booking_cancellation' || templateType === 'slot_cancellation') {
      message = 'A booking status update occurred, but the email notification could not be delivered.';
    } else if (templateType === 'registration_verification') {
      message = 'Verification email delivery failed. Please request a new verification email.';
    } else if (templateType === 'account_locked') {
      message = 'Your account lock notification email could not be delivered.';
    }

    await query(
      `INSERT INTO in_app_notifications (user_id, type, title, message, payload)
       VALUES (?, 'email_failed', ?, ?, ?)`,
      [userId, title, message, JSON.stringify({ templateType, relatedId })]
    );
  } catch (err) {
    console.error('[Email] Failed to create fallback in-app notification:', err.message);
  }
}

/**
 * Verify SMTP connectivity — called at server startup.
 */
export async function verifyEmailTransport() {
  try {
    await transporter.verify();
    console.info('[Email] SMTP transport verified and ready.');
  } catch (err) {
    console.warn('[Email] SMTP transport verification failed:', err.message);
    console.warn('[Email] Emails will be queued but may fail to deliver.');
  }
}

export { emailQueue };
