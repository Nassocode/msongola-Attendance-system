process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-that-is-at-least-32-characters';

const assert = require('node:assert/strict');
const { after, afterEach, before, beforeEach, test } = require('node:test');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const pool = require('../src/config/database');
const { environment } = require('../src/config/environment');
const { getSchoolDateTime, isStartupReminderDue, runAttendanceReminder } = require('../src/jobs/attendanceReminder');
const { hashPassword } = require('../src/utils/password');

let server;
let baseUrl;
let originalExecute;
let originalGetConnection;
let executeMock;
let transactionEvents;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      error ? reject(error) : resolve();
    });
    server.closeAllConnections();
  });
  await pool.end();
});

beforeEach(() => {
  transactionEvents = [];
  originalExecute = pool.execute;
  pool.execute = (...args) => executeMock(...args);
  originalGetConnection = pool.getConnection;
  pool.getConnection = async () => ({
    execute: (...args) => executeMock(...args),
    beginTransaction: async () => transactionEvents.push('begin'),
    commit: async () => transactionEvents.push('commit'),
    rollback: async () => transactionEvents.push('rollback'),
    release: () => transactionEvents.push('release')
  });
});

afterEach(() => {
  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
});

function sessionCookie(role, id = 1) {
  const token = jwt.sign({ id, fullName: 'Test User', role }, environment.jwtSecret, { algorithm: 'HS256' });
  return `session=${token}`;
}

function apiFetch(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Connection: 'close', ...options.headers }
  });
}

test('health endpoint checks database connectivity', async () => {
  executeMock = async (sql) => {
    assert.match(sql, /SELECT 1/);
    return [[{ 1: 1 }], []];
  };

  const response = await apiFetch('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('admin routes require authentication and the admin role', async () => {
  executeMock = async () => {
    assert.fail('Database must not be queried for denied requests.');
  };

  const unauthenticated = await apiFetch('/api/admin/overview');
  assert.equal(unauthenticated.status, 401);
  await unauthenticated.arrayBuffer();

  const parentRequest = await apiFetch('/api/admin/overview', {
    headers: { Cookie: sessionCookie('parent') }
  });
  assert.equal(parentRequest.status, 403);
  await parentRequest.arrayBuffer();

  const academicMasterRequest = await apiFetch('/api/admin/overview', {
    headers: { Cookie: sessionCookie('academic_master', 13) }
  });
  assert.equal(academicMasterRequest.status, 403);
  await academicMasterRequest.arrayBuffer();
});

test('admin overview counts only active students with attendance recorded today', async () => {
  executeMock = async (sql) => {
    assert.match(sql, /FROM attendance_records ar\s+JOIN students s ON s\.id = ar\.student_id/);
    assert.match(sql, /ar\.attendance_date = CURRENT_DATE\(\) AND s\.is_active = TRUE/);
    return [[{
      students: 20,
      classes: 3,
      teachers: 4,
      attendanceToday: 15
    }], []];
  };

  const response = await apiFetch('/api/admin/overview', {
    headers: { Cookie: sessionCookie('admin', 1) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    overview: {
      students: 20,
      classes: 3,
      teachers: 4,
      attendanceToday: 15
    }
  });
});

test('academic master class list provides school-wide read-only class options', async () => {
  executeMock = async (sql, params) => {
    assert.doesNotMatch(sql, /JOIN class_teachers/);
    assert.deepEqual(params, []);
    return [[{ id: 3, name: 'Class 3', student_count: 12 }], []];
  };

  const response = await apiFetch('/api/classes', {
    headers: { Cookie: sessionCookie('academic_master', 13) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    classes: [{ id: 3, name: 'Class 3', student_count: 12 }]
  });
});

test('teacher class list is restricted to assigned classes', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /JOIN class_teachers ct ON ct\.class_id = c\.id AND ct\.teacher_id = \?/);
    assert.deepEqual(params, [7]);
    return [[{ id: 3, name: 'Class 3', student_count: 12 }], []];
  };

  const response = await apiFetch('/api/classes', {
    headers: { Cookie: sessionCookie('teacher', 7) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    classes: [{ id: 3, name: 'Class 3', student_count: 12 }]
  });
});

test('staff can sign in with a case-insensitive username', async () => {
  const passwordHash = await hashPassword('secure-test-password');
  executeMock = async (sql, params) => {
    assert.match(sql, /WHERE username = \? AND role IN \('admin', 'teacher', 'academic_master'\)/);
    assert.deepEqual(params, ['teacher.one']);
    return [[{
      id: 7,
      username: 'teacher.one',
      full_name: 'Teacher One',
      phone: '+255712345678',
      password_hash: passwordHash,
      role: 'teacher',
      is_active: 1
    }], []];
  };

  const response = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Teacher.One', password: 'secure-test-password' })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: {
      id: 7,
      username: 'teacher.one',
      fullName: 'Teacher One',
      phone: '+255712345678',
      role: 'teacher'
    }
  });
});

