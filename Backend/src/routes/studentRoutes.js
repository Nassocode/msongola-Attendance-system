const express = require('express');
const { createStudent, listStudents } = require('../controllers/studentController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth, requireRole('admin', 'teacher'));
router.get('/', listStudents);
router.post('/', requireRole('admin'), createStudent);

module.exports = router;