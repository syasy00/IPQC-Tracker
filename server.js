import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static('public/uploads'));

const {
  JWT_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.6-flash',
  ALLOW_DATABASE_RESET = 'false',
  USER_SESSION_EXPIRES_IN = '24h',
  ADMIN_SESSION_EXPIRES_IN = '8h'
} = process.env;

if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is missing. Login and protected API routes will fail until it is configured.');
}

if (!GEMINI_API_KEY) {
  console.warn(
    'INFO: GEMINI_API_KEY is not configured. The application will work normally, ' +
    'but the admin-only AI Insights page will remain unavailable until a Gemini API key is added.'
  );
}

// Resilient MySQL connection pool with keep-alive.
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

// Test the pool connection on startup.
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL Database:', err);
  } else {
    console.log('Connected to MySQL Database via Pool!');
    connection.release();
  }
});

const queryDb = (sql, values = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, values, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const toPublicUser = (row) => ({
  id: Number(row.id),
  username: String(row.username || ''),
  employeeId: row.employee_id || '',
  fullName: String(row.full_name || row.username || row.employee_id || 'User'),
  role: row.role === 'admin' ? 'admin' : 'user',
  jobTitle: row.job_title || '',
  department: row.department || '',
  isActive: Boolean(row.is_active),
  mustChangeCredential: Boolean(row.must_change_credential),
  credentialReady: row.role === 'admin'
    ? Boolean(row.password_hash ?? row.has_password)
    : Boolean(row.pin_hash ?? row.has_pin),
  lastLoginAt: row.last_login_at || null,
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
});

const toPublicEmployee = (row) => ({
  id: Number(row.id),
  employeeId: String(row.employee_id || ''),
  fullName: String(row.full_name || row.employee_id || 'User'),
  jobTitle: row.job_title || '',
  department: row.department || '',
});

const ensureUsersColumn = async (columnName, ddl) => {
  const rows = await queryDb('SHOW COLUMNS FROM users LIKE ?', [columnName]);
  if (rows.length === 0) {
    await queryDb(`ALTER TABLE users ADD COLUMN ${ddl}`);
    console.log(`Added users.${columnName}`);
  }
};

const ensureUsersTable = async () => {
  await queryDb(`
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT,
      username VARCHAR(100) NOT NULL,
      employee_id VARCHAR(50) NULL,
      password_hash VARCHAR(255) NULL,
      pin_hash VARCHAR(255) NULL,
      full_name VARCHAR(150) NOT NULL,
      role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
      job_title VARCHAR(100) NULL,
      department VARCHAR(100) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      must_change_credential BOOLEAN NOT NULL DEFAULT FALSE,
      session_version INT NOT NULL DEFAULT 0,
      last_login_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_employee_id (employee_id),
      INDEX idx_users_role (role),
      INDEX idx_users_active (is_active)
    )
  `);

  // Non-destructive migration from earlier password/email-based builds.
  await ensureUsersColumn('employee_id', 'employee_id VARCHAR(50) NULL');
  await ensureUsersColumn('pin_hash', 'pin_hash VARCHAR(255) NULL');
  await ensureUsersColumn('must_change_credential', 'must_change_credential BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureUsersColumn('session_version', 'session_version INT NOT NULL DEFAULT 0');
  await queryDb('ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL');

  const indexes = await queryDb('SHOW INDEX FROM users');
  if (!indexes.some((row) => row.Key_name === 'uq_users_employee_id')) {
    await queryDb('ALTER TABLE users ADD UNIQUE KEY uq_users_employee_id (employee_id)');
  }

  // Earlier builds used username/password for standard users. Preserve those
  // accounts by using the existing unique username as an initial Employee ID.
  // They still need an administrator to set/reset a PIN before they can sign in.
  await queryDb(
    `UPDATE users
     SET employee_id = username
     WHERE role = 'user' AND employee_id IS NULL AND username IS NOT NULL AND username <> ''`
  );

  // Migration bridge: keep the existing environment-based administrator.
  if (ADMIN_USERNAME && ADMIN_PASSWORD_HASH) {
    const existing = await queryDb(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [ADMIN_USERNAME]
    );

    if (existing.length === 0) {
      await queryDb(
        `INSERT INTO users
          (username, employee_id, password_hash, pin_hash, full_name, role, job_title,
           department, is_active, must_change_credential, session_version)
         VALUES (?, NULL, ?, NULL, ?, 'admin', ?, ?, TRUE, FALSE, 0)`,
        [ADMIN_USERNAME, ADMIN_PASSWORD_HASH, 'System Administrator', 'Quality Administrator', 'Quality Team']
      );
      console.log('Bootstrap administrator migrated into the users table.');
    }
  }
};

const usersReady = ensureUsersTable().catch((err) => {
  console.error('Failed to initialize users table:', err);
  throw err;
});

// ==========================================
// Traceability / Audit Trail
// ==========================================
// Existing audit_records rows are preserved. New traceability columns are added
// only when missing; historical rows simply show an unknown creator/editor.
const ensureAuditRecordColumn = async (columnName, ddl) => {
  const rows = await queryDb(`SHOW COLUMNS FROM audit_records LIKE ?`, [columnName]);
  if (rows.length === 0) {
    await queryDb(`ALTER TABLE audit_records ADD COLUMN ${ddl}`);
    console.log(`Added audit_records.${columnName}`);
  }
};

const ensureAuditTrailSchema = async () => {
  // audit_records exists in the current IPQC application. Do not create or wipe
  // it here: only extend it with non-destructive traceability fields.
  const tableRows = await queryDb(`SHOW TABLES LIKE 'audit_records'`);
  if (tableRows.length > 0) {
    await ensureAuditRecordColumn('created_by', 'created_by INT NULL');
    await ensureAuditRecordColumn('updated_by', 'updated_by INT NULL');
    await ensureAuditRecordColumn('created_at', 'created_at DATETIME NULL');
    await ensureAuditRecordColumn('updated_at', 'updated_at DATETIME NULL');
    await ensureAuditRecordColumn('deleted_by', 'deleted_by INT NULL');
    await ensureAuditRecordColumn('deleted_at', 'deleted_at DATETIME NULL');
  } else {
    console.warn('audit_records table was not found; traceability columns will be added after the table exists.');
  }

  await queryDb(`
    CREATE TABLE IF NOT EXISTS record_versions (
      id BIGINT NOT NULL AUTO_INCREMENT,
      record_id INT NOT NULL,
      version_no INT NOT NULL,
      change_type VARCHAR(30) NOT NULL,
      snapshot JSON NOT NULL,
      changed_fields JSON NULL,
      actor_user_id INT NULL,
      actor_name VARCHAR(150) NOT NULL,
      actor_role VARCHAR(20) NOT NULL DEFAULT 'system',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_record_version (record_id, version_no),
      INDEX idx_record_versions_record (record_id, version_no),
      INDEX idx_record_versions_created_at (created_at)
    )
  `);

  await queryDb(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT NOT NULL AUTO_INCREMENT,
      actor_user_id INT NULL,
      actor_username VARCHAR(100) NOT NULL,
      actor_name VARCHAR(150) NOT NULL,
      actor_role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(100) NULL,
      description VARCHAR(500) NOT NULL,
      metadata JSON NULL,
      ip_address VARCHAR(45) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_audit_log_created_at (created_at),
      INDEX idx_audit_log_actor (actor_user_id),
      INDEX idx_audit_log_entity (entity_type, entity_id),
      INDEX idx_audit_log_action (action)
    )
  `);
};

const auditTrailReady = Promise.all([usersReady, ensureAuditTrailSchema()]).catch((err) => {
  console.error('Failed to initialize audit trail schema:', err);
  throw err;
});

const getRequestIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || null;
};

const logAuditEvent = async (req, {
  action,
  entityType,
  entityId = null,
  description,
  metadata = null,
}) => {
  try {
    await auditTrailReady;
    const actor = req.user || {};

    // Some browsers/proxies can retry a successful login request during a reconnect.
    // Collapse identical sign-in events created only a few seconds apart so the
    // operational audit trail remains readable without hiding business changes.
    if (String(action) === 'USER_SIGNED_IN' && actor.id) {
      const recent = await queryDb(
        `SELECT id FROM audit_log
         WHERE actor_user_id = ? AND action = 'USER_SIGNED_IN'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 5 SECOND)
         ORDER BY id DESC LIMIT 1`,
        [actor.id]
      );
      if (recent.length > 0) return;
    }

    await queryDb(
      `INSERT INTO audit_log
        (actor_user_id, actor_username, actor_name, actor_role,
         action, entity_type, entity_id, description, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.id || null,
        String(actor.username || 'unknown'),
        String(actor.fullName || actor.username || 'Unknown user'),
        actor.role === 'admin' ? 'admin' : 'user',
        String(action),
        String(entityType),
        entityId === null || entityId === undefined ? null : String(entityId),
        String(description).slice(0, 500),
        metadata ? JSON.stringify(metadata) : null,
        getRequestIp(req),
      ]
    );
  } catch (err) {
    // Business operation remains successful even if logging has a temporary issue.
    console.error('Audit log write failed:', err);
  }
};

