const pool = require('../config/database');
const { environment } = require('../config/environment');

const statuses = new Set(['present', 'absent', 'sick']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayInSchoolTimezone() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: environment.sms.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

async function saveAttendance(req, res, next) {
  const { classId, attendanceDate, records } = req.body || {};
  if (
    !Number.isSafeInteger(Number(classId)) || Number(classId) < 1 ||
    !isCalendarDate(attendanceDate) ||
    !Array.isArray(records) || records.length === 0 || records.length > 500
  ) {
    return res.status(400).json({
      error: 'Provide a class, a date in YYYY-MM-DD format, and between 1 and 500 attendance records.'
    });
  }
  if (attendanceDate > todayInSchoolTimezone()) {
    return res.status(400).json({ error: 'Attendance cannot be recorded for a future date.' });
  }
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return res.status(400).json({ error: 'Each record must be an attendance object.' });
    }
    const studentId = Number(record.studentId);
    if (
      !Number.isSafeInteger(studentId) || studentId < 1 || seen.has(studentId) ||
      !statuses.has(record.status) ||
      (record.notes !== undefined && (typeof record.notes !== 'string' || record.notes.length > 500))
    ) {
      return res.status(400).json({ error: 'Each record needs a unique studentId, status present/absent/sick, and optional notes up to 500 characters.' });
    }
    if (record.status === 'sick' && !record.notes?.trim()) {
      return res.status(400).json({ error: 'Add illness details for every student marked sick.' });
    }
    seen.add(studentId);
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    if (req.user.role === 'teacher') {
      const [assignments] = await connection.execute(
        'SELECT 1 FROM class_teachers WHERE class_id = ? AND teacher_id = ? FOR UPDATE',
        [Number(classId), req.user.id]
      );
      if (!assignments[0]) {
        await connection.rollback();
        return res.status(403).json({ error: 'You are not assigned to the selected class.' });
      }
    }
    const [students] = await connection.execute(
      'SELECT id FROM students WHERE class_id = ? AND is_active = TRUE ORDER BY id FOR UPDATE',
      [Number(classId)]
    );
    if (students.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'The selected class has no active students to submit.' });
    }

    const classStudentIds = new Set(students.map((student) => Number(student.id)));
    if (classStudentIds.size !== seen.size || [...seen].some((studentId) => !classStudentIds.has(studentId))) {
      await connection.rollback();
      return res.status(400).json({ error: 'Attendance must include every active student in the selected class.' });
    }

    for (const record of records) {
      await connection.execute(
        `INSERT INTO attendance_records (student_id, attendance_date, status, marked_by, notes)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by),
                                 notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP`,
        [
          Number(record.studentId),
          attendanceDate,
          record.status,
          req.user.id,
          record.notes ? record.notes.trim() : null
        ]
      );
    }
    await connection.execute(
      `INSERT INTO attendance_submissions
       (class_id, attendance_date, submitted_by, student_count, approval_status,
        review_notes, reviewed_by, reviewed_at, submitted_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE submitted_by = VALUES(submitted_by),
                             student_count = VALUES(student_count),
                             approval_status = 'pending',
                             review_notes = NULL,
                             reviewed_by = NULL,
                             reviewed_at = NULL,
                             submitted_at = CURRENT_TIMESTAMP`,
      [Number(classId), attendanceDate, req.user.id, records.length]
    );
    await connection.execute(
      `UPDATE user_notifications
       SET read_at = CURRENT_TIMESTAMP
       WHERE notification_type = 'attendance_missing' AND class_id = ? AND related_date = ?`,
      [Number(classId), attendanceDate]
    );
    await connection.commit();
    return res.json({
      submitted: records.length,
      attendanceDate,
      submissionStatus: 'submitted'
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return next(error);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function reviewAttendance(req, res, next) {
  const submissionId = Number(req.params.submissionId);
  const { decision, notes } = req.body || {};
  const reviewNotes = typeof notes === 'string' ? notes.trim() : '';
  if (
    !Number.isSafeInteger(submissionId) || submissionId < 1 ||
    !['approved', 'returned'].includes(decision) ||
    (decision === 'returned' && (!reviewNotes || reviewNotes.length > 500)) ||
    (notes !== undefined && (typeof notes !== 'string' || notes.length > 500))
  ) {
    return res.status(400).json({
      error: 'Choose approve or return. A return decision requires a review note of up to 500 characters.'
    });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [submissions] = await connection.execute(
      `SELECT id, class_id AS classId, attendance_date AS attendanceDate,
              submitted_by AS submittedBy, approval_status AS approvalStatus
       FROM attendance_submissions WHERE id = ? FOR UPDATE`,
      [submissionId]
    );
    const submission = submissions[0];
    if (!submission) {
      await connection.rollback();
      return res.status(404).json({ error: 'The attendance submission was not found.' });
    }
    if (submission.approvalStatus === 'approved') {
      await connection.rollback();
      return res.status(409).json({ error: 'This attendance submission has already been approved.' });
    }
    await connection.execute(
      `UPDATE attendance_submissions
       SET approval_status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decision, reviewNotes || null, req.user.id, submissionId]
    );
    const message = decision === 'approved'
      ? `Attendance for ${submission.attendanceDate} was approved by the Academic Master office.`
      : `Attendance for ${submission.attendanceDate} was returned for correction: ${reviewNotes}`;
    await connection.execute(
      `INSERT INTO user_notifications
         (user_id, notification_type, class_id, related_date, title, message, read_at)
       VALUES (?, 'attendance_review', ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message),
                               read_at = NULL, created_at = CURRENT_TIMESTAMP`,
      [submission.submittedBy, Number(submission.classId), submission.attendanceDate,
        decision === 'approved' ? 'Attendance approved' : 'Attendance returned', message]
    );
    await connection.commit();
    return res.json({ submissionId, approvalStatus: decision, reviewNotes: reviewNotes || null });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return next(error);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function getAttendance(req, res, next) {
  const { month, classId } = req.query;
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: 'month must use YYYY-MM format.' });
  }
  const params = [month];
  let ownershipFilter = '';
  if (req.user.role === 'teacher') {
    ownershipFilter = ' AND EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = s.class_id AND ct.teacher_id = ?)';
    params.push(req.user.id);
    if (classId !== undefined) {
      const parsedId = Number(classId);
      if (!Number.isSafeInteger(parsedId) || parsedId < 1) {
        return res.status(400).json({ error: 'classId must be a positive integer.' });
      }
      ownershipFilter += ' AND s.class_id = ?';
      params.push(parsedId);
    }
  } else if (classId !== undefined) {
    const parsedId = Number(classId);
    if (!Number.isSafeInteger(parsedId) || parsedId < 1) {
      return res.status(400).json({ error: 'classId must be a positive integer.' });
    }
    ownershipFilter = ' AND s.class_id = ?';
    params.push(parsedId);
  }
  try {
    const [records] = await pool.execute(
      `SELECT ar.attendance_date AS attendanceDate, ar.status, ar.notes,
              s.id AS studentId, s.student_number AS studentNumber, s.full_name AS studentName,
              c.name AS className, sub.id AS submissionId, sub.approval_status AS approvalStatus,
              sub.review_notes AS reviewNotes, sub.reviewed_at AS reviewedAt,
              reviewer.full_name AS reviewedBy, sub.submitted_at AS submittedAt,
              sub.student_count AS submittedCount, submitter.full_name AS submittedBy
       FROM attendance_records ar
       JOIN students s ON s.id = ar.student_id
       JOIN classes c ON c.id = s.class_id
       LEFT JOIN attendance_submissions sub
         ON sub.class_id = s.class_id AND sub.attendance_date = ar.attendance_date
       LEFT JOIN users submitter ON submitter.id = sub.submitted_by
       LEFT JOIN users reviewer ON reviewer.id = sub.reviewed_by
       WHERE DATE_FORMAT(ar.attendance_date, '%Y-%m') = ?${ownershipFilter}
       ORDER BY ar.attendance_date DESC, s.full_name`,
      params
    );
    return res.json({ records });
  } catch (error) {
    return next(error);
  }
}

module.exports = { saveAttendance, reviewAttendance, getAttendance };