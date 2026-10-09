const mysql = require('mysql2/promise');
const { environment } = require('./environment');

const pool = mysql.createPool({
  host: environment.database.host,
  port: environment.database.port,
  database: environment.database.name,
  user: environment.database.user,
  password: environment.database.password,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  timezone: 'Z'
});

module.exports = pool;