test('admin can create an academic master with read-only oversight access', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /INSERT INTO users \(username, full_name, phone, password_hash, role\)/);
    assert.deepEqual(params.slice(0, 3), ['academic.one', 'Academic One', '+255712345678']);
    assert.equal(params[4], 'academic_master');
    return [{ insertId: 13 }, []];
  };

  const response = await apiFetch('/api/admin/academic-masters', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Academic.One',
      fullName: 'Academic One',
      phone: '+255712345678',
      password: 'secure-test-password'
    })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    user: {
      id: 13,
      username: 'academic.one',
      fullName: 'Academic One',
      phone: '+255712345678',
      role: 'academic_master'
    }
  });
});

test('admin can create an academic master with a local Tanzanian phone number', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /INSERT INTO users \(username, full_name, phone, password_hash, role\)/);
    assert.equal(params[2], '+255712345678');
    return [{ insertId: 14 }, []];
  };

  const response = await apiFetch('/api/admin/academic-masters', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'academic.local',
      fullName: 'Academic Local',
      phone: '0712 345 678',
      password: 'secure-test-password'
    })
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.phone, '+255712345678');
});

test('admin can update staff account details and reset its password', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /UPDATE users SET username = \?, full_name = \?, phone = \?, password_hash = \?/);
    assert.match(sql, /role IN \('teacher', 'academic_master'\) AND is_active = TRUE/);
    assert.deepEqual(params.slice(0, 3), ['teacher.updated', 'Teacher Updated', '+255712345678']);
    assert.equal(params[4], 7);
    assert.match(params[3], /^\$2[aby]\$/);
    return [{ affectedRows: 1 }, []];
  };
  const response = await apiFetch('/api/admin/staff/7', {
    method: 'PUT',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Teacher.Updated',
      fullName: 'Teacher Updated',
      phone: '0712 345 678',
      password: 'new-secure-password'
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: { id: 7, username: 'teacher.updated', fullName: 'Teacher Updated', phone: '+255712345678' }
  });
});

test('admin can update staff details without changing the existing password', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /UPDATE users SET username = \?, full_name = \?, phone = \?/);
    assert.doesNotMatch(sql, /password_hash/);
    assert.deepEqual(params, ['academic.updated', 'Academic Updated', '+255712345678', 13]);
    return [{ affectedRows: 1 }, []];
  };
  const response = await apiFetch('/api/admin/staff/13', {
    method: 'PUT',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Academic.Updated',
      fullName: 'Academic Updated',
      phone: '+255712345678'
    })
  });
  assert.equal(response.status, 200);
});

