const pool = require('../config/database');

async function listClasses(req, res, next) {
  try {
    const teacherFilter = req.user.role === 'teacher'
      ? 'JOIN class_teachers ct ON ct.class_id = c.id AND ct.teacher_id = ?'
      : '';
    const params = req.user.role === 'teacher' ? [req.user.id] : [];
    const [classes] = await pool.execute(
      `SELECT c.id, c.name, COUNT(DISTINCT s.id) AS student_count
       FROM classes c
       ${teacherFilter}
       LEFT JOIN students s ON s.class_id = c.id AND s.is_active = TRUE
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      params
    );
    return res.json({ classes });
  } catch (error) {
    return next(error);
  }
}

async function createClass(req, res, next) {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: 'Class name must be between 1 and 100 characters.' });
    }

    const [result] = await pool.execute('INSERT INTO classes (name) VALUES (?)', [name]);
    return res.status(201).json({ class: { id: result.insertId, name, studentCount: 0 } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A class with that name already exists.' });
    }
    return next(error);
  }
}

module.exports = { listClasses, createClass };