const formatRecordNumber = (record, fallbackId) =>
  record?.no !== null && record?.no !== undefined && record?.no !== ''
    ? `#${record.no}`
    : `#${fallbackId}`;

const selectRecordById = async (id) => {
  const rows = await queryDb(`
    SELECT
      ar.id, ar.no, DATE_FORMAT(ar.audit_date, '%Y-%m-%d') AS auditDate, ar.ww, ar.shift,
      ar.auditor_name AS auditors, ar.pic_finding AS personOnJob, ar.department,
      ar.platform, ar.area_station AS areaStation, ar.group_finding AS groupFinding,
      ar.category, ar.finding_details AS detailsFindings, ar.picture, ar.remark, ar.status,
      ar.icar_status AS icarStatus, ar.icar_num AS icarNum, ar.mqe_engineer AS mqeEngineer,
      ar.created_by AS createdByUserId, ar.updated_by AS updatedByUserId,
      ar.created_at AS createdAt, ar.updated_at AS updatedAt,
      ar.deleted_by AS deletedByUserId, ar.deleted_at AS deletedAt,
      creator.full_name AS createdByName, creator.username AS createdByUsername,
      editor.full_name AS updatedByName, editor.username AS updatedByUsername,
      deleter.full_name AS deletedByName, deleter.username AS deletedByUsername
    FROM audit_records ar
    LEFT JOIN users creator ON creator.id = ar.created_by
    LEFT JOIN users editor ON editor.id = ar.updated_by
    LEFT JOIN users deleter ON deleter.id = ar.deleted_by
    WHERE ar.id = ?
    LIMIT 1
  `, [id]);
  return rows[0] || null;
};

const recordSnapshot = (record) => {
  if (!record) return {};
  const {
    id, no, auditDate, ww, shift, auditors, personOnJob, department, platform,
    areaStation, groupFinding, category, detailsFindings, picture, remark, status,
    icarStatus, icarNum, mqeEngineer, createdByUserId, createdByName,
    createdByUsername, createdAt, updatedByUserId, updatedByName,
    updatedByUsername, updatedAt, deletedByUserId, deletedByName,
    deletedByUsername, deletedAt,
  } = record;
  // Do not duplicate large base64 evidence blobs into every JSON version. File
  // paths/references are retained; inline evidence remains on the live record.
  const versionPicture = typeof picture === 'string' && picture.startsWith('data:') ? null : picture;
  return {
    id, no, auditDate, ww, shift, auditors, personOnJob, department, platform,
    areaStation, groupFinding, category, detailsFindings, picture: versionPicture, remark, status,
    icarStatus, icarNum, mqeEngineer, createdByUserId, createdByName,
    createdByUsername, createdAt, updatedByUserId, updatedByName,
    updatedByUsername, updatedAt, deletedByUserId, deletedByName,
    deletedByUsername, deletedAt,
  };
};

const nextRecordVersionNumber = async (recordId) => {
  const rows = await queryDb(
    'SELECT COALESCE(MAX(version_no), 0) AS maxVersion FROM record_versions WHERE record_id = ?',
    [recordId]
  );
  return Number(rows[0]?.maxVersion || 0) + 1;
};