test('admin can list academic master accounts without credentials', async () => {
  executeMock = async (sql) => {
    assert.match(sql, /role = 'academic_master' AND is_active = TRUE/);
    assert.doesNotMatch(sql, /password_hash/);
    return [[{
      id: 13,
      username: 'academic.one',
      fullName: 'Academic One',
      phone: '+255712345678'
    }], []];
  };

  const response = await apiFetch('/api/admin/academic-masters', {
    headers: { Cookie: sessionCookie('admin', 2) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    academicMasters: [{
      id: 13,
      username: 'academic.one',
      fullName: 'Academic One',
      phone: '+255712345678'
    }]
  });
});

test('academic master can sign in and retrieve their current profile', async () => {
  const passwordHash = await hashPassword('secure-test-password');
  executeMock = async (sql, params) => {
    if (sql.includes('password_hash')) {
      assert.match(sql, /'academic_master'/);
      assert.deepEqual(params, ['academic.one']);
      return [[{
        id: 13,
        username: 'academic.one',
        full_name: 'Academic One',
        phone: '+255712345678',
        password_hash: passwordHash,
        role: 'academic_master',
        is_active: 1
      }], []];
    }
    assert.match(sql, /role IN \('admin', 'teacher', 'academic_master'\)/);
    assert.deepEqual(params, [13]);
    return [[{
      id: 13,
      username: 'academic.one',
      full_name: 'Academic One',
      phone: '+255712345678',
      role: 'academic_master'
    }], []];
  };

  const loginResponse = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'academic.one', password: 'secure-test-password' })
  });
  assert.equal(loginResponse.status, 200);
  assert.equal((await loginResponse.json()).user.role, 'academic_master');

  const profileResponse = await apiFetch('/api/auth/me', {
    headers: { Cookie: sessionCookie('academic_master', 13) }
  });
  assert.equal(profileResponse.status, 200);
  assert.deepEqual(await profileResponse.json(), {
    user: {
      id: 13,
      username: 'academic.one',
      fullName: 'Academic One',
      phone: '+255712345678',
      role: 'academic_master'
    }
  });
});

test('staff can update their own profile and normalize a Tanzanian phone number', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /UPDATE users SET username = \?, full_name = \?, phone = \?/);
    assert.match(sql, /id = \? AND is_active = TRUE AND role IN \('admin', 'teacher', 'academic_master'\)/);
    assert.deepEqual(params, ['teacher.updated', 'Teacher Updated', '+255712345678', 7]);
    return [{ affectedRows: 1 }, []];
  };
  const response = await apiFetch('/api/auth/profile', {
    method: 'PATCH',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Teacher.Updated',
      fullName: 'Teacher Updated',
      phone: '0712 345 678'
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: {
      id: 7,
      username: 'teacher.updated',
      fullName: 'Teacher Updated',
      phone: '+255712345678',
      role: 'teacher'
    }
  });
  assert.match(response.headers.get('set-cookie'), /session=/);
});

test('admin can create a teacher with a separate username', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /INSERT INTO users \(username, full_name, phone, password_hash, role\)/);
    assert.deepEqual(params.slice(0, 3), ['teacher.one', 'Teacher One', '+255712345678']);
    assert.equal(params[4], 'teacher');
    return [{ insertId: 12 }, []];
  };

  const response = await apiFetch('/api/admin/teachers', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Teacher.One',
      fullName: 'Teacher One',
      phone: '+255712345678',
      password: 'secure-test-password'
    })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    user: {
      id: 12,
      username: 'teacher.one',
      fullName: 'Teacher One',
      phone: '+255712345678',
      role: 'teacher'
    }
  });
});

test('parent accounts cannot sign in or access staff reports', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /WHERE username = \? AND role IN \('admin', 'teacher', 'academic_master'\)/);
    assert.deepEqual(params, ['parent.one']);
    return [[], []];
  };

  const loginResponse = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'parent.one', password: 'secure-test-password' })
  });
  assert.equal(loginResponse.status, 401);
  await loginResponse.arrayBuffer();

  const reportResponse = await apiFetch('/api/reports/monthly?month=2026-09', {
    headers: { Cookie: sessionCookie('parent', 9) }
  });
  assert.equal(reportResponse.status, 403);
  await reportResponse.arrayBuffer();
});

