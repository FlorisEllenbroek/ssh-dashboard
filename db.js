const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const bcrypt = require('bcrypt');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'dashboard.db');

let db;

async function initDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      sudo_allowed INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      username TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail TEXT,
      ip_address TEXT
    )
  `);

  save();

  // Bootstrap admin from .env if no users exist
  const result = db.exec('SELECT COUNT(*) as count FROM users');
  const count = result[0].values[0][0];

  if (count === 0) {
    const adminUser = process.env.ADMIN_USERNAME || process.env.USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD || process.env.PASSWORD;

    if (adminUser && adminPass) {
      const hash = await bcrypt.hash(adminPass, 10);
      db.run(
        'INSERT INTO users (username, password_hash, role, sudo_allowed, active) VALUES (?, ?, ?, ?, ?)',
        [adminUser, hash, 'admin', 1, 1]
      );
      save();
      console.log(`Admin user "${adminUser}" created from environment variables.`);
    } else {
      console.warn('No users in database and no ADMIN_USERNAME/ADMIN_PASSWORD in .env. Cannot bootstrap admin.');
    }
  }
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getDB() {
  return db;
}

// --- User helpers ---

function getUser(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1');
  stmt.bind([username]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getUserById(id) {
  const stmt = db.prepare('SELECT id, username, role, sudo_allowed, active, created_at FROM users WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function listUsers() {
  const results = db.exec('SELECT id, username, role, sudo_allowed, active, created_at FROM users ORDER BY id');
  if (results.length === 0) return [];
  const columns = results[0].columns;
  return results[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

async function createUser(username, password, role = 'user', sudoAllowed = 0) {
  const hash = await bcrypt.hash(password, 10);
  db.run(
    'INSERT INTO users (username, password_hash, role, sudo_allowed) VALUES (?, ?, ?, ?)',
    [username, hash, role, sudoAllowed]
  );
  save();
  const result = db.exec('SELECT last_insert_rowid() as id');
  return result[0].values[0][0];
}

function updateUser(id, fields) {
  const allowed = ['username', 'role', 'sudo_allowed', 'active'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }

  if (sets.length === 0) return false;

  values.push(id);
  db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  save();
  return true;
}

async function updateUserPassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  save();
}

function deleteUser(id) {
  db.run('UPDATE users SET active = 0 WHERE id = ?', [id]);
  save();
}

function countActiveAdmins() {
  const result = db.exec("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1");
  return result[0].values[0][0];
}

// --- Audit log helpers ---

function addAuditLog(username, eventType, detail = null, ipAddress = null) {
  db.run(
    'INSERT INTO audit_logs (username, event_type, detail, ip_address) VALUES (?, ?, ?, ?)',
    [username, eventType, detail ? JSON.stringify(detail) : null, ipAddress]
  );
  save();
}

function getAuditLogs({ page = 1, limit = 50, username = null, eventType = null } = {}) {
  let where = [];
  let params = [];

  if (username) {
    where.push('username = ?');
    params.push(username);
  }
  if (eventType) {
    where.push('event_type = ?');
    params.push(eventType);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  // Count total
  const countResult = db.exec(`SELECT COUNT(*) FROM audit_logs ${whereClause}`, params);
  const total = countResult[0].values[0][0];

  // Get page
  const offset = (page - 1) * limit;
  const dataParams = [...params, limit, offset];
  const stmt = db.prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`);
  stmt.bind(dataParams);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  return {
    logs: rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = {
  initDatabase,
  getDB,
  save,
  getUser,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  updateUserPassword,
  deleteUser,
  countActiveAdmins,
  addAuditLog,
  getAuditLogs,
};