const writeRecordVersion = async (req, record, changeType, changedFields = [], actorOverride = null) => {
  if (!record?.id) return null;
  const versionNo = await nextRecordVersionNumber(record.id);
  const actor = actorOverride || req?.user || {};
  await queryDb(
    `INSERT INTO record_versions
      (record_id, version_no, change_type, snapshot, changed_fields,
       actor_user_id, actor_name, actor_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      versionNo,
      String(changeType),
      JSON.stringify(recordSnapshot(record)),
      changedFields?.length ? JSON.stringify(changedFields) : null,
      actor.id || null,
      String(actor.fullName || actor.username || 'System migration'),
      String(actor.role || 'system'),
    ]
  );
  return versionNo;
};

const ensureBaselineVersion = async (record) => {
  if (!record?.id) return;
  const rows = await queryDb('SELECT COUNT(*) AS total FROM record_versions WHERE record_id = ?', [record.id]);
  if (Number(rows[0]?.total || 0) > 0) return;
  await writeRecordVersion(null, record, 'baseline', [], {
    id: null,
    fullName: 'System migration',
    username: 'system',
    role: 'system',
  });
};

const applySnapshotToRecord = async (recordId, snapshot, actorUserId) => {
  await queryDb(
    `UPDATE audit_records SET
      no = ?, audit_date = ?, ww = ?, shift = ?, auditor_name = ?, pic_finding = ?, department = ?,
      platform = ?, area_station = ?, group_finding = ?, category = ?, finding_details = ?,
      picture = COALESCE(?, picture), remark = ?, status = ?, icar_status = ?, icar_num = ?, mqe_engineer = ?,
      updated_by = ?, updated_at = NOW(), deleted_by = NULL, deleted_at = NULL
     WHERE id = ?`,
    [
      snapshot.no ?? null, snapshot.auditDate || null, snapshot.ww || null, snapshot.shift || '',
      snapshot.auditors || '', snapshot.personOnJob || '', snapshot.department || '',
      snapshot.platform || '', snapshot.areaStation || '', snapshot.groupFinding || '',
      snapshot.category || '', snapshot.detailsFindings || '', snapshot.picture || null,
      snapshot.remark || '', snapshot.status || 'Open', snapshot.icarStatus || 'Locked',
      snapshot.icarNum || 'N/A', snapshot.mqeEngineer || '', actorUserId, recordId,
    ]
  );
};

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
};

const isSixDigitPin = (value) => /^\d{6}$/.test(String(value || ''));
const isValidEmployeeId = (value) => /^[A-Za-z0-9._-]{2,50}$/.test(String(value || '').trim());
const isValidUsername = (value) => /^[A-Za-z0-9._-]{3,100}$/.test(String(value || '').trim());

// PINs are intentionally simple for floor use, so login attempts are rate-limited.
// In a multi-instance deployment, move this bucket to Redis/shared storage.
const authRateBuckets = new Map();
const allowAuthAttempt = (key, maxAttempts = 6, windowMs = 10 * 60 * 1000) => {
  const now = Date.now();
  const current = authRateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    authRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  authRateBuckets.set(key, current);
  if (current.count > maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
};
const clearAuthAttempts = (key) => authRateBuckets.delete(key);

// Authenticates either a standard user (employee + PIN) or an administrator
// (username + password). The database is re-checked on every request so
// deactivation, role changes and credential resets take effect immediately.
const authenticateUser = async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server authentication is not configured.' });

  try {
    await usersReady;
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = Number(decoded.userId);
    const sessionVersion = Number(decoded.sessionVersion || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid or expired session, please sign in again' });
    }

    const rows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role,
              job_title, department, is_active, must_change_credential, session_version,
              last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    const row = rows[0];
    if (!row || !row.is_active || Number(row.session_version || 0) !== sessionVersion) {
      return res.status(401).json({ error: 'Account is inactive or the session is no longer valid' });
    }

    req.user = toPublicUser(row);
    req.authRow = row;

    // Temporary PIN/password must be replaced before normal system use.
    const setupRoute = req.path === '/api/change-credential' || req.path === '/api/verify';
    if (req.user.mustChangeCredential && !setupRoute) {
      return res.status(428).json({
        error: req.user.role === 'admin'
          ? 'Change your temporary administrator password before continuing.'
          : 'Change your temporary PIN before continuing.',
        code: 'CREDENTIAL_CHANGE_REQUIRED',
      });
    }

    next();
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired session, please sign in again' });
    }
    console.error('Authentication error:', err);
    return res.status(500).json({ error: 'Authentication service failed' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
};

const issueSession = (row) => {
  const isAdminAccount = row.role === 'admin';
  const expiresIn = isAdminAccount ? ADMIN_SESSION_EXPIRES_IN : USER_SESSION_EXPIRES_IN;
  const token = jwt.sign(
    {
      userId: Number(row.id),
      role: isAdminAccount ? 'admin' : 'user',
      sessionVersion: Number(row.session_version || 0),
    },
    JWT_SECRET,
    { expiresIn }
  );
  return { token, expiresIn };
};

// Safe employee selector used on the standard-user sign-in screen.
// It intentionally exposes no hashes, usernames or admin accounts.
app.get('/api/public-users', async (req, res) => {
  try {
    await usersReady;
    const rows = await queryDb(`
      SELECT id, employee_id, full_name, job_title, department
      FROM users
      WHERE role = 'user' AND is_active = TRUE AND employee_id IS NOT NULL AND pin_hash IS NOT NULL
      ORDER BY full_name ASC, employee_id ASC
    `);
    res.status(200).json(rows.map(toPublicEmployee));
  } catch (err) {
    console.error('Fetch public users error:', err);
    res.status(500).json({ error: 'Failed to load employee list' });
  }
});

// One endpoint, two intentionally different credential experiences:
// - standard user -> employee identity + 6-digit PIN
// - admin         -> username + strong password
app.post('/api/login', async (req, res) => {
  const mode = req.body?.mode === 'admin' ? 'admin' : 'user';
  const rateIdentity = mode === 'admin'
    ? String(req.body?.username || '').trim().toLowerCase()
    : String(req.body?.employeeId || '').trim().toLowerCase();
  const rateKey = `login:${getRequestIp(req) || 'unknown'}:${mode}:${rateIdentity || 'blank'}`;
  const rate = allowAuthAttempt(rateKey);
  if (!rate.allowed) {
    res.set('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server authentication is not configured. Contact the administrator.' });
  }

  try {
    await usersReady;
    let rows = [];
    let credentialMatches = false;

    if (mode === 'admin') {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: 'Administrator username and password are required' });
      }
      rows = await queryDb(
        `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role,
                job_title, department, is_active, must_change_credential, session_version,
                last_login_at, created_at, updated_at
         FROM users WHERE username = ? AND role = 'admin' LIMIT 1`,
        [username]
      );
      const row = rows[0];
      credentialMatches = Boolean(row?.password_hash) && await bcrypt.compare(password, row.password_hash);
    } else {
      const employeeId = String(req.body?.employeeId || '').trim();
      const pin = String(req.body?.pin || '');
      if (!employeeId || !pin) {
        return res.status(400).json({ error: 'Select your employee identity and enter your PIN' });
      }
      if (!isSixDigitPin(pin)) {
        return res.status(400).json({ error: 'PIN must be exactly 6 digits' });
      }
      rows = await queryDb(
        `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role,
                job_title, department, is_active, must_change_credential, session_version,
                last_login_at, created_at, updated_at
         FROM users WHERE employee_id = ? AND role = 'user' LIMIT 1`,
        [employeeId]
      );
      const row = rows[0];
      credentialMatches = Boolean(row?.pin_hash) && await bcrypt.compare(pin, row.pin_hash);
    }

    const user = rows[0];
    if (!user || !user.is_active || !credentialMatches) {
      return res.status(401).json({
        error: mode === 'admin' ? 'Invalid administrator credentials' : 'Invalid employee or PIN',
      });
    }

    await queryDb('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    const refreshedRows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role,
              job_title, department, is_active, must_change_credential, session_version,
              last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );
    const refreshed = refreshedRows[0] || user;
    const publicUser = toPublicUser(refreshed);
    const session = issueSession(refreshed);
    clearAuthAttempts(rateKey);

    req.user = publicUser;
    await logAuditEvent(req, {
      action: 'USER_SIGNED_IN',
      entityType: 'session',
      entityId: publicUser.id,
      description: `${publicUser.fullName} signed in`,
      metadata: { role: publicUser.role, employeeId: publicUser.employeeId || null },
    });

    res.status(200).json({ ...session, user: publicUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/verify', authenticateUser, (req, res) => {
  res.status(200).json({ valid: true, user: req.user });
});

// Quiet rolling renewal for standard floor sessions. Do not log each refresh,
// otherwise a long-running workstation would flood the operational audit trail.
app.post('/api/session/refresh', authenticateUser, (req, res) => {
  if (!req.authRow) return res.status(401).json({ error: 'Session is no longer valid' });
  res.status(200).json({ ...issueSession(req.authRow), user: req.user });
});

// First-use/self-service credential replacement. Standard users choose their own
// six-digit PIN; administrators replace a temporary password with a strong one.
app.post('/api/change-credential', authenticateUser, async (req, res) => {
  try {
    const rows = await queryDb(
      `SELECT id, username, employee_id, full_name, role, job_title, department,
              is_active, must_change_credential, session_version, last_login_at,
              created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'admin') {
      const password = String(req.body?.password || '');
      if (password.length < 10) {
        return res.status(400).json({ error: 'Administrator password must be at least 10 characters' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await queryDb(
        `UPDATE users
         SET password_hash = ?, pin_hash = NULL, must_change_credential = FALSE,
             session_version = session_version + 1
         WHERE id = ?`,
        [passwordHash, target.id]
      );
      await logAuditEvent(req, {
        action: 'ADMIN_PASSWORD_CHANGED',
        entityType: 'user',
        entityId: target.id,
        description: `${req.user.fullName} changed administrator password`,
      });
    } else {
      const pin = String(req.body?.pin || '');
      if (!isSixDigitPin(pin)) {
        return res.status(400).json({ error: 'New PIN must be exactly 6 digits' });
      }
      const pinHash = await bcrypt.hash(pin, 12);
      await queryDb(
        `UPDATE users
         SET pin_hash = ?, password_hash = NULL, must_change_credential = FALSE,
             session_version = session_version + 1
         WHERE id = ?`,
        [pinHash, target.id]
      );
      await logAuditEvent(req, {
        action: 'USER_PIN_CHANGED',
        entityType: 'user',
        entityId: target.id,
        description: `${req.user.fullName} changed personal PIN`,
      });
    }

    const refreshedRows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role,
              job_title, department, is_active, must_change_credential, session_version,
              last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [target.id]
    );
    const refreshed = refreshedRows[0];
    res.status(200).json({ ...issueSession(refreshed), user: toPublicUser(refreshed) });
  } catch (err) {
    console.error('Change credential error:', err);
    res.status(500).json({ error: 'Failed to update credential' });
  }
});

