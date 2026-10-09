const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { environment } = require('./config/environment');
const authRoutes = require('./routes/authRoutes');
const classRoutes = require('./routes/classRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const reportRoutes = require('./routes/reportRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const errorMiddleware = require('./middleware/errorMiddleware');

const app = express();
const allowedOrigins = new Set(environment.frontendOrigins.map((origin) => origin.replace(/\/$/, '')));

app.disable('x-powered-by');
app.use(helmet());
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const normalizedOrigin = requestOrigin ? requestOrigin.replace(/\/$/, '') : '';

  if (requestOrigin && allowedOrigins.has(normalizedOrigin)) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' }
});

app.get('/api/health', (req, res, next) => {
  const pool = require('./config/database');
  pool.query('SELECT 1')
    .then(() => res.json({ status: 'ok' }))
    .catch(next);
});
app.use(['/api/auth/login', '/api/auth/change-password'], loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use(errorMiddleware);

module.exports = app;