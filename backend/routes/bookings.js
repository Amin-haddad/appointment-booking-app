// File: backend/routes/bookings.js
// SRS References: FR-05 (Pages 6-7), FR-06 (Page 7), FR-07 (Page 7)
// FR-05: Book appointment with SELECT ... FOR UPDATE race-condition prevention
// FR-06: Cancel appointment — status transition, capacity restoration
// FR-07: View booking history — client (own) and admin (all)

import { Router } from 'express';
import { query, getConnection } from '../database/connection.js';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { validateCreateBooking, validateIdParam, validatePaginationQuery } from '../middleware/validation.js';
import { enqueueEmail } from '../utils/email.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bookings — FR-05: Book an Appointment
// [SRS Section 3.5, Pages 6-7]
// "database-level lock (SELECT ... FOR UPDATE within a transaction)
//  to prevent race conditions when multiple clients attempt to book
//  the same slot simultaneously"
// ═══════════════════════════════════════════════════════════════════════════
router.post('/', authenticateJWT, requireRole('client', 'admin'), validateCreateBooking, async (req, res, next) => {
  const { slot_id } = req.body;
  const clientId = req.user.id;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // FR-05: "SELECT ... FOR UPDATE within a transaction" — row lock on slot
    // Prevents double-booking under concurrent load [SRS Risk #1, Page 12]
    const [slotRows] = await conn.execute(
      `SELECT id, title, date, start_time, end_time, capacity, booking_count, status, deleted_at
       FROM slots
       WHERE id = ? FOR UPDATE`,
      [slot_id]
    );

    if (slotRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Slot not found.', code: 'NOT_FOUND' });
    }

    const slot = slotRows[0];

    // Slot must be active and not soft-deleted
    if (slot.deleted_at !== null || slot.status !== 'active') {
      await conn.rollback();
      return res.status(404).json({ error: 'This slot is no longer available.', code: 'SLOT_INACTIVE' });
    }
console.log('DEBUG - Slot:', { id: slot.id, booking_count: slot.booking_count, capacity: slot.capacity });
    // FR-05: "If the slot becomes fully booked during the transaction,
    // the system returns a clear error message"
    console.log('=== BOOKING ATTEMPT === slot id:', slot_id, 'booking_count:', slot.booking_count, 'capacity:', slot.capacity);
    if (slot.booking_count >= slot.capacity) {
      await conn.rollback();
      return res.status(409).json({
        error: 'This slot is fully booked. Please select another slot.',
        code: 'SLOT_FULL',
      });
    }

    // Check if client already booked this slot — uq_bookings_client_slot [BP]
    const [existingBooking] = await conn.execute(
      `SELECT id, status FROM bookings WHERE client_id = ? AND slot_id = ?`,
      [clientId, slot_id]
    );

    if (existingBooking.length > 0 && existingBooking[0].status === 'confirmed') {
      await conn.rollback();
      return res.status(409).json({
        error: 'You have already booked this slot.',
        code: 'DUPLICATE_BOOKING',
      });
    }

    // FR-05: "booking record includes the client ID, slot ID, booking timestamp,
    //         and an initial status of 'confirmed'"
    let bookingId;

    if (existingBooking.length > 0 && existingBooking[0].status === 'cancelled') {
      // Re-book a previously cancelled slot — update existing record
      await conn.execute(
        `UPDATE bookings SET status = 'confirmed', booked_at = NOW(),
                cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL
         WHERE id = ?`,
        [existingBooking[0].id]
      );
      bookingId = existingBooking[0].id;
    } else {
      const [result] = await conn.execute(
        `INSERT INTO bookings (client_id, slot_id, status, booked_at)
         VALUES (?, ?, 'confirmed', NOW())`,
        [clientId, slot_id]
      );
      bookingId = result.insertId;
    }

    // Increment denormalized booking counter
    await conn.execute(
      `UPDATE slots SET booking_count = booking_count + 1 WHERE id = ?`,
      [slot_id]
    );

    await conn.commit();

    // FR-10 + FR-05: "a confirmation must be displayed to the client and an email sent"
    await enqueueEmail('booking_confirmation', req.user.email, clientId, {
      name:      req.user.full_name,
      slotTitle: slot.title,
      slotDate:  slot.date,
      startTime: slot.start_time,
     endTime:   slot.end_time,
     bookingId,
    }, bookingId);

    // FR-05: "201 Created"
    return res.status(201).json({
      message: 'Appointment booked successfully.',
      booking: {
        id:         bookingId,
        client_id:  clientId,
        slot_id:    slot.id,
        slot_title: slot.title,
        slot_date:  slot.date,
        start_time: slot.start_time,
        end_time:   slot.end_time,
        status:     'confirmed',
        booked_at:  new Date().toISOString(),
      },
    });
  } catch (err) {
    await conn.rollback();

    // Handle duplicate key constraint — secondary safeguard for race conditions
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'You have already booked this slot.',
        code: 'DUPLICATE_BOOKING',
      });
    }

    next(err);
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bookings — FR-07: Client Booking History
// [SRS Section 3.7, Page 7]
// "reverse chronological order (most recent first)"
// "filtering by status and date range…server-side pagination"
// ═══════════════════════════════════════════════════════════════════════════
router.get('/', authenticateJWT, validatePaginationQuery, async (req, res, next) => {
  try {
    const clientId  = req.user.id;
    const page      = parseInt(req.query.page, 10) || 1;
    const limit     = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset    = (page - 1) * limit;
    const status    = req.query.status || null;
    const startDate = req.query.start_date || null;
    const endDate   = req.query.end_date || null;

    const conditions = ['b.client_id = ?'];
    const params = [clientId];

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

    const whereClause = conditions.join(' AND ');

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // FR-07: "reverse chronological order (most recent first)"
   const [bookings] = await query(
      `SELECT b.id, b.client_id, b.slot_id, b.status, b.booked_at, b.cancelled_at,
              b.cancellation_reason,
              s.title AS slot_title, s.date AS slot_date,
              s.start_time, s.end_time
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       WHERE ${whereClause}
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
// GET /api/bookings/:id — FR-07: Single Booking Detail
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:id', authenticateJWT, validateIdParam, async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT b.id, b.client_id, b.slot_id, b.status, b.booked_at,
              b.cancelled_at, b.cancellation_reason,
              s.title AS slot_title, s.date AS slot_date,
              s.start_time, s.end_time
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       WHERE b.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found.', code: 'NOT_FOUND' });
    }

    // FR-07: clients can only see their own bookings; admins can see all
    if (req.user.role !== 'admin' && rows[0].client_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.', code: 'FORBIDDEN' });
    }

    return res.status(200).json({ booking: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/bookings/:id — FR-06: Cancel an Appointment (Client)
// [SRS Section 3.6, Page 7]
// "Upon cancellation, the slot capacity must be incremented immediately"
// "booking status transitions from 'confirmed' to 'cancelled'"
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/:id', authenticateJWT, validateIdParam, async (req, res, next) => {
  const bookingId = req.params.id;
  const userId = req.user.id;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Lock booking row
    const [bookingRows] = await conn.execute(
      `SELECT b.id, b.client_id, b.slot_id, b.status,
              s.title AS slot_title, s.date AS slot_date,
              s.start_time, s.end_time
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       WHERE b.id = ? FOR UPDATE`,
      [bookingId]
    );

    if (bookingRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Booking not found.', code: 'NOT_FOUND' });
    }

    const booking = bookingRows[0];

    // Ownership check — clients cancel their own; admins can cancel any
    if (req.user.role !== 'admin' && booking.client_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: 'You can only cancel your own bookings.', code: 'FORBIDDEN' });
    }

    // Already cancelled — 409
    if (booking.status === 'cancelled') {
      await conn.rollback();
      return res.status(409).json({
        error: 'This booking is already cancelled.',
        code: 'ALREADY_CANCELLED',
      });
    }

    // FR-06: "status transitions from 'confirmed' to 'cancelled' and the
    //         cancellation timestamp is recorded"
    const reason = req.body?.cancellation_reason || 'Cancelled by user';
    await conn.execute(
      `UPDATE bookings SET status = 'cancelled', cancellation_reason = ?,
              cancelled_at = NOW(), cancelled_by = ?
       WHERE id = ?`,
      [reason, userId, bookingId]
    );

    // FR-06: "slot capacity must be incremented immediately"
    await conn.execute(
      `UPDATE slots SET booking_count = GREATEST(booking_count - 1, 0) WHERE id = ?`,
      [booking.slot_id]
    );

    await conn.commit();

    // FR-06 + FR-10: "A cancellation confirmation email shall be sent to the client"
    const [clientRows] = await query(`SELECT email, full_name FROM users WHERE id = ?`, [booking.client_id]);
    const client = clientRows[0];

    await enqueueEmail('booking_cancellation', client.email, booking.client_id, {
      name:      client.full_name,
      slotTitle: booking.slot_title,
      slotDate:  booking.slot_date,
      startTime: booking.start_time,
      endTime:   booking.end_time,
      bookingId,
      reason,
    }, bookingId);

    // FR-06: "Administrators may also cancel bookings… both client and admin receive emails"
    if (req.user.role === 'admin' && booking.client_id !== userId) {
      await enqueueEmail('booking_cancellation', req.user.email, userId, {
        name:      req.user.full_name,
        slotTitle: booking.slot_title,
        slotDate:  booking.slot_date,
      startTime: booking.start_time,
        endTime:   booking.end_time,
        bookingId,
        reason:    `[Admin] ${reason}`,
      }, bookingId);
    }

    return res.status(200).json({
      message: 'Booking cancelled successfully.',
      booking: {
        id:           bookingId,
        status:       'cancelled',
        cancelled_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

export default router;
