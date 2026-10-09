const bcrypt = require('bcryptjs');

const HASH_ROUNDS = 12;

function hashPassword(password) {
  return bcrypt.hash(password, HASH_ROUNDS);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = { hashPassword, verifyPassword };