// ==========================================
// User Management (admin only)
// ==========================================
app.get('/api/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    await usersReady;
    const rows = await queryDb(`
      SELECT id, username, employee_id, full_name, role, job_title, department,
             is_active, must_change_credential, last_login_at, created_at, updated_at,
             (password_hash IS NOT NULL) AS has_password,
             (pin_hash IS NOT NULL) AS has_pin
      FROM users
      ORDER BY is_active DESC, role DESC, full_name ASC, username ASC
    `);
    res.status(200).json(rows.map(toPublicUser));
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.post('/api/users', authenticateUser, requireAdmin, async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const fullName = String(req.body?.fullName || '').trim();
  const jobTitle = String(req.body?.jobTitle || '').trim() || null;
  const department = String(req.body?.department || '').trim() || null;

  if (!fullName) return res.status(400).json({ error: 'Full name is required' });

  try {
    let result;
    if (role === 'admin') {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.credential || req.body?.password || '');
      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Administrator username must be 3-100 characters using letters, numbers, dot, underscore or hyphen' });
      }
      if (password.length < 10) {
        return res.status(400).json({ error: 'Temporary administrator password must be at least 10 characters' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      result = await queryDb(
        `INSERT INTO users
          (username, employee_id, password_hash, pin_hash, full_name, role, job_title,
           department, is_active, must_change_credential, session_version)
         VALUES (?, NULL, ?, NULL, ?, 'admin', ?, ?, TRUE, TRUE, 0)`,
        [username, passwordHash, fullName, jobTitle, department]
      );
    } else {
      const employeeId = String(req.body?.employeeId || '').trim();
      const pin = String(req.body?.credential || req.body?.pin || '');
      if (!isValidEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Employee ID must be 2-50 characters using letters, numbers, dot, underscore or hyphen' });
      }
      if (!isSixDigitPin(pin)) {
        return res.status(400).json({ error: 'Temporary PIN must be exactly 6 digits' });
      }
      const pinHash = await bcrypt.hash(pin, 12);
      result = await queryDb(
        `INSERT INTO users
          (username, employee_id, password_hash, pin_hash, full_name, role, job_title,
           department, is_active, must_change_credential, session_version)
         VALUES (?, ?, NULL, ?, ?, 'user', ?, ?, TRUE, TRUE, 0)`,
        [employeeId, employeeId, pinHash, fullName, jobTitle, department]
      );
    }

    const rows = await queryDb(
      `SELECT id, username, employee_id, full_name, role, job_title, department,
              is_active, must_change_credential, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password,
              (pin_hash IS NOT NULL) AS has_pin
       FROM users WHERE id = ? LIMIT 1`,
      [result.insertId]
    );
    const createdUser = toPublicUser(rows[0]);
    await logAuditEvent(req, {
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: createdUser.id,
      description: `Created ${createdUser.role} account for ${createdUser.fullName}`,
      metadata: {
        employeeId: createdUser.employeeId || null,
        username: createdUser.role === 'admin' ? createdUser.username : null,
        role: createdUser.role,
        jobTitle: createdUser.jobTitle,
        department: createdUser.department,
        temporaryCredential: true,
      },
    });
    res.status(201).json(createdUser);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That employee ID or administrator username is already in use' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

const activeAdminCount = async () => {
  const rows = await queryDb(`SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = TRUE AND password_hash IS NOT NULL`);
  return Number(rows[0]?.total || 0);
};

app.put('/api/users/:id', authenticateUser, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user id' });

  const fullName = String(req.body?.fullName || '').trim();
  const jobTitle = String(req.body?.jobTitle || '').trim() || null;
  const department = String(req.body?.department || '').trim() || null;
  const isActive = req.body?.isActive !== false;

  if (!fullName) return res.status(400).json({ error: 'Full name is required' });

  try {
    const currentRows = await queryDb(
      `SELECT id, username, employee_id, full_name, role, job_title, department,
              is_active, password_hash, pin_hash
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    if (currentRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = currentRows[0];

    if (req.body?.role && req.body.role !== target.role) {
      return res.status(400).json({ error: 'Changing account role in place is disabled. Create a separate account with the correct role.' });
    }
    if (targetId === Number(req.user.id) && !isActive) {
      return res.status(400).json({ error: 'You cannot deactivate your own administrator account' });
    }
    if (target.role === 'admin' && target.is_active && !isActive && await activeAdminCount() <= 1) {
      return res.status(400).json({ error: 'At least one active administrator account must remain' });
    }

    let username = target.username;
    let employeeId = target.employee_id;
    if (target.role === 'user') {
      employeeId = String(req.body?.employeeId ?? target.employee_id ?? '').trim();
      if (!isValidEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'A valid Employee ID is required for standard users' });
      }
      username = employeeId;
    } else {
      username = String(req.body?.username ?? target.username ?? '').trim();
      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'A valid administrator username is required' });
      }
      employeeId = null;
    }

    await queryDb(
      `UPDATE users
       SET username = ?, employee_id = ?, full_name = ?, job_title = ?, department = ?,
           is_active = ?, session_version = session_version + ?
       WHERE id = ?`,
      [username, employeeId, fullName, jobTitle, department, isActive ? 1 : 0,
       Boolean(target.is_active) !== isActive ? 1 : 0, targetId]
    );

    const rows = await queryDb(
      `SELECT id, username, employee_id, full_name, role, job_title, department,
              is_active, must_change_credential, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password,
              (pin_hash IS NOT NULL) AS has_pin
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    const updatedUser = toPublicUser(rows[0]);
    const changes = {
      active: Boolean(target.is_active) !== updatedUser.isActive ? { from: Boolean(target.is_active), to: updatedUser.isActive } : undefined,
      employeeId: (target.employee_id || '') !== (updatedUser.employeeId || '') ? { from: target.employee_id || '', to: updatedUser.employeeId || '' } : undefined,
      username: target.username !== updatedUser.username ? { from: target.username, to: updatedUser.username } : undefined,
      fullName: target.full_name !== updatedUser.fullName ? { from: target.full_name, to: updatedUser.fullName } : undefined,
      jobTitle: (target.job_title || '') !== (updatedUser.jobTitle || '') ? { from: target.job_title || '', to: updatedUser.jobTitle || '' } : undefined,
      department: (target.department || '') !== (updatedUser.department || '') ? { from: target.department || '', to: updatedUser.department || '' } : undefined,
    };
    const cleanChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    const action = cleanChanges.active
      ? (updatedUser.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED')
      : 'USER_UPDATED';

    await logAuditEvent(req, {
      action,
      entityType: 'user',
      entityId: updatedUser.id,
      description: `${action === 'USER_DEACTIVATED' ? 'Deactivated' : action === 'USER_ACTIVATED' ? 'Activated' : 'Updated'} ${updatedUser.fullName}`,
      metadata: cleanChanges,
    });
    res.status(200).json(updatedUser);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That Employee ID or administrator username is already in use' });
    }
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.post('/api/users/:id/reset-credential', authenticateUser, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const credential = String(req.body?.credential || '');
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Use your own credential-change flow instead of resetting your current session here' });
  }

  try {
    const rows = await queryDb(
      'SELECT id, username, employee_id, full_name, role FROM users WHERE id = ? LIMIT 1',
      [targetId]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'admin') {
      if (credential.length < 10) {
        return res.status(400).json({ error: 'Temporary administrator password must be at least 10 characters' });
      }
      const passwordHash = await bcrypt.hash(credential, 12);
      await queryDb(
        `UPDATE users
         SET password_hash = ?, pin_hash = NULL, must_change_credential = TRUE,
             session_version = session_version + 1
         WHERE id = ?`,
        [passwordHash, targetId]
      );
    } else {
      if (!isSixDigitPin(credential)) {
        return res.status(400).json({ error: 'Temporary PIN must be exactly 6 digits' });
      }
      const pinHash = await bcrypt.hash(credential, 12);
      await queryDb(
        `UPDATE users
         SET pin_hash = ?, password_hash = NULL, must_change_credential = TRUE,
             session_version = session_version + 1
         WHERE id = ?`,
        [pinHash, targetId]
      );
    }

    await logAuditEvent(req, {
      action: 'USER_CREDENTIAL_RESET',
      entityType: 'user',
      entityId: targetId,
      description: `Reset temporary ${target.role === 'admin' ? 'password' : 'PIN'} for ${target.full_name || target.username}`,
      metadata: { targetRole: target.role, requiresChangeOnNextLogin: true },
    });
    res.status(200).json({
      message: target.role === 'admin'
        ? 'Temporary administrator password updated. The administrator must change it at next sign in.'
        : 'Temporary PIN updated. The employee must change it at next sign in.',
    });
  } catch (err) {
    console.error('Reset credential error:', err);
    res.status(500).json({ error: 'Failed to reset credential' });
  }
});

const normalizeFindingStatus = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'open') return 'Open';
  if (normalized === 'closed' || normalized === 'close') return 'Closed';
  return '';
};

const recordAgeDays = (auditDate) => {
  if (!auditDate) return 0;
  const date = new Date(`${auditDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
};

const topCounts = (rows, key, limit = 10) => {
  const counts = {};
  for (const row of rows) {
    const value = String(row[key] ?? '').trim();
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

const getGeminiResponseText = (responseJson) => {
  const parts = responseJson?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
};

const parseAiJson = (text) => {
  if (!text) return null;

  const stripped = String(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Normal structured-output path.
  try {
    return JSON.parse(stripped);
  } catch {
    // Defensive recovery if the model ever adds text around the JSON object.
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const buildDeterministicAiFallback = (snapshot, question = '') => {
  const summary = snapshot?.summary || {};
  const topPlatform = snapshot?.openWorkload?.byPlatform?.[0];
  const topCategory = snapshot?.openWorkload?.byCategory?.[0];
  const topMqe = snapshot?.openWorkload?.byMqe?.[0];

  const priorities = [];

  if (Number(summary.openOver30Days || 0) > 0) {
    priorities.push(
      `${summary.openOver30Days} open finding${summary.openOver30Days === 1 ? '' : 's'} are older than 30 days. Review these first for closure blockers and overdue ownership.`
    );
  }

  if (Number(summary.submittedIcarStillOpen || 0) > 0) {
    priorities.push(
      `${summary.submittedIcarStillOpen} finding${summary.submittedIcarStillOpen === 1 ? '' : 's'} already have Submitted ICARs but remain Open. Prioritize verification and closure follow-up.`
    );
  }

  if (topPlatform?.name) {
    priorities.push(
      `${topPlatform.name} has the highest open workload with ${topPlatform.value} open finding${topPlatform.value === 1 ? '' : 's'}. Focus containment and recurring-issue review there.`
    );
  }

  if (topCategory?.name && priorities.length < 4) {
    priorities.push(
      `${topCategory.name} is the leading open category with ${topCategory.value} finding${topCategory.value === 1 ? '' : 's'}. Check for a common systemic cause before treating cases individually.`
    );
  }

  if (Number(summary.recordsWithoutMqeOwner || 0) > 0 && priorities.length < 4) {
    priorities.push(
      `${summary.recordsWithoutMqeOwner} record${summary.recordsWithoutMqeOwner === 1 ? '' : 's'} have no MQE owner. Assign ownership so unresolved findings do not stall.`
    );
  }

  if (priorities.length === 0) {
    priorities.push('No major backlog signal was available in the current snapshot. Review the latest work-week trend and the newest open findings for emerging issues.');
  }

  const answer = `Priority now:
${priorities.slice(0, 4).map((item, i) => `${i + 1}. ${item}`).join('\n')}

Recommended action: start with the oldest open items, then Submitted-ICAR findings that are still Open, and finally the highest-volume platform/category.`;

  const highlights = [
    { label: 'Open Findings', value: String(summary.openFindings ?? 0), detail: 'Current unresolved workload' },
    { label: 'Open >30 Days', value: String(summary.openOver30Days ?? 0), detail: 'Overdue attention' },
    { label: 'Submitted ICAR + Open', value: String(summary.submittedIcarStillOpen ?? 0), detail: 'Needs verification / closure' },
  ];

  if (topPlatform?.name) {
    highlights.push({ label: 'Top Open Platform', value: String(topPlatform.name), detail: `${topPlatform.value} open findings` });
  }

  return {
    answer,
    highlights: highlights.slice(0, 4),
    filters: { status: 'Open' },
    caveat: 'Fallback analysis generated directly from the current IPQC snapshot because the AI response could not be parsed safely.',
  };
};

const sanitizeAiFilters = (filters = {}) => {
  const allowed = ['status', 'icarStatus', 'platform', 'category', 'auditor', 'department', 'ww', 'mqe'];
  return Object.fromEntries(
    allowed
      .filter((key) => filters[key] !== undefined && filters[key] !== null && String(filters[key]).trim() !== '')
      .map((key) => [key, String(filters[key]).trim()])
  );
};

// ==========================================
// App Settings (auditor list & platform-MQE mapping)
// Stored as a single row so every user sees the same list instead of each
// browser tab resetting to hardcoded defaults on reload.
// ==========================================
const ensureSettingsTable = () => {
  db.query(
    `CREATE TABLE IF NOT EXISTS app_settings (
      id INT PRIMARY KEY,
      auditors JSON NOT NULL,
      mqe_mappings JSON NOT NULL
    )`,
    (err) => {
      if (err) {
        console.error('Failed to ensure app_settings table:', err);
        return;
      }
      db.query('SELECT id FROM app_settings WHERE id = 1', (err, rows) => {
        if (err) return console.error('Failed to check app_settings row:', err);
        if (rows.length === 0) {
          db.query(
            'INSERT INTO app_settings (id, auditors, mqe_mappings) VALUES (1, ?, ?)',
            [JSON.stringify([]), JSON.stringify({})],
            (err) => {
              if (err) console.error('Failed to seed app_settings row:', err);
            }
          );
        }
      });
    }
  );
};
ensureSettingsTable();

// API: Get current auditors + platform-MQE mapping.
// Authenticated users need these lists to populate record-entry dropdowns. Empty arrays/objects mean no admin
// has saved custom values yet, in which case the frontend falls back to
// its built-in defaults.
app.get('/api/settings', authenticateUser, (req, res) => {
  db.query('SELECT auditors, mqe_mappings FROM app_settings WHERE id = 1', (err, rows) => {
    if (err) {
      console.error('Failed to fetch settings:', err);
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }
    if (rows.length === 0) {
      return res.status(200).json({ auditors: [], mqeMappings: {} });
    }
    const row = rows[0];
    const auditors = typeof row.auditors === 'string' ? JSON.parse(row.auditors) : row.auditors;
    const mqeMappings = typeof row.mqe_mappings === 'string' ? JSON.parse(row.mqe_mappings) : row.mqe_mappings;
    res.status(200).json({ auditors, mqeMappings });
  });
});

// API: Replace auditors + platform-MQE mapping (admin only)
app.put('/api/settings', authenticateUser, requireAdmin, async (req, res) => {
  const { auditors, mqeMappings } = req.body || {};
  if (!Array.isArray(auditors) || typeof mqeMappings !== 'object' || mqeMappings === null) {
    return res.status(400).json({ error: 'auditors must be an array and mqeMappings must be an object' });
  }

  try {
    const beforeRows = await queryDb('SELECT auditors, mqe_mappings FROM app_settings WHERE id = 1 LIMIT 1');
    const before = beforeRows[0] || { auditors: [], mqe_mappings: {} };
    const previousAuditors = typeof before.auditors === 'string' ? JSON.parse(before.auditors) : (before.auditors || []);
    const previousMappings = typeof before.mqe_mappings === 'string' ? JSON.parse(before.mqe_mappings) : (before.mqe_mappings || {});

    await queryDb(
      'UPDATE app_settings SET auditors = ?, mqe_mappings = ? WHERE id = 1',
      [JSON.stringify(auditors), JSON.stringify(mqeMappings)]
    );

    const auditorsChanged = JSON.stringify(previousAuditors) !== JSON.stringify(auditors);
    const mappingsChanged = JSON.stringify(previousMappings) !== JSON.stringify(mqeMappings);
    if (auditorsChanged || mappingsChanged) {
      const action = auditorsChanged && mappingsChanged
        ? 'SETTINGS_UPDATED'
        : mappingsChanged
          ? 'MQE_MAPPING_UPDATED'
          : 'AUDITOR_LIST_UPDATED';
      const description = action === 'MQE_MAPPING_UPDATED'
        ? 'Changed Platform → MQE ownership mapping'
        : action === 'AUDITOR_LIST_UPDATED'
          ? 'Changed IPQC auditor list'
          : 'Changed IPQC auditor list and Platform → MQE mapping';

      await logAuditEvent(req, {
        action,
        entityType: 'settings',
        entityId: 'app_settings',
        description,
        metadata: {
          auditorCount: auditors.length,
          mappedPlatformCount: Object.values(mqeMappings).filter((value) => String(value || '').trim()).length,
        },
      });
    }

    res.status(200).json({ auditors, mqeMappings });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Configure Image Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// ==========================================
// TEMPORARY API: Wipe Database Clean
// This is a dangerous, irreversible operation. It is locked behind admin
// auth below, but the safest move is to delete this route entirely once
// you're done testing - it has no place in a production build.
// ==========================================
app.delete('/api/reset-database', authenticateUser, requireAdmin, async (req, res) => {
  if (String(ALLOW_DATABASE_RESET).toLowerCase() !== 'true') {
    return res.status(404).json({ error: 'Database reset is disabled' });
  }
  try {
    await auditTrailReady;
    await queryDb('TRUNCATE TABLE audit_records');
    await queryDb('TRUNCATE TABLE record_versions');
    await logAuditEvent(req, {
      action: 'DATABASE_RESET',
      entityType: 'system',
      entityId: 'audit_records',
      description: 'Reset the IPQC findings database',
    });
    res.status(200).json({ message: 'Database wiped clean! Auto-increment reset to 1.' });
  } catch (err) {
    console.error('Failed to clear database:', err);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

// API: Get All Records (READ) with creator/editor traceability.
app.get('/api/records', authenticateUser, async (req, res) => {
  try {
    await auditTrailReady;
    const results = await queryDb(`
      SELECT
        ar.id, ar.no, DATE_FORMAT(ar.audit_date, '%Y-%m-%d') AS auditDate, ar.ww, ar.shift,
        ar.auditor_name AS auditors, ar.pic_finding AS personOnJob, ar.department,
        ar.platform, ar.area_station AS areaStation, ar.group_finding AS groupFinding,
        ar.category, ar.finding_details AS detailsFindings, ar.picture, ar.remark, ar.status,
        ar.icar_status AS icarStatus, ar.icar_num AS icarNum, ar.mqe_engineer AS mqeEngineer,
        ar.created_by AS createdByUserId, ar.updated_by AS updatedByUserId,
        ar.created_at AS createdAt, ar.updated_at AS updatedAt,
        ar.deleted_by AS deletedByUserId, ar.deleted_at AS deletedAt,
        creator.full_name AS createdByName, creator.username AS createdByUsername,
        editor.full_name AS updatedByName, editor.username AS updatedByUsername,
        deleter.full_name AS deletedByName, deleter.username AS deletedByUsername
      FROM audit_records ar
      LEFT JOIN users creator ON creator.id = ar.created_by
      LEFT JOIN users editor ON editor.id = ar.updated_by
      LEFT JOIN users deleter ON deleter.id = ar.deleted_by
      WHERE ar.deleted_at IS NULL
      ORDER BY ar.id ASC
    `);
    res.status(200).json(results);
  } catch (err) {
    console.error('Failed to fetch records:', err);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});


// ==========================================
// Admin-only AI Insights (READ ONLY)
// ==========================================
// Important design boundary:
// - The model never receives a database connection or SQL execution tool.
// - The server first computes a compact, read-only operational snapshot.
// - The route has no INSERT / UPDATE / DELETE capability.
// - Evidence images and free-form remarks are not sent to the AI service.
app.post('/api/ai-insights', authenticateUser, requireAdmin, async (req, res) => {
  const question = String(req.body?.question || '').trim();

  if (!question) {
    return res.status(400).json({ error: 'Please enter a question about the IPQC data.' });
  }

  if (question.length > 1200) {
    return res.status(400).json({ error: 'Please keep the question under 1,200 characters.' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'AI Insights is not configured on the server. Add GEMINI_API_KEY to the server .env file and restart the backend.'
    });
  }

  try {
    await auditTrailReady;
    const rows = await queryDb(`
      SELECT
        id,
        no,
        DATE_FORMAT(audit_date, '%Y-%m-%d') AS auditDate,
        ww,
        shift,
        auditor_name AS auditors,
        department,
        platform,
        area_station AS areaStation,
        group_finding AS groupFinding,
        category,
        finding_details AS detailsFindings,
        status,
        icar_status AS icarStatus,
        icar_num AS icarNum,
        mqe_engineer AS mqeEngineer
      FROM audit_records
      WHERE deleted_at IS NULL
      ORDER BY audit_date ASC, id ASC
    `);

    const normalized = rows.map((row) => ({
      ...row,
      status: normalizeFindingStatus(row.status) || 'Not Set',
      icarStatus: String(row.icarStatus || 'Locked'),
      ageDays: recordAgeDays(row.auditDate),
    }));

    const open = normalized.filter((row) => row.status === 'Open');
    const closed = normalized.filter((row) => row.status === 'Closed');
    const statusNotSet = normalized.filter((row) => row.status === 'Not Set');
    const submitted = normalized.filter((row) => row.icarStatus === 'Submitted');
    const locked = normalized.filter((row) => row.icarStatus !== 'Submitted');
    const submittedButOpen = open.filter((row) => row.icarStatus === 'Submitted');
    const openOver14 = open.filter((row) => row.ageDays > 14);
    const openOver30 = open.filter((row) => row.ageDays > 30);
    const unassignedMqe = normalized.filter((row) => {
      const value = String(row.mqeEngineer || '').trim().toLowerCase();
      return !value || value === 'unassigned' || value === 'not assigned';
    });

    const classified = open.length + closed.length;
    const closureRate = classified ? Number(((closed.length / classified) * 100).toFixed(1)) : 0;

    const weeklyMap = {};
    for (const row of normalized) {
      const ww = String(row.ww || '').trim();
      if (!ww) continue;
      if (!weeklyMap[ww]) {
        weeklyMap[ww] = { ww, total: 0, open: 0, closed: 0, submittedIcar: 0 };
      }
      weeklyMap[ww].total++;
      if (row.status === 'Open') weeklyMap[ww].open++;
      if (row.status === 'Closed') weeklyMap[ww].closed++;
      if (row.icarStatus === 'Submitted') weeklyMap[ww].submittedIcar++;
    }

    const snapshot = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalFindings: normalized.length,
        openFindings: open.length,
        closedFindings: closed.length,
        findingStatusNotSet: statusNotSet.length,
        closureRatePercent: closureRate,
        lockedIcar: locked.length,
        submittedIcar: submitted.length,
        submittedIcarStillOpen: submittedButOpen.length,
        openOver14Days: openOver14.length,
        openOver30Days: openOver30.length,
        recordsWithoutMqeOwner: unassignedMqe.length,
      },
      openWorkload: {
        byPlatform: topCounts(open, 'platform', 12),
        byCategory: topCounts(open, 'category', 12),
        byMqe: topCounts(open, 'mqeEngineer', 12),
        byDepartment: topCounts(open, 'department', 10),
        byAuditor: topCounts(open, 'auditors', 10),
        byFindingDetail: topCounts(open, 'detailsFindings', 12),
      },
      allFindings: {
        byPlatform: topCounts(normalized, 'platform', 12),
        byCategory: topCounts(normalized, 'category', 12),
        byMqe: topCounts(normalized, 'mqeEngineer', 12),
        byAuditor: topCounts(normalized, 'auditors', 10),
      },
      workWeeks: Object.values(weeklyMap)
        .sort((a, b) => Number(a.ww) - Number(b.ww)),
      oldestOpen: [...open]
        .sort((a, b) => b.ageDays - a.ageDays)
        .slice(0, 12)
        .map((row) => ({
          no: row.no ?? row.id,
          auditDate: row.auditDate,
          ageDays: row.ageDays,
          platform: row.platform,
          category: row.category,
          detailsFindings: row.detailsFindings,
          mqeEngineer: row.mqeEngineer || 'Unassigned',
          icarStatus: row.icarStatus,
        })),
      submittedButOpen: submittedButOpen
        .slice(0, 12)
        .map((row) => ({
          no: row.no ?? row.id,
          auditDate: row.auditDate,
          platform: row.platform,
          category: row.category,
          detailsFindings: row.detailsFindings,
          icarNum: row.icarNum,
          mqeEngineer: row.mqeEngineer || 'Unassigned',
        })),
      filterValues: {
        platforms: [...new Set(normalized.map((r) => r.platform).filter(Boolean))].sort(),
        categories: [...new Set(normalized.map((r) => r.category).filter(Boolean))].sort(),
        auditors: [...new Set(normalized.map((r) => r.auditors).filter(Boolean))].sort(),
        departments: [...new Set(normalized.map((r) => r.department).filter(Boolean))].sort(),
        mqes: [...new Set(normalized.map((r) => r.mqeEngineer).filter(Boolean))].sort(),
        workWeeks: [...new Set(normalized.map((r) => String(r.ww || '')).filter(Boolean))]
          .sort((a, b) => Number(a) - Number(b)),
      },
    };

    const systemInstruction = `
You are the read-only IPQC Insights Assistant for an industrial quality-management system.

Rules:
1. Use ONLY the supplied database snapshot. Never invent counts, causes, dates, trends, people or records.
2. Finding lifecycle and ICAR lifecycle are separate:
   - finding status: Open / Closed
   - ICAR status: Locked / Submitted
   A Submitted ICAR does NOT mean the finding is Closed.
3. You are analysis-only. If the admin asks you to edit, delete, close, submit, approve or otherwise change records, clearly state that you cannot perform database changes.
4. Be concise, management-friendly and operational. Surface the most decision-relevant number first.
5. Every answer must include concrete numbers from the snapshot. Avoid vague phrases such as "requires attention" unless you immediately quantify why.
6. For broad questions such as "what requires the most attention right now?", rank the top 3-4 priorities using this order where relevant: overdue Open findings, Submitted ICARs that are still Open, high-volume Open platform/category, missing MQE ownership, latest WW deterioration.
7. End the answer with one practical recommended action. Do not write long essays.
8. When comparing work weeks, treat WW values numerically.
9. A filter should only be returned when the answer clearly maps to matching records.
10. Filter values must use exact database values from snapshot.filterValues. Leave unsupported filters blank.
11. Do not output Markdown tables.

Return ONLY valid JSON with this exact shape:
{
  "answer": "plain text answer, concise but useful; line breaks are allowed",
  "highlights": [
    {"label": "short label", "value": "display value", "detail": "optional short context"}
  ],
  "filters": {
    "status": "",
    "icarStatus": "",
    "platform": "",
    "category": "",
    "auditor": "",
    "department": "",
    "ww": "",
    "mqe": ""
  },
  "caveat": "short verification note when appropriate"
}

Use at most four highlights.
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': GEMINI_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{
                text: `Admin question:\n${question}\n\nCurrent IPQC snapshot:\n${JSON.stringify(snapshot)}`
              }],
            },
          ],
          generationConfig: {
            // Gemini 3.x: keep reasoning light for a dashboard query so more of
            // the token budget is available for the actual structured answer.
            thinkingConfig: {
              thinkingLevel: 'low',
            },
            maxOutputTokens: 1800,
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: 'object',
              properties: {
                answer: {
                  type: 'string',
                  description: 'A concise operational answer with concrete IPQC numbers, ranked priorities when relevant, and one recommended action.'
                },
                highlights: {
                  type: 'array',
                  maxItems: 4,
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      value: { type: 'string' },
                      detail: { type: 'string' }
                    },
                    required: ['label', 'value', 'detail']
                  }
                },
                filters: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    icarStatus: { type: 'string' },
                    platform: { type: 'string' },
                    category: { type: 'string' },
                    auditor: { type: 'string' },
                    department: { type: 'string' },
                    ww: { type: 'string' },
                    mqe: { type: 'string' }
                  },
                  required: ['status', 'icarStatus', 'platform', 'category', 'auditor', 'department', 'ww', 'mqe']
                },
                caveat: { type: 'string' }
              },
              required: ['answer', 'highlights', 'filters', 'caveat']
            }
          },
        }),
      }
    );

    const geminiJson = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', geminiJson);
      return res.status(502).json({
        error: geminiJson?.error?.message || 'The Gemini AI service could not process the request.'
      });
    }

    const modelText = getGeminiResponseText(geminiJson);
    const parsed = parseAiJson(modelText);
    const finishReason = geminiJson?.candidates?.[0]?.finishReason || '';

    if (!parsed || typeof parsed.answer !== 'string') {
      console.warn('Gemini structured response could not be parsed.', {
        finishReason,
        responseLength: modelText.length,
      });

      // Never send raw / truncated JSON to the UI. Give the admin a useful,
      // deterministic answer directly from the same database snapshot instead.
      const fallback = buildDeterministicAiFallback(snapshot, question);
      return res.status(200).json({
        ...fallback,
        generatedAt: snapshot.generatedAt,
      });
    }

    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights
          .filter((item) => item && item.label !== undefined && item.value !== undefined)
          .slice(0, 4)
          .map((item) => ({
            label: String(item.label),
            value: String(item.value),
            detail: item.detail ? String(item.detail) : '',
          }))
      : [];

    res.status(200).json({
      answer: String(parsed.answer),
      highlights,
      filters: sanitizeAiFilters(parsed.filters),
      caveat: parsed.caveat ? String(parsed.caveat) : '',
      generatedAt: snapshot.generatedAt,
    });
  } catch (err) {
    console.error('AI Insights error:', err);
    res.status(500).json({ error: 'AI Insights failed while reading or analyzing the IPQC data.' });
  }
});

