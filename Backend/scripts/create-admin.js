const pool = require('../src/config/database');
const { validateEnvironment } = require('../src/config/environment');
const { hashPassword } = require('../src/utils/password');

async function createAdmin() {
  validateEnvironment();
  const [name, username, phone] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (
    !name || name.trim().length > 160 ||
    !/^[a-zA-Z0-9._-]{3,50}$/.test(username || '') ||
    !/^\+[1-9]\d{7,14}$/.test(phone || '') ||
    !password || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error('Usage: set ADMIN_PASSWORD to a password of 6-72 bytes, then run npm run create-admin -- "Full name" username +255712345678');
  }
  const passwordHash = await hashPassword(password);
  await pool.execute(
    'INSERT INTO users (username, full_name, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [username.trim().toLowerCase(), name.trim(), phone, passwordHash, 'admin']
  );
  console.info(`Created administrator account "${username.trim().toLowerCase()}" (${phone}).`);
}

createAdmin()
  .catch((error) => {
    console.error('Unable to create administrator:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
