// File: backend/routes/slots.js
// SRS References: FR-03 (Pages 5-6), FR-04 (Page 6), FR-09 (Page 7)
// FR-03: Slot creation with overlap detection (409 Conflict)
// FR-04: Browse available slots with date-range filter, pagination
// FR-09: Soft-delete with active-booking safeguard

import { Router } from 'express';
import { query, getConnection } from '../database/connection.js';
import { authenticateJWT, requireRole, optionalAuth } from '../middleware/auth.js';
import { validateCreateSlot, validateIdParam, validatePaginationQuery } from '../middleware/validation.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/slots — FR-04: Browse Available Slots (Public)
// [SRS Section 3.4, Page 6]
// "date-range filtering and pagination to handle large datasets efficiently"
// "read-optimized query with indexed columns on date and status"
// ═══════════════════════════════════════════════════════════════════════════
router.get('/', optionalAuth, validatePaginationQuery, async (req, res, next) => {
  try {
    const page      = parseInt(req.query.page, 10) || 1;
    const limit     = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset    = (page - 1) * limit;
    const startDate = req.query.start_date || null;
    const endDate   = req.query.end_date || null;

    // Build dynamic WHERE clause — parameterised to prevent SQL injection [NFR Security]
    const conditions = ['s.deleted_at IS NULL', "s.status = 'active'"];
    const params = [];

    // FR-04: date-range filtering
    if (startDate) {
      conditions.push('s.date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('s.date <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Count total for pagination metadata
  const [countRows] = await query(
  `SELECT COUNT(*) AS total FROM slots s WHERE ${whereClause}`,
  params
);
    const total = countRows[0].total;

 // FR-04: "sorted by date and time", "remaining capacity for each slot"
const [slots] = await query(
  `SELECT s.id, s.title, s.date, s.start_time, s.end_time,
          s.capacity, s.booking_count,
          (s.capacity - s.booking_count) AS remaining_capacity,
          s.status, s.is_recurring, s.created_at
   FROM slots s
   WHERE ${whereClause}
   ORDER BY s.date ASC, s.start_time ASC
   LIMIT ${limit} OFFSET ${offset}`,
  params
);


    return res.status(200).json({
      slots,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/slots/:id — FR-04: Single Slot Detail
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:id', validateIdParam, async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT id, title, date, start_time, end_time, capacity, booking_count,
              (capacity - booking_count) AS remaining_capacity, status, is_recurring, created_at
       FROM slots
       WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Slot not found.', code: 'NOT_FOUND' });
    }

    return res.status(200).json({ slot: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/slots — FR-03: Slot Creation by Admin
// [SRS Section 3.3, Pages 5-6]
// "validate slots to prevent overlaps"
// "409 Conflict response with details of the overlapping slot"
// ═══════════════════════════════════════════════════════════════════════════
router.post('/', authenticateJWT, requireRole('admin'), validateCreateSlot, async (req, res, next) => {
  const { title, date, start_time, end_time, capacity = 1 } = req.body;
  const adminId = req.user.id;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // FR-03: overlap detection — "validate slots to prevent overlaps with existing slots"
    // Uses indexed columns: idx_slots_date_times (date, start_time, end_time)
    const [overlapping] = await conn.execute(
      `SELECT id, title, start_time, end_time
       FROM slots
       WHERE date = ?
         AND deleted_at IS NULL
         AND status = 'active'
         AND start_time < ?
         AND end_time   > ?
       FOR UPDATE`,
      [date, end_time, start_time]
    );

    // FR-03: "API returns a 409 Conflict response with details of the overlapping slot"
    if (overlapping.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: 'Slot overlaps with an existing slot.',
        code: 'SLOT_OVERLAP',
        conflicting_slot: {
          id:         overlapping[0].id,
          title:      overlapping[0].title,
          start_time: overlapping[0].start_time,
          end_time:   overlapping[0].end_time,
        },
      });
    }

    // FR-03: "Each slot records its creator, creation timestamp, and current booking count"
    const [result] = await conn.execute(
      `INSERT INTO slots (title, date, start_time, end_time, capacity, booking_count, status, created_by)
       VALUES (?, ?, ?, ?, ?, 0, 'active', ?)`,
      [title, date, start_time, end_time, capacity, adminId]
    );

    await conn.commit();

    const [newSlot] = await query(
      `SELECT id, title, date, start_time, end_time, capacity, booking_count,
              (capacity - booking_count) AS remaining_capacity, status, created_at
       FROM slots WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({
      message: 'Slot created successfully.',
      slot: newSlot[0],
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/slots/recurring — FR-03: Recurring Slot Creation
// [SRS Section 3.3, Page 6]: "recurring slots (e.g., every Monday from 9:00 to 12:00)"
// ═══════════════════════════════════════════════════════════════════════════
router.post('/recurring', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  const { title, start_date, end_date, day_of_week, start_time, end_time, capacity = 1 } = req.body;
  const adminId = req.user.id;

  // Validate required fields
  if (!title || !start_date || !end_date || day_of_week === undefined || !start_time || !end_time) {
    return res.status(400).json({
      error: 'Missing required fields: title, start_date, end_date, day_of_week, start_time, end_time.',
    });
  }

  // Generate all dates matching day_of_week in the range
  const dayMap = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
  const dates = [];
  const current = new Date(start_date);
  const final = new Date(end_date);

  while (current <= final) {
    if (current.getDay() === parseInt(day_of_week, 10)) {
      dates.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }

  if (dates.length === 0) {
    return res.status(400).json({ error: 'No matching dates found in the specified range.' });
  }

  const conn = await getConnection();
  const createdSlots = [];
  const conflicts = [];

  try {
    await conn.beginTransaction();

    // Generate a recurrence group ID
    const groupId = Date.now();

    for (const date of dates) {
      // Check overlap for each date
      const [overlapping] = await conn.execute(
        `SELECT id, title, start_time, end_time
         FROM slots
         WHERE date = ? AND deleted_at IS NULL AND status = 'active'
           AND start_time < ? AND end_time > ?
         FOR UPDATE`,
        [date, end_time, start_time]
      );

      if (overlapping.length > 0) {
        conflicts.push({ date, conflicting_slot: overlapping[0] });
        continue;
      }

      const [result] = await conn.execute(
        `INSERT INTO slots (title, date, start_time, end_time, capacity, booking_count, status,
                           is_recurring, recurrence_rule, recurrence_group_id, created_by)
         VALUES (?, ?, ?, ?, ?, 0, 'active', 1, ?, ?, ?)`,
        [title, date, start_time, end_time, capacity,
         `RRULE:FREQ=WEEKLY;BYDAY=${dayMap[day_of_week]}`, groupId, adminId]
      );

      createdSlots.push({ id: result.insertId, date });
    }

    if (createdSlots.length === 0 && conflicts.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: 'All dates conflict with existing slots.',
        code: 'SLOT_OVERLAP',
        conflicts,
      });
    }

    await conn.commit();

    return res.status(201).json({
      message: `${createdSlots.length} recurring slot(s) created.`,
      created_slots: createdSlots,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/admin/slots/:id — FR-03: Update Slot
// ═══════════════════════════════════════════════════════════════════════════
router.put('/:id', authenticateJWT, requireRole('admin'), validateIdParam, async (req, res, next) => {
  const { title, date, start_time, end_time, capacity } = req.body;
  const slotId = req.params.id;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Lock and verify slot exists
    const [existing] = await conn.execute(
      `SELECT id, booking_count, capacity FROM slots
       WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [slotId]
    );

    if (existing.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Slot not found.', code: 'NOT_FOUND' });
    }

    // If capacity is being reduced, ensure it doesn't go below current booking count
    if (capacity !== undefined && capacity < existing[0].booking_count) {
      await conn.rollback();
      return res.status(409).json({
        error: `Cannot reduce capacity below current booking count (${existing[0].booking_count}).`,
        code: 'CAPACITY_CONFLICT',
      });
    }

    // If date/time changed, check for overlaps (excluding self)
    if (date && start_time && end_time) {
      const [overlapping] = await conn.execute(
        `SELECT id, title, start_time, end_time FROM slots
         WHERE date = ? AND deleted_at IS NULL AND status = 'active'
           AND id != ? AND start_time < ? AND end_time > ?
         FOR UPDATE`,
        [date, slotId, end_time, start_time]
      );

      if (overlapping.length > 0) {
        await conn.rollback();
        return res.status(409).json({
          error: 'Updated time range conflicts with an existing slot.',
          code: 'SLOT_OVERLAP',
          conflicting_slot: overlapping[0],
        });
      }
    }

    // Build dynamic UPDATE
    const updates = [];
    const params = [];
    if (title !== undefined)      { updates.push('title = ?');      params.push(title); }
    if (date !== undefined)       { updates.push('date = ?');       params.push(date); }
    if (start_time !== undefined) { updates.push('start_time = ?'); params.push(start_time); }
    if (end_time !== undefined)   { updates.push('end_time = ?');   params.push(end_time); }
    if (capacity !== undefined)   { updates.push('capacity = ?');   params.push(capacity); }

    if (updates.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'No fields to update.' });
    }

    params.push(slotId);
    await conn.execute(`UPDATE slots SET ${updates.join(', ')} WHERE id = ?`, params);
    await conn.commit();

    const [updated] = await query(
      `SELECT id, title, date, start_time, end_time, capacity, booking_count,
              (capacity - booking_count) AS remaining_capacity, status, created_at
       FROM slots WHERE id = ?`,
      [slotId]
    );

    return res.status(200).json({ message: 'Slot updated.', slot: updated[0] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/slots/:id — FR-09: Soft-Delete Slot
// [SRS Section 3.9, Page 7]
// If active bookings exist, deletion is rejected (409)
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/:id', authenticateJWT, requireRole('admin'), validateIdParam, async (req, res, next) => {
  const slotId = req.params.id;
  const adminUserId = req.user.id;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Step 1: Lock slot row
    const [slotRows] = await conn.execute(
      `SELECT id, title, date, start_time, end_time, booking_count, deleted_at
       FROM slots WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [slotId]
    );

    if (slotRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Slot not found or already deleted.', code: 'NOT_FOUND' });
    }

    // Step 2: Check for existing active bookings
    const [bookings] = await conn.execute(
      `SELECT b.id AS booking_id, b.client_id, u.email, u.full_name
       FROM bookings b JOIN users u ON u.id = b.client_id
       WHERE b.slot_id = ? AND b.status = 'confirmed'`,
      [slotId]
    );

    // FR-09: "If bookings exist, reject deletion and prompt to cancel first"
    if (bookings.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: 'Slot has active bookings. Cancel those bookings first, then delete the slot.',
        code: 'HAS_ACTIVE_BOOKINGS',
        active_booking_count: bookings.length,
        affected_clients: bookings.map((b) => ({ id: b.client_id, email: b.email })),
      });
    }

    // Step 3: Soft-delete the slot [FR-09: "marked as inactive"]
    await conn.execute(
      `UPDATE slots SET deleted_at = NOW(), deleted_by = ?, status = 'inactive' WHERE id = ?`,
      [adminUserId, slotId]
    );

    await conn.commit();

    return res.status(200).json({
      message: 'Slot deleted successfully.',
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

export default router;