test('teacher monthly report is restricted to assigned classes', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /SUM\(ar\.status = 'sick'\) AS sick/);
    assert.match(sql, /class_teachers ct WHERE ct\.class_id = s\.class_id AND ct\.teacher_id = \?/);
    assert.deepEqual(params, ['2026-09', 7]);
    return [[{
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      present: 18,
      absent: 1,
      sick: 0,
      late: 0,
      excused: 1,
      total: 20
    }], []];
  };

  const response = await apiFetch('/api/reports/monthly?month=2026-09', {
    headers: { Cookie: sessionCookie('teacher', 7) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    month: '2026-09',
    classId: null,
    students: [{
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      present: 18,
      absent: 1,
      sick: 0,
      late: 0,
      excused: 1,
      total: 20
    }]
  });
});

test('academic master can review monthly attendance for a selected class', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /s\.class_id = \?/);
    assert.doesNotMatch(sql, /class_teachers/);
    assert.deepEqual(params, ['2026-09', 3]);
    return [[{
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      present: 18,
      absent: 1,
      late: 0,
      excused: 1,
      total: 20
    }], []];
  };

  const response = await apiFetch('/api/reports/monthly?month=2026-09&classId=3', {
    headers: { Cookie: sessionCookie('academic_master', 13) }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).students[0].className, 'Class 3');
});

test('academic master can view attendance but cannot change it', async () => {
  executeMock = async (sql, params) => {
    if (/^SELECT ar\.attendance_date/.test(sql.trim())) {
      assert.match(sql, /AND s\.class_id = \?/);
      assert.deepEqual(params, ['2026-10', 3]);
      return [[{
        attendanceDate: '2026-10-08',
        status: 'present',
        notes: null,
        studentId: 4,
        studentNumber: 'S-004',
        studentName: 'Student Four',
        className: 'Class 3',
        submittedAt: '2026-10-08 08:30:00',
        submittedCount: 12,
        submittedBy: 'Test Teacher'
      }], []];
    }
    assert.fail('Academic masters must not save attendance.');
  };

  const reviewResponse = await apiFetch('/api/attendance?month=2026-10&classId=3', {
    headers: { Cookie: sessionCookie('academic_master', 13) }
  });
  assert.equal(reviewResponse.status, 200);
  assert.equal((await reviewResponse.json()).records[0].status, 'present');

  const saveResponse = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('academic_master', 13),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: '2026-10-08',
      records: [{ studentId: 4, status: 'absent' }]
    })
  });
  assert.equal(saveResponse.status, 403);
  assert.deepEqual(await saveResponse.json(), { error: 'You do not have permission to perform this action.' });
});

test('admin monthly report can be filtered to a class', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /s\.class_id = \?/);
    assert.deepEqual(params, ['2026-09', 3]);
    return [[{
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      present: 18,
      absent: 1,
      late: 0,
      excused: 1,
      total: 20
    }], []];
  };

  const response = await apiFetch('/api/reports/monthly?month=2026-09&classId=3', {
    headers: { Cookie: sessionCookie('admin', 2) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    month: '2026-09',
    classId: 3,
    students: [{
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      present: 18,
      absent: 1,
      late: 0,
      excused: 1,
      total: 20
    }]
  });
});

test('monthly report rejects an invalid class filter before querying the database', async () => {
  executeMock = async () => {
    assert.fail('Database must not be queried for an invalid class filter.');
  };

  const response = await apiFetch('/api/reports/monthly?month=2026-09&classId=0', {
    headers: { Cookie: sessionCookie('admin', 2) }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'classId must be a positive integer.' });
});

