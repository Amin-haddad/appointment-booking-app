import { Router } from 'express';
import { query } from '../database/connection.js';
import { authenticateJWT } from '../middleware/auth.js';
import { validateIdParam } from '../middleware/validation.js';

const router = Router();

router.get('/', authenticateJWT, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const status = (req.query.status || 'all').toString();

    const conditions = ['user_id = ?'];
    const params = [req.user.id];

    if (status === 'unread') {
      conditions.push('read_at IS NULL');
    }

    const [rows] = await query(
      `SELECT id, type, title, message, payload, created_at, read_at
       FROM in_app_notifications
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...params, limit]
    );

    return res.status(200).json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', authenticateJWT, validateIdParam, async (req, res, next) => {
  try {
    const [result] = await query(
      `UPDATE in_app_notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found.', code: 'NOT_FOUND' });
    }

    return res.status(200).json({ message: 'Notification marked as read.' });
  } catch (err) {
    next(err);
  }
});

router.patch('/read-all', authenticateJWT, async (req, res, next) => {
  try {
    const [result] = await query(
      `UPDATE in_app_notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE user_id = ?`,
      [req.user.id]
    );

    return res.status(200).json({
      message: 'Notifications marked as read.',
      updated: result.affectedRows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

