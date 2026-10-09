const cron = require('node-cron');
const pool = require('../config/database');
const { environment } = require('../config/environment');

function isSchoolWeekday(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('Attendance reminder date must use YYYY-MM-DD format.');
  }
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new TypeError('Attendance reminder date must be a valid calendar date.');
  }
  const day = parsedDate.getUTCDay();
  return day >= 1 && day <= 5;
}

function getSchoolDateTime(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('A valid Date is required to determine school local time.');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: environment.sms.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function isStartupReminderDue(now = new Date()) {
  const { date, time } = getSchoolDateTime(now);
  return isSchoolWeekday(date) && time >= environment.attendanceReminderTime;
}

async function runAttendanceReminder(date) {
  if (!isSchoolWeekday(date)) return { notificationsCreated: 0, skipped: true };

  const [result] = await pool.execute(
    `INSERT INTO user_notifications
       (user_id, notification_type, class_id, related_date, title, message)
     SELECT ct.teacher_id, 'attendance_missing', c.id, ?, 'Attendance not submitted',
            CONCAT('Submit the complete attendance register for ', c.name, ' on ', ?,
                   ' to the Academic Master office.')
     FROM classes c
     JOIN class_teachers ct ON ct.class_id = c.id
     JOIN users u ON u.id = ct.teacher_id AND u.role = 'teacher' AND u.is_active = TRUE
     JOIN students s ON s.class_id = c.id AND s.is_active = TRUE
     LEFT JOIN attendance_submissions sub
       ON sub.class_id = c.id AND sub.attendance_date = ?
     WHERE sub.id IS NULL
     GROUP BY ct.teacher_id, c.id, c.name
     ON DUPLICATE KEY UPDATE id = id`,
    [date, date, date]
  );
  return { notificationsCreated: result.affectedRows, skipped: false };
}

function startAttendanceReminder() {
  const [hour, minute] = environment.attendanceReminderTime.split(':').map(Number);
  const expression = `${minute} ${hour} * * 1-5`;
  const runForToday = async () => {
    const { date } = getSchoolDateTime();
    const result = await runAttendanceReminder(date);
    console.info(`Attendance reminder job completed for ${date}: ${result.notificationsCreated} notification(s) created.`);
  };
  const task = cron.schedule(expression, async () => {
    try {
      await runForToday();
    } catch (error) {
      console.error('Attendance reminder job failed:', error);
    }
  }, { timezone: environment.sms.timezone });
  console.info(`Weekday attendance reminders scheduled for ${environment.attendanceReminderTime} (${environment.sms.timezone}).`);
  if (isStartupReminderDue()) {
    runForToday().catch((error) => {
      console.error('Attendance reminder startup recovery failed:', error);
    });
  }
  return task;
}

module.exports = {
  getSchoolDateTime,
  isSchoolWeekday,
  isStartupReminderDue,
  runAttendanceReminder,
  startAttendanceReminder
};