test('teacher cannot record attendance for an unassigned class', async () => {
  let queryCount = 0;
  executeMock = async (sql, params) => {
    queryCount += 1;
    assert.match(sql, /FROM class_teachers/);
    assert.deepEqual(params, [3, 7]);
    return [[], []];
  };

  const response = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: '2026-10-08',
      records: [{ studentId: 4, status: 'present' }]
    })
  });
  assert.equal(response.status, 403);
  assert.equal(queryCount, 1);
  assert.deepEqual(await response.json(), { error: 'You are not assigned to the selected class.' });
});

test('attendance cannot be recorded for a future school date', async () => {
  executeMock = async () => {
    assert.fail('Database must not be queried for a future attendance date.');
  };
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: environment.sms.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const tomorrow = new Date(Date.UTC(
    Number(dateParts.year),
    Number(dateParts.month) - 1,
    Number(dateParts.day) + 1
  )).toISOString().slice(0, 10);

  const response = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: tomorrow,
      records: [{ studentId: 4, status: 'present' }]
    })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Attendance cannot be recorded for a future date.' });
});

test('admin can review attendance but cannot submit a class register', async () => {
  executeMock = async () => {
    assert.fail('Admin attendance submissions must be denied before querying the database.');
  };

  const response = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: '2026-10-08',
      records: [{ studentId: 4, status: 'present' }]
    })
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'You do not have permission to perform this action.' });
});

test('teacher submits the complete assigned class register transactionally', async () => {
  const statements = [];
  executeMock = async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('FROM class_teachers')) return [[{ 1: 1 }], []];
    if (sql.includes('FROM students WHERE')) return [[{ id: 4 }, { id: 5 }], []];
    if (sql.includes('INSERT INTO attendance_records')) return [{ affectedRows: 1 }, []];
    if (sql.includes('INSERT INTO attendance_submissions')) return [{ affectedRows: 1 }, []];
    if (sql.includes('UPDATE user_notifications')) return [{ affectedRows: 0 }, []];
    assert.fail(`Unexpected database query: ${sql}`);
  };

  const response = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: '2026-10-08',
      records: [
        { studentId: 4, status: 'present' },
        { studentId: 5, status: 'sick', notes: 'Flu symptoms' }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    submitted: 2,
    attendanceDate: '2026-10-08',
    submissionStatus: 'submitted'
  });
  assert.deepEqual(transactionEvents, ['begin', 'commit', 'release']);
  assert.equal(statements.length, 6);
  assert.deepEqual(statements[2].params, [4, '2026-10-08', 'present', 7, null]);
  assert.deepEqual(statements[3].params, [5, '2026-10-08', 'sick', 7, 'Flu symptoms']);
  assert.deepEqual(statements[4].params, [3, '2026-10-08', 7, 2]);
  assert.deepEqual(statements[5].params, [3, '2026-10-08']);
});

test('attendance submission rejects a partial class roster', async () => {
  executeMock = async (sql) => {
    if (sql.includes('FROM class_teachers')) return [[{ 1: 1 }], []];
    if (sql.includes('FROM students WHERE')) return [[{ id: 4 }, { id: 5 }], []];
    assert.fail(`Attendance records must not be saved for a partial roster: ${sql}`);
  };

  const response = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: '2026-10-08',
      records: [{ studentId: 4, status: 'present' }]
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Attendance must include every active student in the selected class.'
  });
  assert.deepEqual(transactionEvents, ['begin', 'rollback', 'release']);
});

test('sick students require illness details before attendance can be submitted', async () => {
  executeMock = async () => {
    assert.fail('Invalid sick attendance must be rejected before database access.');
  };

  const response = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      classId: 3,
      attendanceDate: '2026-10-08',
      records: [{ studentId: 4, status: 'sick', notes: '   ' }]
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Add illness details for every student marked sick.'
  });
});

