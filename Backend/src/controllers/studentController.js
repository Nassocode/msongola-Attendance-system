const pool = require('../config/database');

const validPhone = /^\+[1-9]\d{7,14}$/;

async function listStudents(req, res, next) {
  try {
    const { classId } = req.query;
    let query = `SELECT s.id, s.student_number AS studentNumber, s.full_name AS fullName,
                       c.id AS classId, c.name AS className
                FROM students s JOIN classes c ON c.id = s.class_id
                WHERE s.is_active = TRUE`;
    const params = [];
    if (classId !== undefined) {
      const parsedId = Number(classId);
      if (!Number.isSafeInteger(parsedId) || parsedId < 1) {
        return res.status(400).json({ error: 'classId must be a positive integer.' });
      }
      query += ' AND s.class_id = ?';
      params.push(parsedId);
    }
    if (req.user.role === 'teacher') {
      query += ' AND EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = s.class_id AND ct.teacher_id = ?)';
      params.push(req.user.id);
    }
    query += ' ORDER BY s.full_name';
    const [students] = await pool.execute(query, params);
    return res.json({ students });
  } catch (error) {
    return next(error);
  }
}

async function createStudent(req, res, next) {
  const body = req.body || {};
  const {
    studentNumber,
    fullName,
    classId,
    guardianName,
    guardianPhone
  } = body;
  if (
    typeof studentNumber !== 'string' || !studentNumber.trim() || studentNumber.length > 40 ||
    typeof fullName !== 'string' || !fullName.trim() || fullName.length > 160 ||
    !Number.isSafeInteger(Number(classId)) || Number(classId) < 1 ||
    typeof guardianName !== 'string' || !guardianName.trim() || guardianName.length > 160 ||
    typeof guardianPhone !== 'string' || !validPhone.test(guardianPhone.trim())
  ) {
    return res.status(400).json({
      error: 'Provide a student number, student name, class, guardian name, and an international phone number for monthly SMS.'
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [classes] = await connection.execute('SELECT id FROM classes WHERE id = ?', [Number(classId)]);
    if (!classes[0]) {
      await connection.rollback();
      return res.status(400).json({ error: 'The selected class does not exist.' });
    }

    const normalizedPhone = guardianPhone.trim();
    const [guardians] = await connection.execute(
      'SELECT id FROM guardian_contacts WHERE phone = ? FOR UPDATE',
      [normalizedPhone]
    );
    let guardianId;
    if (guardians[0]) {
      guardianId = guardians[0].id;
    } else {
      const [guardianResult] = await connection.execute(
        'INSERT INTO guardian_contacts (full_name, phone) VALUES (?, ?)',
        [guardianName.trim(), normalizedPhone]
      );
      guardianId = guardianResult.insertId;
    }

    const [studentResult] = await connection.execute(
      'INSERT INTO students (student_number, full_name, class_id) VALUES (?, ?, ?)',
      [studentNumber.trim(), fullName.trim(), Number(classId)]
    );
    await connection.execute(
      'INSERT INTO student_guardians (student_id, guardian_id) VALUES (?, ?)',
      [studentResult.insertId, guardianId]
    );
    await connection.commit();
    return res.status(201).json({
      student: {
        id: studentResult.insertId,
        studentNumber: studentNumber.trim(),
        fullName: fullName.trim(),
        classId: Number(classId)
      },
      guardianContactCreated: guardians.length === 0
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A student with that number already exists, or the guardian phone is already in use.' });
    }
    return next(error);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = { listStudents, createStudent };