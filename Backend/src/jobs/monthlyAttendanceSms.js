const cron = require('node-cron');
const pool = require('../config/database');
const { environment } = require('../config/environment');
const { sendSms } = require('../services/smsService');

function previousMonth(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`previousMonth requires a valid Date or date-like value, received: ${String(now)}`);
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: environment.sms.timezone,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const yearPart = parts.find((part) => part.type === 'year');
  const monthPart = parts.find((part) => part.type === 'month');
  if (!yearPart || !monthPart) {
    throw new RangeError(`Unable to determine the local calendar month for ${date.toISOString()} in ${environment.sms.timezone}.`);
  }

  const year = Number(yearPart.value);
  const month = Number(monthPart.value);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function formatMessage(monthDate, rows, guardianName) {
  const monthLabel = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${monthDate}T00:00:00Z`));
  const details = rows.map((row) =>
    `${row.student_name}: alihudhuria ${row.present}, hakuhudhuria ${row.absent}, mgonjwa ${row.sick}, amechelewa ${row.late}, ruhusa ${row.excused}`
  );
  return `Habari ${guardianName}, mahudhurio ya mwezi ${monthLabel}:\n${details.join('\n')}\n- Msongola`;
}

async function claimLog(parent, reportMonth, message) {
  const [insert] = await pool.execute(
    `INSERT IGNORE INTO monthly_sms_logs (guardian_id, report_month, phone, message, status)
     VALUES (?, ?, ?, ?, 'sending')`,
    [parent.guardian_id, reportMonth, parent.phone, message]
  );
  if (insert.affectedRows === 1) {
    const [rows] = await pool.execute(
      'SELECT id FROM monthly_sms_logs WHERE guardian_id = ? AND report_month = ?',
      [parent.guardian_id, reportMonth]
    );
    return rows[0].id;
  }

  const [rows] = await pool.execute(
    'SELECT id FROM monthly_sms_logs WHERE guardian_id = ? AND report_month = ?',
    [parent.guardian_id, reportMonth]
  );
  if (!rows[0]) {
    return null;
  }
  const [retry] = await pool.execute(
    `UPDATE monthly_sms_logs
     SET status = 'sending', phone = ?, message = ?, error_message = NULL, attempts = attempts + 1
     WHERE id = ? AND (
       status = 'failed' OR
       (status = 'sending' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE))
     )`,
    [parent.phone, message, rows[0].id]
  );
  return retry.affectedRows === 1 ? rows[0].id : null;
}

async function getGuardianSummaries(reportMonth, guardianId) {
  const guardianFilter = guardianId === undefined ? '' : ' AND g.id = ?';
  const params = guardianId === undefined ? [reportMonth, reportMonth] : [reportMonth, reportMonth, guardianId];
  const [parents] = await pool.execute(
    `SELECT g.id AS guardian_id, g.full_name AS guardian_name, g.phone,
            s.id AS student_id, s.full_name AS student_name,
            SUM(ar.status = 'present') AS present,
            SUM(ar.status = 'absent') AS absent,
            SUM(ar.status = 'sick') AS sick,
            SUM(ar.status = 'late') AS late,
            SUM(ar.status = 'excused') AS excused
     FROM guardian_contacts g
     JOIN student_guardians sg ON sg.guardian_id = g.id
     JOIN students s ON s.id = sg.student_id AND s.is_active = TRUE
     JOIN attendance_records ar ON ar.student_id = s.id
       AND ar.attendance_date >= ? AND ar.attendance_date < DATE_ADD(?, INTERVAL 1 MONTH)
     LEFT JOIN attendance_submissions sub
       ON sub.class_id = s.class_id AND sub.attendance_date = ar.attendance_date
     WHERE 1 = 1${guardianFilter}
       AND (sub.id IS NULL OR sub.approval_status = 'approved')
     GROUP BY g.id, g.full_name, g.phone, s.id, s.full_name
     ORDER BY g.id, s.full_name`,
    params
  );

  const groups = new Map();
  for (const row of parents) {
    const group = groups.get(row.guardian_id) || { ...row, children: [] };
    group.children.push(row);
    groups.set(row.guardian_id, group);
  }

  return groups;
}

async function sendGuardianSummary(parent, reportMonth) {
  const message = formatMessage(reportMonth, parent.children, parent.guardian_name);
  const logId = await claimLog(parent, reportMonth, message);
  if (!logId) {
    return 'skipped';
  }

  try {
    const providerMessageId = await sendSms(parent.phone, message);
    await pool.execute(
      `UPDATE monthly_sms_logs
       SET status = 'sent', provider_message_id = ?, sent_at = CURRENT_TIMESTAMP, error_message = NULL
       WHERE id = ?`,
      [providerMessageId, logId]
    );
    return 'sent';
  } catch (error) {
    await pool.execute(
      `UPDATE monthly_sms_logs
       SET status = 'failed', error_message = ?
       WHERE id = ? AND status = 'sending'`,
      [String(error.message).slice(0, 500), logId]
    );
    error.code = 'SMS_PROVIDER_FAILURE';
    throw error;
  }
}

async function sendMonthlySummaries(reportMonth = previousMonth()) {
  const groups = await getGuardianSummaries(reportMonth);
  let sent = 0;
  let failed = 0;
  for (const parent of groups.values()) {
    try {
      if (await sendGuardianSummary(parent, reportMonth) === 'sent') {
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`Monthly attendance SMS failed for guardian ${parent.guardian_id}:`, error.message);
    }
  }
  return { month: reportMonth, sent, failed, eligibleParents: groups.size };
}

async function retryMonthlySummary(logId) {
  const [logs] = await pool.execute(
    `SELECT id, guardian_id AS guardian_id, report_month AS report_month
     FROM monthly_sms_logs WHERE id = ? AND status = 'failed'`,
    [logId]
  );
  if (!logs[0]) {
    return { retried: false };
  }

  const reportMonth = logs[0].report_month;
  const groups = await getGuardianSummaries(reportMonth, logs[0].guardian_id);
  const parent = groups.get(logs[0].guardian_id);
  if (!parent) {
    const error = new Error('No attendance records remain for the selected parent and month.');
    error.code = 'NO_ATTENDANCE_FOR_RETRY';
    throw error;
  }
  const result = await sendGuardianSummary(parent, reportMonth);
  return { retried: result === 'sent', month: reportMonth };
}

function startMonthlyAttendanceSms() {
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        const result = await sendMonthlySummaries();
        if (result.sent || result.failed) {
          console.info('Monthly attendance SMS run:', result);
        }
      } catch (error) {
        console.error('Monthly attendance SMS job failed:', error);
      }
    },
    { timezone: environment.sms.timezone }
  );
  console.info(`Monthly attendance SMS job scheduled daily at 08:00 (${environment.sms.timezone}).`);
  sendMonthlySummaries().catch((error) => {
    console.error('Monthly attendance SMS startup recovery failed:', error);
  });
}

module.exports = {
  formatMessage,
  getGuardianSummaries,
  previousMonth,
  retryMonthlySummary,
  sendMonthlySummaries,
  startMonthlyAttendanceSms
};