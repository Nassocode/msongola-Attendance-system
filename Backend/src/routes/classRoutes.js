const express = require('express');
const { createClass, listClasses } = require('../controllers/classController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);
router.get('/', requireRole('admin', 'teacher', 'academic_master'), listClasses);
router.post('/', requireRole('admin'), createClass);

module.exports = router;