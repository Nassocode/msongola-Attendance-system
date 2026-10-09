const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseFrontendOrigins(rawOrigins) {
  if (!rawOrigins) {
    return ['http://localhost'];
  }

  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const frontendOrigins = parseFrontendOrigins(process.env.FRONTEND_ORIGIN);

const environment = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  frontendOrigins,
  frontendOrigin: frontendOrigins[0],
  jwtSecret: process.env.JWT_SECRET || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  attendanceReminderTime: process.env.ATTENDANCE_REMINDER_TIME || '16:00',
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || 'msongola_attendance',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  },
  sms: {
    username: process.env.SMS_USERNAME || '',
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || '',
    timezone: process.env.SMS_TIMEZONE || 'Africa/Dar_es_Salaam'
  }
};

function validateEnvironment() {
  if (environment.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to a secret with at least 32 characters.');
  }
  if (!Number.isInteger(environment.port) || environment.port < 1 || environment.port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(environment.attendanceReminderTime)) {
    throw new Error('ATTENDANCE_REMINDER_TIME must use 24-hour HH:MM format.');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: environment.sms.timezone });
  } catch {
    throw new Error(`SMS_TIMEZONE is not a valid IANA timezone: ${environment.sms.timezone}`);
  }
}

module.exports = { environment, validateEnvironment };