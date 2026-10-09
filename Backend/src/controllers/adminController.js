const pool = require('../config/database');
const { hashPassword } = require('../utils/password');
const { retryMonthlySummary } = require('../jobs/monthlyAttendanceSms');

async function createStaffAccount(req, res, next, role) {
  const { username, fullName, phone, password } = req.body || {};
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const cleanedPhone = typeof phone === 'string' ? phone.trim().replace(/[\s()-]/g, '') : '';
  const normalizedPhone = role === 'academic_master' && /^0\d{9}$/.test(cleanedPhone)
    ? `+255${cleanedPhone.slice(1)}`
    : role === 'academic_master' && /^255\d{9}$/.test(cleanedPhone)
      ? `+${cleanedPhone}`
      : cleanedPhone;
  if (
    !/^[a-zA-Z0-9._-]{3,50}$/.test(normalizedUsername) ||
    typeof fullName !== 'string' || !fullName.trim() || fullName.length > 160 ||
    typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(normalizedPhone) ||
    typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(400).json({
      error: `Provide a username (3-50 letters, numbers, dots, underscores or hyphens), a name, a ${role === 'academic_master' ? 'valid phone number such as 0712345678 or +255712345678' : 'valid international phone number'}, and a password of at least 6 characters.`
    });
  }
  try {
    const passwordHash = await hashPassword(password);
    const [result] = await pool.execute(
      'INSERT INTO users (username, full_name, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [normalizedUsername, fullName.trim(), normalizedPhone, passwordHash, role]
    );
    return res.status(201).json({
      user: { id: result.insertId, username: normalizedUsername, fullName: fullName.trim(), phone: normalizedPhone, role }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That username or phone number already has an account.' });
    }
    return next(error);
  }
}

function createTeacher(req, res, next) {
  return createStaffAccount(req, res, next, 'teacher');
}

function createAcademicMaster(req, res, next) {
  return createStaffAccount(req, res, next, 'academic_master');
}

async function updateStaffAccount(req, res, next) {
  const accountId = Number(req.params.userId);
  const { username, fullName, phone, password } = req.body || {};
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const cleanedPhone = typeof phone === 'string' ? phone.trim().replace(/[\s()-]/g, '') : '';
  const normalizedPhone = /^0\d{9}$/.test(cleanedPhone)
    ? `+255${cleanedPhone.slice(1)}`
    : /^255\d{9}$/.test(cleanedPhone)
      ? `+${cleanedPhone}`
      : cleanedPhone;
  if (
    !Number.isSafeInteger(accountId) || accountId < 1 ||
    !/^[a-zA-Z0-9._-]{3,50}$/.test(normalizedUsername) ||
    typeof fullName !== 'string' || !fullName.trim() || fullName.length > 160 ||
    typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(normalizedPhone) ||
    (password !== undefined && (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72))
  ) {
    return res.status(400).json({
      error: 'Provide a valid staff account ID, username, name, international phone number, and optional password of 6-72 bytes.'
    });
  }
  try {
    const fields = [normalizedUsername, fullName.trim(), normalizedPhone];
    let sql = "UPDATE users SET username = ?, full_name = ?, phone = ? WHERE id = ? AND role IN ('teacher', 'academic_master') AND is_active = TRUE";
    if (password !== undefined) {
      const passwordHash = await hashPassword(password);
      sql = "UPDATE users SET username = ?, full_name = ?, phone = ?, password_hash = ? WHERE id = ? AND role IN ('teacher', 'academic_master') AND is_active = TRUE";
      fields.push(passwordHash);
    }
    fields.push(accountId);
    const [result] = await pool.execute(sql, fields);
    if (result.affectedRows === 0) {
      const [accounts] = await pool.execute(
        "SELECT id FROM users WHERE id = ? AND role IN ('teacher', 'academic_master') AND is_active = TRUE",
        [accountId]
      );
      if (!accounts[0]) return res.status(404).json({ error: 'The active staff account was not found.' });
    }
    return res.json({
      user: { id: accountId, username: normalizedUsername, fullName: fullName.trim(), phone: normalizedPhone }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That username or phone number is already used by another account.' });
    }
    return next(error);
  }
}

async function listAcademicMasters(req, res, next) {
  try {
    const [academicMasters] = await pool.execute(
      `SELECT id, username, full_name AS fullName, phone
       FROM users
       WHERE role = 'academic_master' AND is_active = TRUE
       ORDER BY full_name`
    );
    return res.json({ academicMasters });
  } catch (error) {
    return next(error);
  }
}

async function listSmsLogs(req, res, next) {
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: 'month must use YYYY-MM format.' });
  }
  try {
    const [logs] = await pool.execute(
      `SELECT l.id, l.report_month AS reportMonth, l.phone, l.status, l.attempts,
              l.error_message AS errorMessage, l.sent_at AS sentAt, g.full_name AS guardianName
       FROM monthly_sms_logs l
       JOIN guardian_contacts g ON g.id = l.guardian_id
       WHERE DATE_FORMAT(l.report_month, '%Y-%m') = ?
       ORDER BY g.full_name`,
      [month]
    );
    return res.json({ logs });
  } catch (error) {
    return next(error);
  }
}

