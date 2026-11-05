const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const RECORDINGS_BASE_DIR = process.env.RECORDINGS_DIR || 'D:\\FRT_Recordings';

// Ensure base storage directory exists
if (!fs.existsSync(RECORDINGS_BASE_DIR)) {
  fs.mkdirSync(RECORDINGS_BASE_DIR, { recursive: true });
}

const DB_PATH = path.join(RECORDINGS_BASE_DIR, 'frt_local.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB] Failed to open database at:', DB_PATH, err);
  } else {
    console.log('[DB] Connected to SQLite database at:', DB_PATH);
  }
});

// Enable WAL mode for high concurrency (2 phones uploading simultaneously)
db.run('PRAGMA journal_mode = WAL;');
db.run('PRAGMA busy_timeout = 5000;');

// Initialize tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS complaints_meta (
      complaint_no TEXT PRIMARY KEY,
      consumer_name TEXT,
      consumer_phone TEXT,
      area TEXT,
      substation TEXT,
      feeder TEXT,
      complaint_type TEXT,
      complaint_date TEXT,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS call_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_no TEXT NOT NULL,
      call_target TEXT NOT NULL DEFAULT 'CONSUMER',
      phone_number TEXT NOT NULL,
      contact_name TEXT,
      operator_name TEXT NOT NULL,
      operator_id TEXT,
      call_time DATETIME NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      call_outcome TEXT,
      actual_problem TEXT,
      operator_notes TEXT,
      consumer_satisfaction TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Auto-migration for existing databases
  db.run(`ALTER TABLE call_recordings ADD COLUMN consumer_satisfaction TEXT`, () => {});

  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_complaint ON call_recordings(complaint_no)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_phone ON call_recordings(phone_number)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_time ON call_recordings(call_time)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_operator ON call_recordings(operator_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_satisfaction ON call_recordings(consumer_satisfaction)`);
});

// Promisified DB helpers
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  RECORDINGS_BASE_DIR,
};
