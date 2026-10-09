const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SMS_TIMEZONE = 'Africa/Dar_es_Salaam';

const pool = require('../src/config/database');
const { formatMessage, getGuardianSummaries, previousMonth } = require('../src/jobs/monthlyAttendanceSms');

test('monthly summaries group linked students under one guardian SMS', async () => {
  const originalExecute = pool.execute;
  pool.execute = async (sql, params) => {
    assert.match(sql, /FROM guardian_contacts g/);
    assert.match(sql, /JOIN student_guardians sg ON sg\.guardian_id = g\.id/);
    assert.deepEqual(params, ['2026-09-01', '2026-09-01']);
    return [[
      { guardian_id: 10, guardian_name: 'Guardian One', phone: '+255712345678', student_name: 'Student A' },
      { guardian_id: 10, guardian_name: 'Guardian One', phone: '+255712345678', student_name: 'Student B' }
    ], []];
  };

  try {
    const summaries = await getGuardianSummaries('2026-09-01');
    assert.equal(summaries.size, 1);
    assert.equal(summaries.get(10).children.length, 2);
    assert.equal(summaries.get(10).guardian_name, 'Guardian One');
  } finally {
    pool.execute = originalExecute;
  }
});

test('formatMessage creates a plain-text monthly SMS for a guardian', () => {
  const message = formatMessage('2026-09-01', [{
    student_name: 'Amina',
    present: 18,
    absent: 1,
    sick: 1,
    late: 0,
    excused: 1
  }], 'Mama Amina');

  assert.equal(
    message,
    'Habari Mama Amina, mahudhurio ya mwezi September 2026:\nAmina: alihudhuria 18, hakuhudhuria 1, mgonjwa 1, amechelewa 0, ruhusa 1\n- Msongola'
  );
  assert.doesNotMatch(message, /[^\x00-\x7F]/);
});

test('previousMonth uses the configured local calendar month', () => {
  assert.equal(previousMonth(new Date('2026-10-07T10:00:00Z')), '2026-09-01');
});

test('previousMonth handles a local month boundary near UTC midnight', () => {
  assert.equal(previousMonth(new Date('2026-09-30T22:00:00Z')), '2026-09-01');
});

test('previousMonth handles January year rollover', () => {
  assert.equal(previousMonth(new Date('2026-01-10T10:00:00Z')), '2025-12-01');
});

test('previousMonth accepts ISO date strings', () => {
  assert.equal(previousMonth('2026-10-07T10:00:00Z'), '2026-09-01');
  assert.equal(previousMonth('2026-01-10T10:00:00Z'), '2025-12-01');
});

test('previousMonth rejects invalid date values', () => {
  assert.throws(() => previousMonth('not-a-date'), /valid Date/);
});
