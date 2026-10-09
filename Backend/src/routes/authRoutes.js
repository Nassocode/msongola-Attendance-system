const express = require('express');
const { login, logout, currentUser, updateProfile, changePassword } = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, currentUser);
router.patch('/profile', requireAuth, updateProfile);
router.post('/change-password', requireAuth, changePassword);

module.exports = router;