const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { environment } = require('../config/environment');
const { hashPassword, verifyPassword } = require('../utils/password');

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const cookieOptions = {
  httpOnly: true,
  secure: environment.cookieSecure,
  sameSite: 'strict',
  maxAge: SESSION_MAX_AGE,
  path: '/'
};

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const [rows] = await pool.execute(
      "SELECT id, username, full_name, phone, password_hash, role, is_active FROM users WHERE username = ? AND role IN ('admin', 'teacher', 'academic_master') LIMIT 1",
      [username.trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'The username or password is incorrect.' });
    }

    const token = jwt.sign(
      { id: user.id, fullName: user.full_name, role: user.role },
      environment.jwtSecret,
      { algorithm: 'HS256', expiresIn: '8h' }
    );
    res.cookie('session', token, cookieOptions);
    return res.json({
      user: { id: user.id, username: user.username, fullName: user.full_name, phone: user.phone, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
}

function logout(req, res) {
  res.clearCookie('session', { ...cookieOptions, maxAge: undefined });
  return res.json({ message: 'Signed out.' });
}

async function updateProfile(req, res, next) {
  const { username, fullName, phone } = req.body || {};
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const cleanedPhone = typeof phone === 'string' ? phone.trim().replace(/[\s()-]/g, '') : '';
  const normalizedPhone = /^0\d{9}$/.test(cleanedPhone)
    ? `+255${cleanedPhone.slice(1)}`
    : /^255\d{9}$/.test(cleanedPhone)
      ? `+${cleanedPhone}`
      : cleanedPhone;
  if (
    !/^[a-zA-Z0-9._-]{3,50}$/.test(normalizedUsername) ||
    typeof fullName !== 'string' || !fullName.trim() || fullName.length > 160 ||
    typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)
  ) {
    return res.status(400).json({
      error: 'Provide a valid username (3-50 letters, numbers, dots, underscores or hyphens), full name, and international phone number.'
    });
  }
  try {
    const [result] = await pool.execute(
      "UPDATE users SET username = ?, full_name = ?, phone = ? WHERE id = ? AND is_active = TRUE AND role IN ('admin', 'teacher', 'academic_master')",
      [normalizedUsername, fullName.trim(), normalizedPhone, req.user.id]
    );
    if (result.affectedRows === 0) {
      const [accounts] = await pool.execute(
        "SELECT id FROM users WHERE id = ? AND is_active = TRUE AND role IN ('admin', 'teacher', 'academic_master')",
        [req.user.id]
      );
      if (!accounts[0]) return res.status(401).json({ error: 'This account is no longer active.' });
    }
    const token = jwt.sign(
      { id: req.user.id, fullName: fullName.trim(), role: req.user.role },
      environment.jwtSecret,
      { algorithm: 'HS256', expiresIn: '8h' }
    );
    res.cookie('session', token, cookieOptions);
    return res.json({
      user: {
        id: req.user.id,
        username: normalizedUsername,
        fullName: fullName.trim(),
        phone: normalizedPhone,
        role: req.user.role
      }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That username or phone number is already used by another account.' });
    }
    return next(error);
  }
}

async function currentUser(req, res, next) {
  try {
    const [rows] = await pool.execute(
      "SELECT id, username, full_name, phone, role FROM users WHERE id = ? AND is_active = TRUE AND role IN ('admin', 'teacher', 'academic_master')",
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: 'This account is no longer active.' });
    }
    return res.json({
      user: {
        id: rows[0].id,
        username: rows[0].username,
        fullName: rows[0].full_name,
        phone: rows[0].phone,
        role: rows[0].role
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function changePassword(req, res, next) {
  const { currentPassword, newPassword } = req.body || {};
  if (
    typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
    newPassword.length < 6 || Buffer.byteLength(newPassword, 'utf8') > 72
  ) {
    return res.status(400).json({ error: 'Enter your current password and a new password of at least 6 characters.' });
  }
  try {
    const [rows] = await pool.execute(
      'SELECT full_name, role, password_hash FROM users WHERE id = ? AND is_active = TRUE',
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: 'This account is no longer active.' });
    }
    if (!(await verifyPassword(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Choose a new password different from your current password.' });
    }
    const passwordHash = await hashPassword(newPassword);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
    const token = jwt.sign(
      { id: req.user.id, fullName: rows[0].full_name, role: rows[0].role },
      environment.jwtSecret,
      { algorithm: 'HS256', expiresIn: '8h' }
    );
    res.cookie('session', token, cookieOptions);
    return res.json({ message: 'Password changed.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { login, logout, currentUser, updateProfile, changePassword };