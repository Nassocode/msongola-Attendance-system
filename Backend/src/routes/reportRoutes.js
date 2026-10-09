const express = require('express');
const { monthlyReport } = require('../controllers/reportController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/monthly', requireAuth, requireRole('admin', 'teacher', 'academic_master'), monthlyReport);

module.exports = router;