// API: Add a New Record (CREATE)
app.post('/api/records', authenticateUser, upload.single('picture'), async (req, res) => {
  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, status, icarNum, icarStatus, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : (req.body.picture || null);
  const rowNo = no !== undefined && no !== null && no !== '' ? no : null;

  try {
    await auditTrailReady;
    const result = await queryDb(
      `INSERT INTO audit_records (
        no, audit_date, ww, shift, auditor_name, pic_finding, department,
        platform, area_station, group_finding, category, finding_details,
        picture, remark, status, icar_status, icar_num, mqe_engineer,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        rowNo, auditDate, ww, shift, auditors, personOnJob, department,
        platform, areaStation, groupFinding, category, detailsFindings,
        picture, remark, status || 'Open', icarStatus || 'Locked', icarNum || 'N/A', mqeEngineer,
        req.user.id,
      ]
    );

    if (rowNo === null) {
      // Preserve the app's existing display behavior where a missing "No." uses
      // the inserted id, while keeping the database value nullable.
    }

    const created = await selectRecordById(result.insertId);
    const source = String(req.headers['x-audit-source'] || '').trim().toLowerCase();
    const action = source === 'excel-import' ? 'FINDING_IMPORTED' : 'FINDING_CREATED';
    await writeRecordVersion(req, created, 'created');
    await logAuditEvent(req, {
      action,
      entityType: 'finding',
      entityId: result.insertId,
      description: `${action === 'FINDING_IMPORTED' ? 'Imported' : 'Created'} Finding ${formatRecordNumber(created, result.insertId)}`,
      metadata: {
        platform: created?.platform || '',
        category: created?.category || '',
        status: created?.status || 'Open',
        icarStatus: created?.icarStatus || 'Locked',
      },
    });

    res.status(201).json({
      ...created,
      no: created?.no ?? result.insertId,
    });
  } catch (err) {
    console.error('Database insertion error:', err);
    res.status(500).json({ error: 'Database insertion failed' });
  }
});

// API: Update an Existing Record (UPDATE)
app.put('/api/records/:id', authenticateUser, upload.single('picture'), async (req, res) => {
  const { id } = req.params;
  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, status, icarNum, icarStatus, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : req.body.picture;

  try {
    await auditTrailReady;
    const before = await selectRecordById(id);
    if (!before) {
      return res.status(404).json({ error: 'Record not found' });
    }
    if (before.deletedAt) {
      return res.status(409).json({ error: 'This record is in the recycle bin. Restore it before editing.' });
    }
    await ensureBaselineVersion(before);

    await queryDb(
      `UPDATE audit_records SET
        no = ?, audit_date = ?, ww = ?, shift = ?, auditor_name = ?, pic_finding = ?, department = ?,
        platform = ?, area_station = ?, group_finding = ?, category = ?, finding_details = ?,
        picture = COALESCE(?, picture), remark = ?, status = ?, icar_status = ?, icar_num = ?, mqe_engineer = ?,
        updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        no, auditDate, ww, shift, auditors, personOnJob, department,
        platform, areaStation, groupFinding, category, detailsFindings,
        picture, remark, status || 'Open', icarStatus || 'Locked', icarNum || 'N/A', mqeEngineer,
        req.user.id, id,
      ]
    );

    const updated = await selectRecordById(id);
    const source = String(req.headers['x-audit-source'] || '').trim().toLowerCase();
    const action = source === 'mqe-recalculate' ? 'FINDING_MQE_RECALCULATED' : 'FINDING_UPDATED';

    const trackedKeys = ['auditDate', 'ww', 'shift', 'auditors', 'personOnJob', 'department', 'platform',
      'areaStation', 'groupFinding', 'category', 'detailsFindings', 'remark', 'status', 'icarNum',
      'icarStatus', 'mqeEngineer'];
    const changedFields = trackedKeys.filter((key) => String(before?.[key] ?? '') !== String(updated?.[key] ?? ''));

    await writeRecordVersion(req, updated, action === 'FINDING_MQE_RECALCULATED' ? 'mqe_recalculated' : 'updated', changedFields);

    await logAuditEvent(req, {
      action,
      entityType: 'finding',
      entityId: id,
      description: `${action === 'FINDING_MQE_RECALCULATED' ? 'Recalculated MQE ownership for' : 'Updated'} Finding ${formatRecordNumber(updated, id)}`,
      metadata: {
        changedFields,
        status: updated?.status || '',
        icarStatus: updated?.icarStatus || '',
      },
    });

    res.status(200).json(updated);
  } catch (err) {
    console.error('Database update error:', err);
    res.status(500).json({ error: 'Database update failed' });
  }
});

