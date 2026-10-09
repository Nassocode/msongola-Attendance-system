const express = require('express');
const { getAttendance, reviewAttendance, saveAttendance } = require('../controllers/attendanceController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);
router.get('/', requireRole('admin', 'teacher', 'academic_master'), getAttendance);
router.post('/', requireRole('teacher'), saveAttendance);
router.post('/:submissionId/review', requireRole('academic_master'), reviewAttendance);

module.exports = router;