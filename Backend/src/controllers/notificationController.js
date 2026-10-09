const pool = require('../config/database');

async function listNotifications(req, res, next) {
  try {
    const [[{ unreadCount }]] = await pool.execute(
      'SELECT COUNT(*) AS unreadCount FROM user_notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    const [notifications] = await pool.execute(
      `SELECT n.id, n.notification_type AS type, n.class_id AS classId,
              n.related_date AS relatedDate, n.title, n.message,
              n.read_at AS readAt, n.created_at AS createdAt, c.name AS className
       FROM user_notifications n
       LEFT JOIN classes c ON c.id = n.class_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    return res.json({ unreadCount: Number(unreadCount), notifications });
  } catch (error) {
    return next(error);
  }
}

async function markNotificationRead(req, res, next) {
  const notificationId = Number(req.params.notificationId);
  if (!Number.isSafeInteger(notificationId) || notificationId < 1) {
    return res.status(400).json({ error: 'A valid notification ID is required.' });
  }
  try {
    const [result] = await pool.execute(
      'UPDATE user_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?',
      [notificationId, req.user.id]
    );
    if (result.affectedRows === 0) {
      const [notifications] = await pool.execute(
        'SELECT id FROM user_notifications WHERE id = ? AND user_id = ?',
        [notificationId, req.user.id]
      );
      if (!notifications[0]) {
        return res.status(404).json({ error: 'The notification was not found.' });
      }
    }
    return res.json({ notificationId, read: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listNotifications, markNotificationRead };