async function overview(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM students WHERE is_active = TRUE) AS students,
         (SELECT COUNT(*) FROM classes) AS classes,
         (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND is_active = TRUE) AS teachers,
         (SELECT COUNT(*)
          FROM attendance_records ar
          JOIN students s ON s.id = ar.student_id
          LEFT JOIN attendance_submissions sub
            ON sub.class_id = s.class_id AND sub.attendance_date = ar.attendance_date
          WHERE ar.attendance_date = CURRENT_DATE() AND s.is_active = TRUE
            AND (sub.id IS NULL OR sub.approval_status = 'approved')) AS attendanceToday`
    );
    return res.json({ overview: rows[0] });
  } catch (error) {
    return next(error);
  }
}

async function retrySmsLog(req, res, next) {
  const logId = Number(req.params.logId);
  if (!Number.isSafeInteger(logId) || logId < 1) {
    return res.status(400).json({ error: 'A valid SMS log ID is required.' });
  }
  try {
    const result = await retryMonthlySummary(logId);
    if (!result.retried) {
      return res.status(409).json({ error: 'This SMS is not in a retryable failed state.' });
    }
    return res.json({ message: 'Monthly summary SMS sent.', month: result.month });
  } catch (error) {
    if (error.code === 'NO_ATTENDANCE_FOR_RETRY') {
      return res.status(409).json({ error: error.message });
    }
    if (error.code !== 'SMS_PROVIDER_FAILURE') {
      return next(error);
    }
    console.error(`Administrator-triggered SMS retry failed for log ${logId}:`, error.message);
    return res.status(502).json({ error: 'The SMS provider did not accept the retry. Check the delivery log and try again.' });
  }
}

async function listTeachers(req, res, next) {
  try {
    const [teachers] = await pool.execute(
      `SELECT u.id, u.username, u.full_name AS fullName, u.phone,
              GROUP_CONCAT(ct.class_id ORDER BY c.name) AS classIds
       FROM users u
       LEFT JOIN class_teachers ct ON ct.teacher_id = u.id
       LEFT JOIN classes c ON c.id = ct.class_id
       WHERE u.role = 'teacher' AND u.is_active = TRUE
       GROUP BY u.id, u.username, u.full_name, u.phone
       ORDER BY u.full_name`
    );
    return res.json({
      teachers: teachers.map((teacher) => ({
        ...teacher,
        classIds: teacher.classIds ? teacher.classIds.split(',').map(Number) : []
      }))
    });
  } catch (error) {
    return next(error);
  }
}

async function assignTeacher(req, res, next) {
  const classId = Number(req.params.classId);
  const teacherId = Number(req.body?.teacherId);
  if (!Number.isSafeInteger(classId) || classId < 1 || !Number.isSafeInteger(teacherId) || teacherId < 1) {
    return res.status(400).json({ error: 'A valid class and teacher are required.' });
  }
  try {
    const [classes] = await pool.execute('SELECT id FROM classes WHERE id = ?', [classId]);
    const [teachers] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'teacher' AND is_active = TRUE",
      [teacherId]
    );
    if (!classes[0] || !teachers[0]) {
      return res.status(400).json({ error: 'The selected class or active teacher does not exist.' });
    }
    await pool.execute(
      'INSERT IGNORE INTO class_teachers (class_id, teacher_id, assigned_by) VALUES (?, ?, ?)',
      [classId, teacherId, req.user.id]
    );
    return res.status(200).json({ message: 'Teacher assigned to class.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createAcademicMaster,
  createTeacher,
  updateStaffAccount,
  listAcademicMasters,
  listSmsLogs,
  listTeachers,
  assignTeacher,
  retrySmsLog,
  overview
};