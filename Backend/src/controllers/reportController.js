const pool = require('../config/database');

async function monthlyReport(req, res, next) {
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: 'month must use YYYY-MM format.' });
  }
  let classId;
  if (req.query.classId !== undefined) {
    classId = Number(req.query.classId);
    if (!Number.isSafeInteger(classId) || classId < 1) {
      return res.status(400).json({ error: 'classId must be a positive integer.' });
    }
  }
  const params = [month];
  let classFilter = '';
  let scopeFilter = '';
  if (classId !== undefined) {
    classFilter = ' AND s.class_id = ?';
    params.push(classId);
  }
  if (req.user.role === 'teacher') {
    scopeFilter = ' AND EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = s.class_id AND ct.teacher_id = ?)';
    params.push(req.user.id);
  }
  try {
    const [students] = await pool.execute(
      `SELECT s.id AS studentId, s.student_number AS studentNumber,
              s.full_name AS studentName, c.name AS className,
              SUM(ar.status = 'present') AS present,
              SUM(ar.status = 'absent') AS absent,
              SUM(ar.status = 'sick') AS sick,
              SUM(ar.status = 'late') AS late,
              SUM(ar.status = 'excused') AS excused,
              COUNT(ar.id) AS total
       FROM attendance_records ar
       JOIN students s ON s.id = ar.student_id
       JOIN classes c ON c.id = s.class_id
       LEFT JOIN attendance_submissions sub
         ON sub.class_id = s.class_id AND sub.attendance_date = ar.attendance_date
       WHERE DATE_FORMAT(ar.attendance_date, '%Y-%m') = ?
         AND (sub.id IS NULL OR sub.approval_status = 'approved')${classFilter}${scopeFilter}
       GROUP BY s.id, s.student_number, s.full_name, c.name
       ORDER BY s.full_name`,
      params
    );
    return res.json({ month, classId: classId ?? null, students });
  } catch (error) {
    return next(error);
  }
}

module.exports = { monthlyReport };