// API: Delete a Record (SOFT DELETE / RECYCLE BIN)
app.delete('/api/records/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  try {
    await auditTrailReady;
    const before = await selectRecordById(id);
    if (!before) return res.status(404).json({ error: 'Record not found' });
    if (before.deletedAt) return res.status(409).json({ error: 'Record is already in the recycle bin' });

    await ensureBaselineVersion(before);
    await queryDb(
      'UPDATE audit_records SET deleted_by = ?, deleted_at = NOW(), updated_by = ?, updated_at = NOW() WHERE id = ?',
      [req.user.id, req.user.id, id]
    );
    const deleted = await selectRecordById(id);
    await writeRecordVersion(req, deleted, 'deleted');
    await logAuditEvent(req, {
      action: 'FINDING_DELETED',
      entityType: 'finding',
      entityId: id,
      description: `Moved Finding ${formatRecordNumber(before, id)} to recycle bin`,
      metadata: {
        platform: before.platform || '',
        category: before.category || '',
        detailsFindings: before.detailsFindings || '',
        status: before.status || '',
        recoverable: true,
      },
    });
    res.status(200).json({ message: 'Record moved to recycle bin', recoverable: true });
  } catch (err) {
    console.error('Delete record error:', err);
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

// Admin recycle bin. Records remain recoverable until an explicit retention policy
// is introduced; normal users never see them in the active records table.
app.get('/api/deleted-records', authenticateUser, requireAdmin, async (req, res) => {
  try {
    await auditTrailReady;
    const rows = await queryDb(`
      SELECT
        ar.id, ar.no, DATE_FORMAT(ar.audit_date, '%Y-%m-%d') AS auditDate, ar.ww, ar.shift,
        ar.auditor_name AS auditors, ar.pic_finding AS personOnJob, ar.department,
        ar.platform, ar.area_station AS areaStation, ar.group_finding AS groupFinding,
        ar.category, ar.finding_details AS detailsFindings, ar.picture, ar.remark, ar.status,
        ar.icar_status AS icarStatus, ar.icar_num AS icarNum, ar.mqe_engineer AS mqeEngineer,
        ar.created_by AS createdByUserId, ar.updated_by AS updatedByUserId,
        ar.created_at AS createdAt, ar.updated_at AS updatedAt,
        ar.deleted_by AS deletedByUserId, ar.deleted_at AS deletedAt,
        creator.full_name AS createdByName, editor.full_name AS updatedByName,
        deleter.full_name AS deletedByName, deleter.username AS deletedByUsername
      FROM audit_records ar
      LEFT JOIN users creator ON creator.id = ar.created_by
      LEFT JOIN users editor ON editor.id = ar.updated_by
      LEFT JOIN users deleter ON deleter.id = ar.deleted_by
      WHERE ar.deleted_at IS NOT NULL
      ORDER BY ar.deleted_at DESC, ar.id DESC
      LIMIT 200
    `);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Recycle bin error:', err);
    res.status(500).json({ error: 'Failed to load deleted records' });
  }
});

app.post('/api/records/:id/restore', authenticateUser, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await auditTrailReady;
    const before = await selectRecordById(id);
    if (!before) return res.status(404).json({ error: 'Record not found' });
    if (!before.deletedAt) return res.status(409).json({ error: 'Record is not deleted' });

    await ensureBaselineVersion(before);
    await queryDb(
      `UPDATE audit_records
       SET deleted_by = NULL, deleted_at = NULL, updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [req.user.id, id]
    );
    const restored = await selectRecordById(id);
    await writeRecordVersion(req, restored, 'restored');
    await logAuditEvent(req, {
      action: 'FINDING_RESTORED',
      entityType: 'finding',
      entityId: id,
      description: `Restored Finding ${formatRecordNumber(restored, id)} from recycle bin`,
      metadata: { restoredFromRecycleBin: true },
    });
    res.status(200).json(restored);
  } catch (err) {
    console.error('Restore record error:', err);
    res.status(500).json({ error: 'Failed to restore record' });
  }
});

app.get('/api/records/:id/versions', authenticateUser, async (req, res) => {
  try {
    await auditTrailReady;
    const rows = await queryDb(
      `SELECT id, record_id AS recordId, version_no AS versionNo,
              change_type AS changeType, snapshot, changed_fields AS changedFields,
              actor_user_id AS actorUserId, actor_name AS actorName,
              actor_role AS actorRole, created_at AS createdAt
       FROM record_versions
       WHERE record_id = ?
       ORDER BY version_no DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.status(200).json(rows.map((row) => ({
      ...row,
      snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot,
      changedFields: typeof row.changedFields === 'string'
        ? JSON.parse(row.changedFields || '[]')
        : (row.changedFields || []),
    })));
  } catch (err) {
    console.error('Record versions error:', err);
    res.status(500).json({ error: 'Failed to load record versions' });
  }
});