test('attendance history includes saved notes for the selected month', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /ar\.status, ar\.notes/);
    assert.deepEqual(params, ['2026-10', 3]);
    return [[{
      attendanceDate: '2026-10-08',
      status: 'excused',
      notes: 'Medical appointment',
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      submittedAt: '2026-10-08 08:30:00',
      submittedCount: 12,
      submittedBy: 'Test Teacher'
    }], []];
  };

  const response = await apiFetch('/api/attendance?month=2026-10&classId=3', {
    headers: { Cookie: sessionCookie('admin', 2) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    records: [{
      attendanceDate: '2026-10-08',
      status: 'excused',
      notes: 'Medical appointment',
      studentId: 4,
      studentNumber: 'S-004',
      studentName: 'Student Four',
      className: 'Class 3',
      submittedAt: '2026-10-08 08:30:00',
      submittedCount: 12,
      submittedBy: 'Test Teacher'
    }]
  });
});

test('admin can enroll a student linked to an existing guardian contact', async () => {
  executeMock = async (sql, params) => {
    if (sql.includes('FROM classes')) return [[{ id: 3 }], []];
    if (sql.includes('FROM guardian_contacts')) return [[{ id: 9 }], []];
    if (sql.includes('INSERT INTO students')) return [{ insertId: 4 }, []];
    if (sql.includes('INSERT INTO student_guardians')) return [{ affectedRows: 1 }, []];
    assert.fail(`Unexpected database query: ${sql} ${JSON.stringify(params)}`);
  };

  const response = await apiFetch('/api/students', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentNumber: 'S-004',
      fullName: 'Student Four',
      classId: 3,
      guardianName: 'Parent Four',
      guardianPhone: '+255712345678'
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    student: {
      id: 4,
      studentNumber: 'S-004',
      fullName: 'Student Four',
      classId: 3
    },
    guardianContactCreated: false
  });
  assert.deepEqual(transactionEvents, ['begin', 'commit', 'release']);
});

test('student enrollment creates a guardian contact without creating an account', async () => {
  executeMock = async (sql) => {
    if (sql.includes('FROM classes')) return [[{ id: 3 }], []];
    if (sql.includes('FROM guardian_contacts')) return [[], []];
    if (sql.includes('INSERT INTO guardian_contacts')) return [{ insertId: 9 }, []];
    if (sql.includes('INSERT INTO students')) return [{ insertId: 4 }, []];
    if (sql.includes('INSERT INTO student_guardians')) return [{ affectedRows: 1 }, []];
    assert.fail(`Unexpected database query: ${sql}`);
  };

  const response = await apiFetch('/api/students', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('admin', 2),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentNumber: 'S-004',
      fullName: 'Student Four',
      classId: 3,
      guardianName: 'Guardian Four',
      guardianPhone: '+255712345678'
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    student: {
      id: 4,
      studentNumber: 'S-004',
      fullName: 'Student Four',
      classId: 3
    },
    guardianContactCreated: true
  });
  assert.deepEqual(transactionEvents, ['begin', 'commit', 'release']);
});

test('Academic Master can approve a pending submission and notify its teacher transactionally', async () => {
  const statements = [];
  executeMock = async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('FROM attendance_submissions WHERE id = ? FOR UPDATE')) {
      return [[{
        id: 21,
        classId: 3,
        attendanceDate: '2026-10-08',
        submittedBy: 7,
        approvalStatus: 'pending'
      }], []];
    }
    if (sql.includes('UPDATE attendance_submissions')) return [{ affectedRows: 1 }, []];
    if (sql.includes('INSERT INTO user_notifications')) return [{ affectedRows: 1 }, []];
    assert.fail(`Unexpected review query: ${sql}`);
  };

  const response = await apiFetch('/api/attendance/21/review', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('academic_master', 13),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ decision: 'approved' })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    submissionId: 21,
    approvalStatus: 'approved',
    reviewNotes: null
  });
  assert.deepEqual(transactionEvents, ['begin', 'commit', 'release']);
  assert.match(statements[1].sql, /SET approval_status = \?, review_notes = \?, reviewed_by = \?/);
  assert.deepEqual(statements[1].params, ['approved', null, 13, 21]);
  assert.deepEqual(statements[2].params.slice(0, 4), [7, 3, '2026-10-08', 'Attendance approved']);
});

