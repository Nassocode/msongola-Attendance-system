const express = require('express');
const {
  createAcademicMaster,
  createTeacher,
  updateStaffAccount,
  listAcademicMasters,
  listSmsLogs,
  listTeachers,
  assignTeacher,
  retrySmsLog,
  overview
} = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));
router.get('/overview', overview);
router.post('/teachers', createTeacher);
router.get('/teachers', listTeachers);
router.post('/academic-masters', createAcademicMaster);
router.get('/academic-masters', listAcademicMasters);
router.put('/staff/:userId', updateStaffAccount);
router.post('/classes/:classId/teachers', assignTeacher);
router.get('/sms-logs', listSmsLogs);
router.post('/sms-logs/:logId/retry', retrySmsLog);

module.exports = router;