app.post('/api/records/:id/versions/:versionNo/restore', authenticateUser, requireAdmin, async (req, res) => {
  const recordId = Number(req.params.id);
  const versionNo = Number(req.params.versionNo);
  if (!Number.isInteger(recordId) || !Number.isInteger(versionNo)) {
    return res.status(400).json({ error: 'Invalid record/version number' });
  }

  try {
    await auditTrailReady;
    const current = await selectRecordById(recordId);
    if (!current) return res.status(404).json({ error: 'Record not found' });
    await ensureBaselineVersion(current);

    const rows = await queryDb(
      'SELECT snapshot FROM record_versions WHERE record_id = ? AND version_no = ? LIMIT 1',
      [recordId, versionNo]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Version not found' });
    const snapshot = typeof rows[0].snapshot === 'string' ? JSON.parse(rows[0].snapshot) : rows[0].snapshot;

    await applySnapshotToRecord(recordId, snapshot, req.user.id);
    const restored = await selectRecordById(recordId);
    await writeRecordVersion(req, restored, 'version_restored', ['restoredFromVersion']);
    await logAuditEvent(req, {
      action: 'FINDING_VERSION_RESTORED',
      entityType: 'finding',
      entityId: recordId,
      description: `Restored Finding ${formatRecordNumber(restored, recordId)} from version ${versionNo}`,
      metadata: { restoredVersion: versionNo },
    });
    res.status(200).json(restored);
  } catch (err) {
    console.error('Restore version error:', err);
    res.status(500).json({ error: 'Failed to restore record version' });
  }
});

// Per-finding history is available to any authenticated user viewing that finding.
app.get('/api/records/:id/history', authenticateUser, async (req, res) => {
  try {
    await auditTrailReady;
    const rows = await queryDb(
      `SELECT id, actor_user_id AS actorUserId, actor_username AS actorUsername,
              actor_name AS actorName, actor_role AS actorRole, action,
              entity_type AS entityType, entity_id AS entityId, description,
              metadata, created_at AS createdAt
       FROM audit_log
       WHERE entity_type = 'finding' AND entity_id = ?
       ORDER BY id DESC
       LIMIT 30`,
      [String(req.params.id)]
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Finding history error:', err);
    res.status(500).json({ error: 'Failed to load finding history' });
  }
});

// Admin operational audit trail: latest mutations across findings, users and settings.
app.get('/api/audit-log', authenticateUser, requireAdmin, async (req, res) => {
  try {
    await auditTrailReady;
    const requestedLimit = Number(req.query.limit || 80);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 80;
    const rows = await queryDb(
      `SELECT id, actor_user_id AS actorUserId, actor_username AS actorUsername,
              actor_name AS actorName, actor_role AS actorRole, action,
              entity_type AS entityType, entity_id AS entityId, description,
              metadata, ip_address AS ipAddress, created_at AS createdAt
       FROM audit_log
       ORDER BY id DESC
       LIMIT ${limit}`
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

app.use(express.static('dist'));

app.get('*', (req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));