test('returning a submission requires an explanatory note', async () => {
  executeMock = async () => {
    assert.fail('A return without a note must be rejected before database access.');
  };
  const response = await apiFetch('/api/attendance/21/review', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('academic_master', 13),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ decision: 'returned', notes: '   ' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /return decision requires a review note/);
});

test('teachers cannot review attendance submissions', async () => {
  executeMock = async () => {
    assert.fail('Role access must be rejected before database access.');
  };
  const response = await apiFetch('/api/attendance/21/review', {
    method: 'POST',
    headers: {
      Cookie: sessionCookie('teacher', 7),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ decision: 'approved' })
  });
  assert.equal(response.status, 403);
});

test('notifications list only the signed-in user’s notifications', async () => {
  executeMock = async (sql, params) => {
    assert.deepEqual(params, [7]);
    if (sql.includes('COUNT(*) AS unreadCount')) return [[{ unreadCount: 2 }], []];
    assert.match(sql, /WHERE n\.user_id = \?/);
    return [[{
      id: 5,
      type: 'attendance_missing',
      classId: 3,
      relatedDate: '2026-10-08',
      title: 'Attendance not submitted',
      message: 'Submit the register.',
      readAt: null,
      createdAt: '2026-10-08 16:00:00',
      className: 'Class 3'
    }], []];
  };
  const response = await apiFetch('/api/notifications', {
    headers: { Cookie: sessionCookie('teacher', 7) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    unreadCount: 2,
    notifications: [{
      id: 5,
      type: 'attendance_missing',
      classId: 3,
      relatedDate: '2026-10-08',
      title: 'Attendance not submitted',
      message: 'Submit the register.',
      readAt: null,
      createdAt: '2026-10-08 16:00:00',
      className: 'Class 3'
    }]
  });
});

test('a user cannot mark another user’s notification as read', async () => {
  executeMock = async (sql, params) => {
    assert.deepEqual(params, [5, 7]);
    if (sql.startsWith('UPDATE user_notifications')) return [{ affectedRows: 0 }, []];
    assert.match(sql, /SELECT id FROM user_notifications WHERE id = \? AND user_id = \?/);
    return [[], []];
  };
  const response = await apiFetch('/api/notifications/5/read', {
    method: 'PATCH',
    headers: { Cookie: sessionCookie('teacher', 7) }
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'The notification was not found.' });
});

test('weekday reminder creates deduplicated notices for missing class submissions', async () => {
  executeMock = async (sql, params) => {
    assert.match(sql, /INSERT INTO user_notifications/);
    assert.match(sql, /LEFT JOIN attendance_submissions/);
    assert.match(sql, /ON DUPLICATE KEY UPDATE id = id/);
    assert.deepEqual(params, ['2026-10-08', '2026-10-08', '2026-10-08']);
    return [{ affectedRows: 2 }, []];
  };
  assert.deepEqual(await runAttendanceReminder('2026-10-08'), {
    notificationsCreated: 2,
    skipped: false
  });
});

test('attendance reminders do not run on weekends', async () => {
  executeMock = async () => {
    assert.fail('Weekend reminders must not query the database.');
  };
  assert.deepEqual(await runAttendanceReminder('2026-10-10'), {
    notificationsCreated: 0,
    skipped: true
  });
});

test('attendance reminder startup recovery runs only after the weekday deadline in school time', () => {
  assert.deepEqual(getSchoolDateTime(new Date('2026-10-09T12:59:00.000Z')), {
    date: '2026-10-09',
    time: '15:59'
  });
  assert.equal(isStartupReminderDue(new Date('2026-10-09T12:59:00.000Z')), false);
  assert.equal(isStartupReminderDue(new Date('2026-10-09T13:00:00.000Z')), true);
  assert.equal(isStartupReminderDue(new Date('2026-10-10T13:00:00.000Z')), false);
});
