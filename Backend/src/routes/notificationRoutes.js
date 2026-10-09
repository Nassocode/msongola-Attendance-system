const express = require('express');
const { listNotifications, markNotificationRead } = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);
router.get('/', listNotifications);
router.patch('/:notificationId/read', markNotificationRead);

module.exports = router;