const app = require('./app');
const pool = require('./config/database');
const { environment, validateEnvironment } = require('./config/environment');
const { startMonthlyAttendanceSms } = require('./jobs/monthlyAttendanceSms');
const { startAttendanceReminder } = require('./jobs/attendanceReminder');

async function startServer() {
  validateEnvironment();
  await pool.query('SELECT 1');
  app.listen(environment.port, () => {
    console.info(`Attendance API listening on port ${environment.port}.`);
    startMonthlyAttendanceSms();
    startAttendanceReminder();
  });
}

startServer().catch((error) => {
  console.error('Unable to start the attendance API:', error);
  process.exitCode = 1;
});