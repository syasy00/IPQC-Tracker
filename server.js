import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Lightweight production security headers without adding another runtime dependency.
// The policy keeps the current bundled React app and evidence previews working
// while blocking framing, MIME sniffing and unsafe objects.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
    "img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; " +
    "font-src 'self' data: https:; script-src 'self'; connect-src 'self' https:; " +
    "frame-src 'self' https:; form-action 'self'"
  );
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (req.secure || forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const configuredOrigins = String(process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins);
app.use(cors({
  origin(origin, callback) {
    // Requests without Origin (same-server navigation, curl, health checks) are safe.
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return callback(null, true);
    }
    // Do not throw a server error. Simply omit CORS permission for untrusted origins.
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Audit-Source'],
  maxAge: 86400,
}));

// 12 MB comfortably fits a <=5 MB evidence photo after base64 encoding plus form data.
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});
app.use('/uploads', express.static('public/uploads', {
  dotfiles: 'deny',
  fallthrough: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
  },
}));

const {
  JWT_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.6-flash',
  USER_SESSION_EXPIRES_IN = '7d',
  ADMIN_SESSION_EXPIRES_IN = '8h',
  MFA_ENCRYPTION_KEY = '',
  ADMIN_MFA_CHALLENGE_EXPIRES_IN = '5m',
  ADMIN_MAX_LOGIN_ATTEMPTS = '5',
  ADMIN_LOCKOUT_MINUTES = '15',
  MAX_EVIDENCE_IMAGE_MB = '5',
  APP_TIMEZONE = 'Asia/Kuala_Lumpur'
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
  // Super Admin remains an administrator credential type, but carries a separate
  // protected ownership flag. This preserves the existing login/MFA model while
  // allowing stricter account-governance permissions.
  isSuperAdmin: row.role === 'admin' ? Boolean(row.is_super_admin) : false,
  jobTitle: row.job_title || '',
  department: row.department || '',
  isActive: Boolean(row.is_active),
  mustChangeCredential: Boolean(row.must_change_credential),
  credentialReady: row.role === 'admin'
    ? Boolean(row.password_hash ?? row.has_password)
    : Boolean(row.pin_hash ?? row.has_pin),
  mfaEnabled: row.role === 'admin' ? Boolean(row.mfa_enabled) : false,
  mfaEnrolledAt: row.role === 'admin' ? (row.mfa_enrolled_at || null) : null,
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
      is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
      job_title VARCHAR(100) NULL,
      department VARCHAR(100) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      must_change_credential BOOLEAN NOT NULL DEFAULT FALSE,
      session_version INT NOT NULL DEFAULT 0,
      mfa_secret_enc TEXT NULL,
      mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      mfa_enrolled_at DATETIME NULL,
      failed_login_attempts INT NOT NULL DEFAULT 0,
      locked_until DATETIME NULL,
      last_login_at DATETIME NULL,
      last_login_ip VARCHAR(45) NULL,
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
  await ensureUsersColumn('is_super_admin', 'is_super_admin BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureUsersColumn('mfa_secret_enc', 'mfa_secret_enc TEXT NULL');
  await ensureUsersColumn('mfa_enabled', 'mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureUsersColumn('mfa_enrolled_at', 'mfa_enrolled_at DATETIME NULL');
  await ensureUsersColumn('failed_login_attempts', 'failed_login_attempts INT NOT NULL DEFAULT 0');
  await ensureUsersColumn('locked_until', 'locked_until DATETIME NULL');
  await ensureUsersColumn('last_login_ip', 'last_login_ip VARCHAR(45) NULL');
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

  // ------------------------------------------------------------
  // Single Super Admin ownership migration
  // ------------------------------------------------------------
  // The system deliberately supports EXACTLY ONE Super Admin. It is not a
  // creatable role in the UI. Existing installations promote the current
  // System Administrator / bootstrap ADMIN_USERNAME once, then keep that owner.
  // Normal administrators remain role='admin' with is_super_admin=FALSE.
  const existingSuperAdmins = await queryDb(
    `SELECT id, username, full_name, is_active
     FROM users
     WHERE role = 'admin' AND is_super_admin = TRUE
     ORDER BY id ASC`
  );

  let superAdminTarget = existingSuperAdmins.length === 1 ? existingSuperAdmins[0] : null;

  if (!superAdminTarget) {
    // If a previous/partial migration somehow marked multiple owners, prefer the
    // configured bootstrap administrator, then the account named System Administrator.
    if (ADMIN_USERNAME) {
      const preferred = await queryDb(
        `SELECT id, username, full_name, is_active
         FROM users
         WHERE role = 'admin' AND username = ?
         LIMIT 1`,
        [ADMIN_USERNAME]
      );
      if (preferred.length > 0) superAdminTarget = preferred[0];
    }

    if (!superAdminTarget) {
      const preferred = await queryDb(
        `SELECT id, username, full_name, is_active
         FROM users
         WHERE role = 'admin' AND LOWER(full_name) = 'system administrator'
         ORDER BY id ASC
         LIMIT 1`
      );
      if (preferred.length > 0) superAdminTarget = preferred[0];
    }

    if (!superAdminTarget && existingSuperAdmins.length > 0) {
      superAdminTarget = existingSuperAdmins[0];
    }

    if (!superAdminTarget) {
      const fallback = await queryDb(
        `SELECT id, username, full_name, is_active
         FROM users
         WHERE role = 'admin'
         ORDER BY is_active DESC, id ASC
         LIMIT 1`
      );
      if (fallback.length > 0) superAdminTarget = fallback[0];
    }
  }

  if (superAdminTarget?.id) {
    // Reset any accidental duplicate flags first, then establish one protected owner.
    await queryDb(`UPDATE users SET is_super_admin = FALSE WHERE role = 'admin' AND id <> ?`, [superAdminTarget.id]);
    await queryDb(
      `UPDATE users
       SET is_super_admin = TRUE, is_active = TRUE
       WHERE id = ? AND role = 'admin'`,
      [superAdminTarget.id]
    );
    console.log(`Super Admin ready: ${superAdminTarget.full_name || superAdminTarget.username} (single system owner).`);
  } else {
    console.warn('No administrator account exists yet, so a Super Admin could not be assigned.');
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

    // Evidence is intentionally stored in MySQL as a data URL by the current
    // frontend instead of relying on Render's ephemeral local filesystem.
    // LONGTEXT safely holds the <=5 MB image payload after base64 encoding.
    const pictureColumns = await queryDb(`SHOW COLUMNS FROM audit_records LIKE 'picture'`);
    if (pictureColumns.length === 0) {
      await queryDb(`ALTER TABLE audit_records ADD COLUMN picture LONGTEXT NULL`);
      console.log('Added audit_records.picture as LONGTEXT evidence storage.');
    } else if (!String(pictureColumns[0]?.Type || '').toLowerCase().includes('longtext')) {
      await queryDb(`ALTER TABLE audit_records MODIFY COLUMN picture LONGTEXT NULL`);
      console.log('Expanded audit_records.picture to LONGTEXT for persistent evidence storage.');
    }
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

// Temporary credentials are generated on the server so admins never need to
// invent predictable defaults such as 000000. The plaintext value is returned
// only in the create/reset response, then only its bcrypt hash remains stored.
const WEAK_TEMP_PINS = new Set(['000000', '111111', '123456', '654321', '121212', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999']);
const generateTemporaryPin = () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pin = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    if (!WEAK_TEMP_PINS.has(pin)) return pin;
  }
  // crypto.randomInt is already unpredictable; this fallback is only defensive.
  return crypto.randomInt(100000, 1_000_000).toString();
};

const randomChar = (alphabet) => alphabet[crypto.randomInt(0, alphabet.length)];
const secureShuffle = (characters) => {
  const items = [...characters];
  for (let index = items.length - 1; index > 0; index--) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items.join('');
};

const generateTemporaryAdminPassword = (length = 16) => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*-_';
  const all = `${upper}${lower}${digits}${symbols}`;
  const characters = [
    randomChar(upper),
    randomChar(lower),
    randomChar(digits),
    randomChar(symbols),
  ];
  while (characters.length < Math.max(12, length)) characters.push(randomChar(all));
  return secureShuffle(characters);
};

const normalizeIcarInput = (value) => {
  const trimmed = String(value ?? '').trim();
  const hasIcarNumber = trimmed !== '' && trimmed.toUpperCase() !== 'N/A';
  return {
    icarNum: hasIcarNumber ? trimmed : 'N/A',
    icarStatus: hasIcarNumber ? 'Submitted' : 'Locked',
  };
};

const maxEvidenceImageBytes = Math.max(1, Number(MAX_EVIDENCE_IMAGE_MB) || 5) * 1024 * 1024;
const VALID_FINDING_STATUSES = new Set(['Open', 'Closed']);
const VALID_SHIFTS = new Set(['A', 'B', 'C']);

const getCurrentAppDateISO = () => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const detectEvidenceImageMime = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
};

const validateEvidencePictureValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);

  if (text.startsWith('/uploads/')) {
    return /^\/uploads\/[A-Za-z0-9._-]{1,240}$/.test(text) ? null : 'Evidence file reference is not valid.';
  }
  if (/^https:\/\//i.test(text)) {
    return text.length <= 2048 ? null : 'Evidence image URL is too long.';
  }
  if (/^data:/i.test(text)) {
    const match = text.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return 'Evidence photo must be a JPG, PNG or WEBP image.';
    const encoded = match[2];
    const base64 = encoded.replace(/=+$/, '');
    const estimatedBytes = Math.floor((base64.length * 3) / 4);
    if (estimatedBytes > maxEvidenceImageBytes) {
      return `Evidence photo must be ${Math.max(1, Number(MAX_EVIDENCE_IMAGE_MB) || 5)} MB or smaller.`;
    }
    try {
      const header = Buffer.from(encoded.slice(0, 64), 'base64');
      const detectedMime = detectEvidenceImageMime(header);
      if (!detectedMime || detectedMime.toLowerCase() !== match[1].toLowerCase()) {
        return 'Evidence photo content does not match a supported JPG, PNG or WEBP image.';
      }
    } catch {
      return 'Evidence photo data is not valid.';
    }
    return null;
  }
  return 'Evidence photo reference is not valid.';
};

const validateFindingPayload = (body = {}) => {
  const errors = {};
  const text = (key, max, required = false) => {
    const value = String(body?.[key] ?? '').trim();
    if (required && !value) errors[key] = 'This field is required.';
    else if (value.length > max) errors[key] = `Must be ${max} characters or fewer.`;
    return value;
  };

  const auditDate = text('auditDate', 10, true);
  if (auditDate) {
    const parsedAuditDate = new Date(`${auditDate}T00:00:00Z`);
    const isValidCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(auditDate)
      && !Number.isNaN(parsedAuditDate.getTime())
      && parsedAuditDate.toISOString().slice(0, 10) === auditDate;
    if (!isValidCalendarDate) errors.auditDate = 'Enter a valid audit date.';
    else if (auditDate > getCurrentAppDateISO()) errors.auditDate = 'Audit date cannot be in the future.';
  }

  const wwText = String(body?.ww ?? '').trim();
  const ww = Number(wwText);
  if (!Number.isInteger(ww) || ww < 1 || ww > 53) errors.ww = 'Work week must be between 1 and 53.';

  const shift = text('shift', 10, true);
  if (shift && !VALID_SHIFTS.has(shift)) errors.shift = 'Shift must be A, B or C.';

  const statusRaw = text('status', 20, true);
  const status = statusRaw.toLowerCase() === 'closed' ? 'Closed' : statusRaw.toLowerCase() === 'open' ? 'Open' : statusRaw;
  if (status && !VALID_FINDING_STATUSES.has(status)) errors.status = 'Finding status must be Open or Closed.';

  const noRaw = body?.no;
  const no = noRaw === undefined || noRaw === null || String(noRaw).trim() === '' ? null : Number(noRaw);
  if (no !== null && (!Number.isInteger(no) || no < 0)) errors.no = 'Finding number must be a non-negative integer.';

  const value = {
    no,
    auditDate,
    ww: wwText,
    shift,
    auditors: text('auditors', 150, true),
    personOnJob: text('personOnJob', 150, true),
    department: text('department', 100, true),
    platform: text('platform', 150, true),
    areaStation: text('areaStation', 180, true),
    groupFinding: text('groupFinding', 100, false),
    category: text('category', 150, true),
    detailsFindings: text('detailsFindings', 1000, true),
    remark: text('remark', 3000, false),
    status,
    icarNum: text('icarNum', 120, false),
    icarStatus: text('icarStatus', 20, false),
    mqeEngineer: text('mqeEngineer', 150, false),
    picture: body?.picture ?? null,
  };

  const pictureError = validateEvidencePictureValue(value.picture);
  if (pictureError) errors.picture = pictureError;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value,
  };
};

const parsePositiveRecordId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};


// ==========================================
// Administrator MFA (TOTP)
// ==========================================
// No email service is required. Administrators enrol a standard authenticator
// app (Microsoft Authenticator, Google Authenticator, 1Password, etc.) using a
// one-time setup key, then enter a rotating 6-digit TOTP code at sign-in.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const mfaKeyMaterial = String(MFA_ENCRYPTION_KEY || JWT_SECRET || '');
if (!MFA_ENCRYPTION_KEY) {
  console.warn('WARNING: MFA_ENCRYPTION_KEY is not configured. JWT_SECRET will be used as the MFA encryption key until a separate key is added.');
}

const getMfaEncryptionKey = () => crypto.createHash('sha256').update(mfaKeyMaterial).digest();

const encryptMfaSecret = (plaintext) => {
  if (!plaintext || !mfaKeyMaterial) throw new Error('MFA encryption is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decryptMfaSecret = (payload) => {
  const text = String(payload || '');
  const [version, ivB64, tagB64, dataB64] = text.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64 || !mfaKeyMaterial) {
    throw new Error('Invalid MFA secret payload');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMfaEncryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
};

const base32Encode = (buffer) => {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
};

const base32Decode = (value) => {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 MFA secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const generateMfaSecret = () => base32Encode(crypto.randomBytes(20));

const generateTotpCode = (secret, timestampMs = Date.now()) => {
  const step = Math.floor(timestampMs / 1000 / 30);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
};

const verifyTotpCode = (secret, code) => {
  const normalized = String(code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const received = Buffer.from(normalized);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(generateTotpCode(secret, Date.now() + offset * 30000));
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) return true;
  }
  return false;
};

const createMfaChallenge = (row, stage) => jwt.sign(
  {
    purpose: 'admin-mfa',
    stage,
    userId: Number(row.id),
    sessionVersion: Number(row.session_version || 0),
  },
  JWT_SECRET,
  { expiresIn: ADMIN_MFA_CHALLENGE_EXPIRES_IN }
);

const loadMfaChallengeUser = async (challengeToken, expectedStage) => {
  if (!challengeToken || !JWT_SECRET) return null;
  const decoded = jwt.verify(challengeToken, JWT_SECRET);
  if (decoded?.purpose !== 'admin-mfa' || decoded?.stage !== expectedStage) return null;
  const rows = await queryDb(
    `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
            job_title, department, is_active, must_change_credential, session_version,
            mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
            locked_until, last_login_at, last_login_ip, created_at, updated_at
     FROM users WHERE id = ? AND role = 'admin' LIMIT 1`,
    [Number(decoded.userId)]
  );
  const row = rows[0];
  if (!row || !row.is_active || Number(row.session_version || 0) !== Number(decoded.sessionVersion || 0)) return null;
  return row;
};

const isAdminLocked = (row) => {
  if (!row?.locked_until) return false;
  return new Date(row.locked_until).getTime() > Date.now();
};

const recordAdminPasswordFailure = async (row) => {
  if (!row?.id) return { locked: false };
  const maxAttempts = Math.max(3, Number(ADMIN_MAX_LOGIN_ATTEMPTS) || 5);
  const lockoutMinutes = Math.max(1, Number(ADMIN_LOCKOUT_MINUTES) || 15);
  const nextFailures = Number(row.failed_login_attempts || 0) + 1;
  if (nextFailures >= maxAttempts) {
    const lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
    await queryDb(
      'UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?',
      [lockedUntil, row.id]
    );
    return { locked: true, lockedUntil };
  }
  await queryDb('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [nextFailures, row.id]);
  return { locked: false };
};

const clearAdminLoginFailures = async (userId) => {
  await queryDb('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [userId]);
};

const logAdminSecurityEvent = async (req, row, action, description, metadata = null) => {
  try {
    await auditTrailReady;
    await queryDb(
      `INSERT INTO audit_log
        (actor_user_id, actor_username, actor_name, actor_role,
         action, entity_type, entity_id, description, metadata, ip_address)
       VALUES (?, ?, ?, 'admin', ?, 'session', ?, ?, ?, ?)`,
      [
        row?.id || null,
        String(row?.username || req.body?.username || 'unknown'),
        String(row?.full_name || row?.username || 'Unknown administrator'),
        String(action),
        row?.id ? String(row.id) : null,
        String(description).slice(0, 500),
        metadata ? JSON.stringify(metadata) : null,
        getRequestIp(req),
      ]
    );
  } catch (err) {
    console.error('Admin security audit write failed:', err);
  }
};

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
    const mfaVerified = decoded.mfaVerified === true;
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid or expired session, please sign in again' });
    }

    const rows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
              job_title, department, is_active, must_change_credential, session_version,
              mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
              locked_until, last_login_at, last_login_ip, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    const row = rows[0];
    if (!row || !row.is_active || Number(row.session_version || 0) !== sessionVersion) {
      return res.status(401).json({ error: 'Account is inactive or the session is no longer valid' });
    }
    if (row.role === 'admin' && (!row.mfa_enabled || !mfaVerified)) {
      return res.status(401).json({ error: 'Administrator sign-in requires MFA verification' });
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

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin' || req.user.isSuperAdmin !== true) {
    return res.status(403).json({ error: 'Super Admin access required' });
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
      mfaVerified: isAdminAccount,
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
  const rate = allowAuthAttempt(rateKey, mode === 'admin' ? 5 : 6, mode === 'admin' ? 15 * 60 * 1000 : 10 * 60 * 1000);
  if (!rate.allowed) {
    res.set('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server authentication is not configured. Contact the administrator.' });
  }

  try {
    await usersReady;

    if (mode === 'admin') {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: 'Administrator username and password are required' });
      }

      const rows = await queryDb(
        `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
                job_title, department, is_active, must_change_credential, session_version,
                mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
                locked_until, last_login_at, last_login_ip, created_at, updated_at
         FROM users WHERE username = ? AND role = 'admin' LIMIT 1`,
        [username]
      );
      const user = rows[0];

      if (user && isAdminLocked(user)) {
        await logAdminSecurityEvent(req, user, 'ADMIN_ACCOUNT_LOCKED', `${user.full_name || user.username} attempted sign-in while the administrator account was temporarily locked`);
        return res.status(423).json({ error: 'Administrator account is temporarily locked. Try again later.' });
      }

      const credentialMatches = Boolean(user?.password_hash) && await bcrypt.compare(password, user.password_hash);
      if (!user || !user.is_active || !credentialMatches) {
        if (user?.is_active) {
          const failure = await recordAdminPasswordFailure(user);
          await logAdminSecurityEvent(
            req,
            user,
            failure.locked ? 'ADMIN_ACCOUNT_LOCKED' : 'ADMIN_LOGIN_FAILED',
            failure.locked
              ? `${user.full_name || user.username} administrator account was temporarily locked after repeated failed password attempts`
              : `Failed administrator password attempt for ${user.full_name || user.username}`,
            { reason: 'password' }
          );
        }
        return res.status(401).json({ error: 'Invalid administrator credentials' });
      }

      await clearAdminLoginFailures(user.id);

      let setupSecret = null;
      if (!user.mfa_enabled) {
        // Generate a fresh enrolment secret every time the administrator returns
        // through the password step before MFA is enabled. This invalidates any
        // abandoned/exposed setup QR or manual key from an earlier attempt.
        setupSecret = generateMfaSecret();
        await queryDb('UPDATE users SET mfa_secret_enc = ? WHERE id = ?', [encryptMfaSecret(setupSecret), user.id]);
        const label = `IPQC Tracker:${user.username}`;
        const otpauthUrl = `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(setupSecret)}&issuer=${encodeURIComponent('IPQC Tracker')}&digits=6&period=30`;
        clearAuthAttempts(rateKey);
        return res.status(200).json({
          mfaSetupRequired: true,
          challengeToken: createMfaChallenge(user, 'setup'),
          setupKey: setupSecret,
          otpauthUrl,
          accountLabel: user.username,
        });
      }

      clearAuthAttempts(rateKey);
      return res.status(200).json({
        mfaRequired: true,
        challengeToken: createMfaChallenge(user, 'verify'),
        accountLabel: user.username,
      });
    }

    const employeeId = String(req.body?.employeeId || '').trim();
    const pin = String(req.body?.pin || '');
    if (!employeeId || !pin) {
      return res.status(400).json({ error: 'Select your employee identity and enter your PIN' });
    }
    if (!isSixDigitPin(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 6 digits' });
    }

    const rows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
              job_title, department, is_active, must_change_credential, session_version,
              mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
              locked_until, last_login_at, last_login_ip, created_at, updated_at
       FROM users WHERE employee_id = ? AND role = 'user' LIMIT 1`,
      [employeeId]
    );
    const user = rows[0];
    const credentialMatches = Boolean(user?.pin_hash) && await bcrypt.compare(pin, user.pin_hash);
    if (!user || !user.is_active || !credentialMatches) {
      return res.status(401).json({ error: 'Invalid employee or PIN' });
    }

    await queryDb('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [getRequestIp(req), user.id]);
    const refreshedRows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
              job_title, department, is_active, must_change_credential, session_version,
              mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
              locked_until, last_login_at, last_login_ip, created_at, updated_at
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

app.post('/api/login/mfa/setup', async (req, res) => {
  const challengeToken = String(req.body?.challengeToken || '');
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit authenticator code' });

  try {
    const user = await loadMfaChallengeUser(challengeToken, 'setup');
    if (!user || user.mfa_enabled || !user.mfa_secret_enc) {
      return res.status(401).json({ error: 'MFA setup session is no longer valid. Start administrator sign-in again.' });
    }
    const rateKey = `mfa-setup:${getRequestIp(req) || 'unknown'}:${user.id}`;
    const rate = allowAuthAttempt(rateKey, 6, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many verification attempts. Wait a few minutes and try again.' });
    }

    const secret = decryptMfaSecret(user.mfa_secret_enc);
    if (!verifyTotpCode(secret, code)) {
      await logAdminSecurityEvent(req, user, 'ADMIN_MFA_FAILED', `Invalid authenticator code during MFA enrolment for ${user.full_name || user.username}`, { stage: 'setup' });
      return res.status(401).json({ error: 'Invalid authenticator code. Check the code and try again.' });
    }

    await queryDb(
      `UPDATE users
       SET mfa_enabled = TRUE, mfa_enrolled_at = NOW(), failed_login_attempts = 0,
           locked_until = NULL, last_login_at = NOW(), last_login_ip = ?
       WHERE id = ?`,
      [getRequestIp(req), user.id]
    );
    clearAuthAttempts(rateKey);

    const refreshedRows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
              job_title, department, is_active, must_change_credential, session_version,
              mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
              locked_until, last_login_at, last_login_ip, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );
    const refreshed = refreshedRows[0];
    const publicUser = toPublicUser(refreshed);
    req.user = publicUser;
    await logAuditEvent(req, {
      action: 'ADMIN_MFA_ENROLLED',
      entityType: 'user',
      entityId: publicUser.id,
      description: `${publicUser.fullName} enabled authenticator MFA`,
    });
    await logAuditEvent(req, {
      action: 'USER_SIGNED_IN',
      entityType: 'session',
      entityId: publicUser.id,
      description: `${publicUser.fullName} signed in`,
      metadata: { role: 'admin', mfa: true },
    });
    res.status(200).json({ ...issueSession(refreshed), user: publicUser });
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'MFA setup session expired. Start administrator sign-in again.' });
    }
    console.error('MFA setup error:', err);
    res.status(500).json({ error: 'Could not complete MFA setup' });
  }
});

app.post('/api/login/mfa/verify', async (req, res) => {
  const challengeToken = String(req.body?.challengeToken || '');
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit authenticator code' });

  try {
    const user = await loadMfaChallengeUser(challengeToken, 'verify');
    if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
      return res.status(401).json({ error: 'MFA verification session is no longer valid. Start administrator sign-in again.' });
    }
    const rateKey = `mfa-verify:${getRequestIp(req) || 'unknown'}:${user.id}`;
    const rate = allowAuthAttempt(rateKey, 6, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many verification attempts. Wait a few minutes and try again.' });
    }

    const secret = decryptMfaSecret(user.mfa_secret_enc);
    if (!verifyTotpCode(secret, code)) {
      await logAdminSecurityEvent(req, user, 'ADMIN_MFA_FAILED', `Invalid authenticator code for ${user.full_name || user.username}`, { stage: 'verify' });
      return res.status(401).json({ error: 'Invalid authenticator code. Check the code and try again.' });
    }

    await queryDb(
      'UPDATE users SET last_login_at = NOW(), last_login_ip = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [getRequestIp(req), user.id]
    );
    clearAuthAttempts(rateKey);
    const refreshedRows = await queryDb(
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
              job_title, department, is_active, must_change_credential, session_version,
              mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
              locked_until, last_login_at, last_login_ip, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );
    const refreshed = refreshedRows[0];
    const publicUser = toPublicUser(refreshed);
    req.user = publicUser;
    await logAuditEvent(req, {
      action: 'USER_SIGNED_IN',
      entityType: 'session',
      entityId: publicUser.id,
      description: `${publicUser.fullName} signed in`,
      metadata: { role: 'admin', mfa: true },
    });
    res.status(200).json({ ...issueSession(refreshed), user: publicUser });
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'MFA verification session expired. Start administrator sign-in again.' });
    }
    console.error('MFA verify error:', err);
    res.status(500).json({ error: 'Could not verify MFA code' });
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
      `SELECT id, username, employee_id, full_name, role, is_super_admin, job_title, department,
              is_active, must_change_credential, session_version, last_login_at,
              created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'admin') {
      const password = String(req.body?.password || '');
      if (password.length < 12) {
        return res.status(400).json({ error: 'Administrator password must be at least 12 characters' });
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
      `SELECT id, username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin,
              job_title, department, is_active, must_change_credential, session_version,
              mfa_secret_enc, mfa_enabled, mfa_enrolled_at, failed_login_attempts,
              locked_until, last_login_at, last_login_ip, created_at, updated_at
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
      SELECT id, username, employee_id, full_name, role, is_super_admin, job_title, department,
             is_active, must_change_credential, mfa_enabled, mfa_enrolled_at,
             last_login_at, created_at, updated_at,
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
  if (role === 'admin' && req.user?.isSuperAdmin !== true) {
    return res.status(403).json({ error: 'Only the Super Admin can create administrator accounts.' });
  }
  const fullName = String(req.body?.fullName || '').trim();
  const jobTitle = String(req.body?.jobTitle || '').trim() || null;
  const department = String(req.body?.department || '').trim() || null;

  if (!fullName) return res.status(400).json({ error: 'Full name is required' });

  try {
    let result;
    let temporaryCredential;
    if (role === 'admin') {
      const username = String(req.body?.username || '').trim();
      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Administrator username must be 3-100 characters using letters, numbers, dot, underscore or hyphen' });
      }
      temporaryCredential = generateTemporaryAdminPassword();
      const passwordHash = await bcrypt.hash(temporaryCredential, 12);
      result = await queryDb(
        `INSERT INTO users
          (username, employee_id, password_hash, pin_hash, full_name, role, is_super_admin, job_title,
           department, is_active, must_change_credential, session_version)
         VALUES (?, NULL, ?, NULL, ?, 'admin', FALSE, ?, ?, TRUE, TRUE, 0)`,
        [username, passwordHash, fullName, jobTitle, department]
      );
    } else {
      const employeeId = String(req.body?.employeeId || '').trim();
      if (!isValidEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Employee ID must be 2-50 characters using letters, numbers, dot, underscore or hyphen' });
      }
      temporaryCredential = generateTemporaryPin();
      const pinHash = await bcrypt.hash(temporaryCredential, 12);
      result = await queryDb(
        `INSERT INTO users
          (username, employee_id, password_hash, pin_hash, full_name, role, job_title,
           department, is_active, must_change_credential, session_version)
         VALUES (?, ?, NULL, ?, ?, 'user', ?, ?, TRUE, TRUE, 0)`,
        [employeeId, employeeId, pinHash, fullName, jobTitle, department]
      );
    }

    const rows = await queryDb(
      `SELECT id, username, employee_id, full_name, role, is_super_admin, job_title, department,
              is_active, must_change_credential, mfa_enabled, mfa_enrolled_at,
              last_login_at, created_at, updated_at,
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
        temporaryCredentialIssued: true,
        requiresChangeOnNextLogin: true,
      },
    });

    // IMPORTANT: temporaryCredential is intentionally returned only in this
    // single response. It is never written to audit_log or stored in plaintext.
    res.status(201).json({
      ...createdUser,
      temporaryCredential,
      credentialType: role === 'admin' ? 'password' : 'pin',
      shownOnce: true,
    });
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
      `SELECT id, username, employee_id, full_name, role, is_super_admin, job_title, department,
              is_active, password_hash, pin_hash
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    if (currentRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = currentRows[0];

    if (Boolean(target.is_super_admin) && targetId !== Number(req.user.id)) {
      return res.status(403).json({ error: 'The Super Admin account is protected and cannot be managed by another account.' });
    }
    if (target.role === 'admin' && !Boolean(target.is_super_admin) && req.user?.isSuperAdmin !== true && targetId !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Only the Super Admin can manage administrator accounts.' });
    }

    if (req.body?.role && req.body.role !== target.role) {
      return res.status(400).json({ error: 'Changing account role in place is disabled. Create a separate account with the correct role.' });
    }
    if (targetId === Number(req.user.id) && !isActive) {
      return res.status(400).json({ error: 'You cannot deactivate your own administrator account' });
    }
    if (Boolean(target.is_super_admin) && !isActive) {
      return res.status(403).json({ error: 'The single Super Admin account cannot be deactivated.' });
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
      `SELECT id, username, employee_id, full_name, role, is_super_admin, job_title, department,
              is_active, must_change_credential, mfa_enabled, mfa_enrolled_at,
              last_login_at, created_at, updated_at,
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
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Use your own credential-change flow instead of resetting your current session here' });
  }

  try {
    const rows = await queryDb(
      'SELECT id, username, employee_id, full_name, role, is_super_admin FROM users WHERE id = ? LIMIT 1',
      [targetId]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (Boolean(target.is_super_admin)) {
      return res.status(403).json({ error: 'The Super Admin credential cannot be reset from User Access Management. Use the signed-in account password-change flow.' });
    }
    if (target.role === 'admin' && req.user?.isSuperAdmin !== true) {
      return res.status(403).json({ error: 'Only the Super Admin can reset an administrator password.' });
    }

    const temporaryCredential = target.role === 'admin'
      ? generateTemporaryAdminPassword()
      : generateTemporaryPin();

    if (target.role === 'admin') {
      const passwordHash = await bcrypt.hash(temporaryCredential, 12);
      await queryDb(
        `UPDATE users
         SET password_hash = ?, pin_hash = NULL, must_change_credential = TRUE,
             session_version = session_version + 1
         WHERE id = ?`,
        [passwordHash, targetId]
      );
    } else {
      const pinHash = await bcrypt.hash(temporaryCredential, 12);
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
      description: `Issued a replacement temporary ${target.role === 'admin' ? 'password' : 'PIN'} for ${target.full_name || target.username}`,
      metadata: {
        targetRole: target.role,
        requiresChangeOnNextLogin: true,
        temporaryCredentialIssued: true,
        sessionsRevoked: true,
      },
    });

    // Returned once to the authenticated administrator who performed the reset.
    res.status(200).json({
      message: target.role === 'admin'
        ? 'A new temporary administrator password was generated.'
        : 'A new temporary employee PIN was generated.',
      role: target.role,
      fullName: target.full_name || target.username,
      username: target.role === 'admin' ? target.username : undefined,
      employeeId: target.role === 'user' ? target.employee_id : undefined,
      temporaryCredential,
      credentialType: target.role === 'admin' ? 'password' : 'pin',
      shownOnce: true,
    });
  } catch (err) {
    console.error('Reset credential error:', err);
    res.status(500).json({ error: 'Failed to reset credential' });
  }
});


app.post('/api/users/:id/reset-mfa', authenticateUser, requireSuperAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Another administrator must reset MFA for your own account.' });
  }

  try {
    const rows = await queryDb(
      'SELECT id, username, full_name, role, is_super_admin, is_active FROM users WHERE id = ? LIMIT 1',
      [targetId]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role !== 'admin') return res.status(400).json({ error: 'MFA reset applies only to administrator accounts' });
    if (Boolean(target.is_super_admin)) {
      return res.status(403).json({ error: 'The single Super Admin MFA cannot be reset from User Access Management.' });
    }

    await queryDb(
      `UPDATE users
       SET mfa_secret_enc = NULL, mfa_enabled = FALSE, mfa_enrolled_at = NULL,
           session_version = session_version + 1
       WHERE id = ?`,
      [targetId]
    );

    await logAuditEvent(req, {
      action: 'ADMIN_MFA_RESET',
      entityType: 'user',
      entityId: targetId,
      description: `Reset authenticator MFA for ${target.full_name || target.username}`,
      metadata: { targetRole: 'admin', sessionsRevoked: true },
    });
    res.status(200).json({ message: 'Administrator MFA reset. The account must enrol an authenticator again at next sign-in.' });
  } catch (err) {
    console.error('Reset MFA error:', err);
    res.status(500).json({ error: 'Failed to reset administrator MFA' });
  }
});


// Super Admin only: permanently remove an UNUSED account.
// Accounts with finding/audit/version history are intentionally preserved and
// must be deactivated instead so QMS traceability is never broken.
app.delete('/api/users/:id', authenticateUser, requireSuperAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === Number(req.user.id)) return res.status(400).json({ error: 'You cannot remove your own Super Admin account.' });

  try {
    await auditTrailReady;
    const rows = await queryDb(
      `SELECT id, username, employee_id, full_name, role, is_super_admin, is_active
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (Boolean(target.is_super_admin)) {
      return res.status(403).json({ error: 'The single Super Admin account cannot be removed.' });
    }

    const usageRows = await queryDb(
      `SELECT
         (SELECT COUNT(*) FROM audit_records
          WHERE created_by = ? OR updated_by = ? OR deleted_by = ?) AS findingRefs,
         (SELECT COUNT(*) FROM record_versions WHERE actor_user_id = ?) AS versionRefs,
         (SELECT COUNT(*) FROM audit_log WHERE actor_user_id = ?) AS auditRefs`,
      [targetId, targetId, targetId, targetId, targetId]
    );
    const usage = usageRows[0] || {};
    const findingRefs = Number(usage.findingRefs || 0);
    const versionRefs = Number(usage.versionRefs || 0);
    const auditRefs = Number(usage.auditRefs || 0);
    const totalRefs = findingRefs + versionRefs + auditRefs;

    if (totalRefs > 0) {
      return res.status(409).json({
        error: 'This account has historical system activity and cannot be permanently removed. Deactivate it instead to preserve traceability.',
        references: { findings: findingRefs, versions: versionRefs, auditEvents: auditRefs },
      });
    }

    await queryDb('DELETE FROM users WHERE id = ?', [targetId]);
    await logAuditEvent(req, {
      action: 'USER_PERMANENTLY_REMOVED',
      entityType: 'user',
      entityId: targetId,
      description: `Permanently removed unused ${target.role === 'admin' ? 'administrator' : 'employee'} account ${target.full_name || target.username}`,
      metadata: {
        targetRole: target.role,
        targetUsername: target.role === 'admin' ? target.username : null,
        targetEmployeeId: target.role === 'user' ? target.employee_id : null,
        superAdminOnly: true,
        historicalReferences: 0,
      },
    });
    res.status(200).json({ success: true, removedUserId: targetId });
  } catch (err) {
    console.error('Permanent user removal error:', err);
    res.status(500).json({ error: 'Failed to remove account' });
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
// App Settings (global lists that remain JSON settings)
// - Auditor directory
// - Platform -> MQE ownership
// Finding classifications are intentionally NOT stored here. They use normalized relational tables below.
// ==========================================
const parseSettingsJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const ensureSettingsTable = async () => {
  await queryDb(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT PRIMARY KEY,
      auditors JSON NOT NULL,
      mqe_mappings JSON NOT NULL
    )
  `);

  const rows = await queryDb('SELECT id FROM app_settings WHERE id = 1 LIMIT 1');
  if (rows.length === 0) {
    await queryDb(
      'INSERT INTO app_settings (id, auditors, mqe_mappings) VALUES (1, ?, ?)',
      [JSON.stringify([]), JSON.stringify({})]
    );
  }
};

const settingsReady = ensureSettingsTable().catch((err) => {
  console.error('Failed to initialize app settings:', err);
  throw err;
});

app.get('/api/settings', authenticateUser, async (req, res) => {
  try {
    await settingsReady;
    const rows = await queryDb('SELECT auditors, mqe_mappings FROM app_settings WHERE id = 1 LIMIT 1');
    if (rows.length === 0) return res.status(200).json({ auditors: [], mqeMappings: {} });

    const row = rows[0];
    const auditors = parseSettingsJson(row.auditors, []);
    const mqeMappings = parseSettingsJson(row.mqe_mappings, {});
    res.status(200).json({
      auditors: Array.isArray(auditors) ? auditors : [],
      mqeMappings: mqeMappings && typeof mqeMappings === 'object' ? mqeMappings : {},
    });
  } catch (err) {
    console.error('Failed to fetch settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/settings', authenticateUser, requireAdmin, async (req, res) => {
  const { auditors, mqeMappings } = req.body || {};
  if (!Array.isArray(auditors) || typeof mqeMappings !== 'object' || mqeMappings === null || Array.isArray(mqeMappings)) {
    return res.status(400).json({ error: 'auditors must be an array and mqeMappings must be an object' });
  }

  const cleanedAuditors = [];
  const auditorKeys = new Set();
  for (const raw of auditors) {
    const name = String(raw || '').trim();
    if (!name) continue;
    if (name.length > 150) return res.status(400).json({ error: 'Auditor names must be 150 characters or fewer' });
    const key = name.toLowerCase();
    if (auditorKeys.has(key)) return res.status(400).json({ error: `Duplicate auditor: ${name}` });
    auditorKeys.add(key);
    cleanedAuditors.push(name);
  }

  const cleanedMappings = {};
  for (const [platformRaw, ownerRaw] of Object.entries(mqeMappings)) {
    const platform = String(platformRaw || '').trim();
    const owner = String(ownerRaw || '').trim();
    if (!platform || !owner) continue;
    if (platform.length > 150 || owner.length > 150) {
      return res.status(400).json({ error: 'Platform and MQE names must be 150 characters or fewer' });
    }
    cleanedMappings[platform] = owner;
  }

  try {
    await settingsReady;
    const beforeRows = await queryDb('SELECT auditors, mqe_mappings FROM app_settings WHERE id = 1 LIMIT 1');
    const before = beforeRows[0] || { auditors: [], mqe_mappings: {} };
    const previousAuditors = parseSettingsJson(before.auditors, []);
    const previousMappings = parseSettingsJson(before.mqe_mappings, {});

    await queryDb(
      'UPDATE app_settings SET auditors = ?, mqe_mappings = ? WHERE id = 1',
      [JSON.stringify(cleanedAuditors), JSON.stringify(cleanedMappings)]
    );

    const auditorsChanged = JSON.stringify(previousAuditors) !== JSON.stringify(cleanedAuditors);
    const mappingsChanged = JSON.stringify(previousMappings) !== JSON.stringify(cleanedMappings);
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
          auditorCount: cleanedAuditors.length,
          mappedPlatformCount: Object.values(cleanedMappings).filter((value) => String(value || '').trim()).length,
        },
      });
    }

    res.status(200).json({ auditors: cleanedAuditors, mqeMappings: cleanedMappings });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ==========================================
// Finding Classification Master Data
// Normalized relational model:
// finding_groups -> finding_categories -> finding_details
// The Add/Edit Finding UI reads these tables at runtime. Historical audit_records keep their stored text values.
// ==========================================
const DEFAULT_FINDING_CLASSIFICATION_SEED = [
  {
    "category": "6S",
    "groupFinding": "Method",
    "details": [
      "Mix material inside the material bin",
      "Dustbin located at non-kanban area",
      "Unnecessary item/material found on the workstation",
      "Improper storage of Tool/Equipment",
      "Mixed chemicals stored in the same bin",
      "No Workstation / Tester Identification",
      "No label Identification on Equipment / Tools",
      "Material Scrap Bin without cover",
      "Dust on workstation/rack/ect",
      "Trolly not properly inside kanban",
      "Improper storage of Kit / Bulk Material"
    ]
  },
  {
    "category": "Calibration",
    "groupFinding": "Machine",
    "details": [
      "Calibration Overdue ESD Monitor",
      "Calibration Overdue Manual Torque",
      "Equipment without Calibration Label",
      "Calibration Overdue Tools / Equipment",
      "Calibration Overdue Torque Drive",
      "Calibration Overdue Solder Iron"
    ]
  },
  {
    "category": "PM",
    "groupFinding": "Machine",
    "details": [
      "Equipment without Preventive Equipment Label",
      "Preventive Maintenance Overdue"
    ]
  },
  {
    "category": "Procedural non-compliance",
    "groupFinding": "Method",
    "details": [
      "Setup check list not updated",
      "Operating the process without OMS/WI displayed",
      "Not following OMS / WI",
      "No Set-Up Checklist displayed"
    ]
  },
  {
    "category": "Docs/WI",
    "groupFinding": "Method",
    "details": [
      "Use Obsolete Visual Standard",
      "OMS doesn't match current practice",
      "Incomplete OMS"
    ]
  },
  {
    "category": "ESD",
    "groupFinding": "Machine",
    "details": [
      "Ionizer turn off",
      "No Insulative Mat",
      "Ionizer is not available at the workstation",
      "ESD mat was not grounded",
      "No ESD grounding points",
      "ESD Monitoring not function",
      "Ionizer Calibration Date Expired"
    ]
  },
  {
    "category": "Expired Material",
    "groupFinding": "Material",
    "details": [
      "Chemical / Material Overdue"
    ]
  },
  {
    "category": "Safety Concern",
    "groupFinding": "Man",
    "details": [
      "Improper sitting position",
      "Water leaking from the tester/machine",
      "Material Handling & Storage",
      "Cable wire damage"
    ]
  },
  {
    "category": "Identification",
    "groupFinding": "Material",
    "details": [
      "IPA without Expiry Date Label",
      "IPA Label Damage , Torn, Smear",
      "Material without Expiring Label",
      "Torque number is smear / missing /damage / torn off",
      "Missing Label Expiry Date",
      "Calibration Label damage, Torn on Tools / Equipment"
    ]
  },
  {
    "category": "Training/Competency",
    "groupFinding": "Man",
    "details": [
      "Assembler operating without certification",
      "Assembler improper used of jigs / Fixture at Workstation"
    ]
  },
  {
    "category": "Handling",
    "groupFinding": "Man",
    "details": [
      "Operators handling parts without required gloves or finger cots.",
      "Material handled without ESD protection.",
      "Product transferred without using the designated tray/trolley",
      "Components / Unit placed directly on the floor.",
      "Product exposed to contamination during handling.",
      "WIP transported without proper identification"
    ]
  }
];
const MASTER_FINDING_GROUPS = ['Man', 'Machine', 'Method', 'Material'];

const classificationText = (value, maxLength) => {
  const text = String(value || '').trim();
  if (!text) return { ok: false, error: 'A value is required.', value: '' };
  if (text.length > maxLength) return { ok: false, error: `Must be ${maxLength} characters or fewer.`, value: '' };
  return { ok: true, value: text };
};

const detailHash = (description) => crypto
  .createHash('sha256')
  .update(String(description || '').trim().toLowerCase(), 'utf8')
  .digest('hex');

const ensureFindingClassificationSchema = async () => {
  await queryDb(`
    CREATE TABLE IF NOT EXISTS finding_groups (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_finding_groups_name (name)
    ) ENGINE=InnoDB
  `);

  await queryDb(`
    CREATE TABLE IF NOT EXISTS finding_categories (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      group_id INT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_finding_categories_name (name),
      INDEX idx_finding_categories_active_sort (is_active, sort_order, id),
      INDEX idx_finding_categories_group (group_id),
      CONSTRAINT fk_finding_categories_group FOREIGN KEY (group_id) REFERENCES finding_groups(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    ) ENGINE=InnoDB
  `);

  await queryDb(`
    CREATE TABLE IF NOT EXISTS finding_details (
      id INT NOT NULL AUTO_INCREMENT,
      category_id INT NOT NULL,
      description VARCHAR(1000) NOT NULL,
      description_hash CHAR(64) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_finding_detail_hash (category_id, description_hash),
      INDEX idx_finding_details_active_sort (category_id, is_active, sort_order, id),
      CONSTRAINT fk_finding_details_category FOREIGN KEY (category_id) REFERENCES finding_categories(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    ) ENGINE=InnoDB
  `);

  for (let index = 0; index < MASTER_FINDING_GROUPS.length; index++) {
    const name = MASTER_FINDING_GROUPS[index];
    await queryDb(
      `INSERT INTO finding_groups (name, sort_order, is_active)
       VALUES (?, ?, TRUE)
       ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_active = TRUE`,
      [name, index + 1]
    );
  }

  const categoryCountRows = await queryDb('SELECT COUNT(*) AS count FROM finding_categories');
  const categoryCount = Number(categoryCountRows[0]?.count || 0);
  // A previous startup may have been interrupted after inserting only part of the
  // default master data. Repair that specific first-run condition automatically.
  // Once all default category rows exist, later admin deactivations remain untouched
  // because soft-deactivated rows are still counted here.
  if (categoryCount >= DEFAULT_FINDING_CLASSIFICATION_SEED.length) return;

  // If an earlier JSON-based classification build was tested, migrate that data once.
  let seed = DEFAULT_FINDING_CLASSIFICATION_SEED;
  try {
    const legacyColumn = await queryDb(`SHOW COLUMNS FROM app_settings LIKE 'finding_classifications'`);
    if (legacyColumn.length > 0) {
      const legacyRows = await queryDb('SELECT finding_classifications FROM app_settings WHERE id = 1 LIMIT 1');
      const legacy = parseSettingsJson(legacyRows[0]?.finding_classifications, []);
      if (Array.isArray(legacy) && legacy.length > 0) seed = legacy;
    }
  } catch (migrationErr) {
    console.warn('Finding-classification JSON migration skipped:', migrationErr?.message || migrationErr);
  }

  const groupRows = await queryDb('SELECT id, name FROM finding_groups WHERE is_active = TRUE');
  const groupIds = Object.fromEntries(groupRows.map((row) => [String(row.name), Number(row.id)]));

  for (let categoryIndex = 0; categoryIndex < seed.length; categoryIndex++) {
    const rawCategory = seed[categoryIndex] || {};
    const name = String(rawCategory.category || '').trim();
    const groupFinding = String(rawCategory.groupFinding || '').trim();
    if (!name || !groupIds[groupFinding]) continue;

    await queryDb(
      `INSERT INTO finding_categories (name, group_id, sort_order, is_active)
       VALUES (?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE group_id = VALUES(group_id), sort_order = VALUES(sort_order), is_active = TRUE`,
      [name, groupIds[groupFinding], categoryIndex + 1]
    );
    const categoryRows = await queryDb('SELECT id FROM finding_categories WHERE name = ? LIMIT 1', [name]);
    const categoryId = Number(categoryRows[0]?.id || 0);
    if (!categoryId) continue;

    const details = Array.isArray(rawCategory.details) ? rawCategory.details : [];
    for (let detailIndex = 0; detailIndex < details.length; detailIndex++) {
      const description = String(details[detailIndex] || '').trim();
      if (!description) continue;
      await queryDb(
        `INSERT INTO finding_details (category_id, description, description_hash, sort_order, is_active)
         VALUES (?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE description = VALUES(description), sort_order = VALUES(sort_order), is_active = TRUE`,
        [categoryId, description, detailHash(description), detailIndex + 1]
      );
    }
  }

  console.log(`Seeded ${seed.length} finding categories into relational master-data tables.`);
};

const classificationReady = settingsReady.then(() => ensureFindingClassificationSchema()).catch((err) => {
  console.error('Failed to initialize finding classification master data:', err);
  throw err;
});

const getFindingClassificationPayload = async () => {
  await classificationReady;
  const groups = await queryDb(`
    SELECT id, name, sort_order AS sortOrder
    FROM finding_groups
    WHERE is_active = TRUE
    ORDER BY sort_order ASC, id ASC
  `);
  const rows = await queryDb(`
    SELECT
      c.id AS categoryId,
      c.name AS category,
      c.group_id AS groupId,
      c.sort_order AS categorySortOrder,
      g.name AS groupFinding,
      d.id AS detailId,
      d.description AS detailDescription,
      d.sort_order AS detailSortOrder
    FROM finding_categories c
    INNER JOIN finding_groups g ON g.id = c.group_id AND g.is_active = TRUE
    LEFT JOIN finding_details d ON d.category_id = c.id AND d.is_active = TRUE
    WHERE c.is_active = TRUE
    ORDER BY c.sort_order ASC, c.id ASC, d.sort_order ASC, d.id ASC
  `);

  const byCategory = new Map();
  for (const row of rows) {
    const categoryId = Number(row.categoryId);
    if (!byCategory.has(categoryId)) {
      byCategory.set(categoryId, {
        id: categoryId,
        category: String(row.category || ''),
        groupId: Number(row.groupId),
        groupFinding: String(row.groupFinding || ''),
        sortOrder: Number(row.categorySortOrder || 0),
        details: [],
      });
    }
    if (row.detailId) {
      byCategory.get(categoryId).details.push({
        id: Number(row.detailId),
        description: String(row.detailDescription || ''),
        sortOrder: Number(row.detailSortOrder || 0),
      });
    }
  }

  return {
    groups: groups.map((group) => ({
      id: Number(group.id),
      name: String(group.name || ''),
      sortOrder: Number(group.sortOrder || 0),
    })),
    classifications: [...byCategory.values()],
  };
};

app.get('/api/finding-classifications', authenticateUser, async (req, res) => {
  try {
    res.status(200).json(await getFindingClassificationPayload());
  } catch (err) {
    console.error('Failed to fetch finding classifications:', err);
    res.status(500).json({ error: 'Failed to fetch finding classifications' });
  }
});

app.post('/api/finding-classifications/categories', authenticateUser, requireAdmin, async (req, res) => {
  const nameResult = classificationText(req.body?.name, 150);
  const groupFinding = String(req.body?.groupFinding || '').trim();
  if (!nameResult.ok) return res.status(400).json({ error: nameResult.error });

  try {
    await classificationReady;
    const groupRows = await queryDb(
      'SELECT id, name FROM finding_groups WHERE name = ? AND is_active = TRUE LIMIT 1',
      [groupFinding]
    );
    if (groupRows.length === 0) return res.status(400).json({ error: 'Choose a valid Group Finding.' });

    const existingRows = await queryDb('SELECT id, is_active FROM finding_categories WHERE name = ? LIMIT 1', [nameResult.value]);
    let categoryId;
    let reactivated = false;
    if (existingRows.length > 0) {
      if (Boolean(existingRows[0].is_active)) return res.status(409).json({ error: 'This category already exists.' });
      categoryId = Number(existingRows[0].id);
      const maxRows = await queryDb('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM finding_categories WHERE is_active = TRUE');
      await queryDb(
        'UPDATE finding_categories SET group_id = ?, is_active = TRUE, sort_order = ? WHERE id = ?',
        [Number(groupRows[0].id), Number(maxRows[0]?.maxSort || 0) + 1, categoryId]
      );
      reactivated = true;
    } else {
      const maxRows = await queryDb('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM finding_categories WHERE is_active = TRUE');
      const result = await queryDb(
        'INSERT INTO finding_categories (name, group_id, sort_order, is_active) VALUES (?, ?, ?, TRUE)',
        [nameResult.value, Number(groupRows[0].id), Number(maxRows[0]?.maxSort || 0) + 1]
      );
      categoryId = Number(result.insertId);
    }

    await logAuditEvent(req, {
      action: 'FINDING_CATEGORY_CREATED',
      entityType: 'finding_category',
      entityId: String(categoryId),
      description: reactivated ? `Reactivated finding category ${nameResult.value}` : `Created finding category ${nameResult.value}`,
      metadata: { category: nameResult.value, groupFinding, reactivated },
    });
    res.status(reactivated ? 200 : 201).json({ id: categoryId, reactivated });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This category already exists.' });
    console.error('Failed to create finding category:', err);
    res.status(500).json({ error: 'Failed to create finding category' });
  }
});

app.put('/api/finding-classifications/categories/:id', authenticateUser, requireAdmin, async (req, res) => {
  const categoryId = parsePositiveRecordId(req.params.id);
  if (!categoryId) return res.status(400).json({ error: 'Invalid category id.' });
  const nameResult = classificationText(req.body?.name, 150);
  const groupFinding = String(req.body?.groupFinding || '').trim();
  if (!nameResult.ok) return res.status(400).json({ error: nameResult.error });

  try {
    await classificationReady;
    const beforeRows = await queryDb(
      `SELECT c.id, c.name, c.is_active, g.name AS groupFinding
       FROM finding_categories c INNER JOIN finding_groups g ON g.id = c.group_id
       WHERE c.id = ? LIMIT 1`,
      [categoryId]
    );
    if (beforeRows.length === 0 || !Boolean(beforeRows[0].is_active)) return res.status(404).json({ error: 'Finding category not found.' });

    const groupRows = await queryDb('SELECT id FROM finding_groups WHERE name = ? AND is_active = TRUE LIMIT 1', [groupFinding]);
    if (groupRows.length === 0) return res.status(400).json({ error: 'Choose a valid Group Finding.' });

    await queryDb('UPDATE finding_categories SET name = ?, group_id = ? WHERE id = ?', [nameResult.value, Number(groupRows[0].id), categoryId]);
    await logAuditEvent(req, {
      action: 'FINDING_CATEGORY_UPDATED',
      entityType: 'finding_category',
      entityId: String(categoryId),
      description: `Updated finding category ${beforeRows[0].name}`,
      metadata: {
        before: { name: beforeRows[0].name, groupFinding: beforeRows[0].groupFinding },
        after: { name: nameResult.value, groupFinding },
      },
    });
    res.status(200).json({ id: categoryId });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Another category already uses this name.' });
    console.error('Failed to update finding category:', err);
    res.status(500).json({ error: 'Failed to update finding category' });
  }
});

app.delete('/api/finding-classifications/categories/:id', authenticateUser, requireAdmin, async (req, res) => {
  const categoryId = parsePositiveRecordId(req.params.id);
  if (!categoryId) return res.status(400).json({ error: 'Invalid category id.' });

  try {
    await classificationReady;
    const rows = await queryDb('SELECT id, name, is_active FROM finding_categories WHERE id = ? LIMIT 1', [categoryId]);
    if (rows.length === 0 || !Boolean(rows[0].is_active)) return res.status(404).json({ error: 'Finding category not found.' });

    const activeCountRows = await queryDb('SELECT COUNT(*) AS count FROM finding_categories WHERE is_active = TRUE');
    if (Number(activeCountRows[0]?.count || 0) <= 1) {
      return res.status(409).json({ error: 'At least one active finding category must remain.' });
    }

    await queryDb('UPDATE finding_categories SET is_active = FALSE WHERE id = ?', [categoryId]);
    await logAuditEvent(req, {
      action: 'FINDING_CATEGORY_DEACTIVATED',
      entityType: 'finding_category',
      entityId: String(categoryId),
      description: `Removed finding category ${rows[0].name} from future selection`,
      metadata: { category: rows[0].name, softDelete: true },
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to deactivate finding category:', err);
    res.status(500).json({ error: 'Failed to remove finding category' });
  }
});

app.post('/api/finding-classifications/categories/:categoryId/details', authenticateUser, requireAdmin, async (req, res) => {
  const categoryId = parsePositiveRecordId(req.params.categoryId);
  if (!categoryId) return res.status(400).json({ error: 'Invalid category id.' });
  const descriptionResult = classificationText(req.body?.description, 1000);
  if (!descriptionResult.ok) return res.status(400).json({ error: descriptionResult.error });

  try {
    await classificationReady;
    const categoryRows = await queryDb('SELECT id, name FROM finding_categories WHERE id = ? AND is_active = TRUE LIMIT 1', [categoryId]);
    if (categoryRows.length === 0) return res.status(404).json({ error: 'Finding category not found.' });

    const hash = detailHash(descriptionResult.value);
    const existingRows = await queryDb(
      'SELECT id, is_active FROM finding_details WHERE category_id = ? AND description_hash = ? LIMIT 1',
      [categoryId, hash]
    );
    let detailId;
    let reactivated = false;
    if (existingRows.length > 0) {
      if (Boolean(existingRows[0].is_active)) return res.status(409).json({ error: 'This finding detail already exists for the selected category.' });
      detailId = Number(existingRows[0].id);
      const maxRows = await queryDb('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM finding_details WHERE category_id = ? AND is_active = TRUE', [categoryId]);
      await queryDb(
        'UPDATE finding_details SET description = ?, description_hash = ?, is_active = TRUE, sort_order = ? WHERE id = ?',
        [descriptionResult.value, hash, Number(maxRows[0]?.maxSort || 0) + 1, detailId]
      );
      reactivated = true;
    } else {
      const maxRows = await queryDb('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM finding_details WHERE category_id = ? AND is_active = TRUE', [categoryId]);
      const result = await queryDb(
        'INSERT INTO finding_details (category_id, description, description_hash, sort_order, is_active) VALUES (?, ?, ?, ?, TRUE)',
        [categoryId, descriptionResult.value, hash, Number(maxRows[0]?.maxSort || 0) + 1]
      );
      detailId = Number(result.insertId);
    }

    await logAuditEvent(req, {
      action: 'FINDING_DETAIL_CREATED',
      entityType: 'finding_detail',
      entityId: String(detailId),
      description: reactivated ? `Reactivated finding detail under ${categoryRows[0].name}` : `Created finding detail under ${categoryRows[0].name}`,
      metadata: { categoryId, category: categoryRows[0].name, description: descriptionResult.value, reactivated },
    });
    res.status(reactivated ? 200 : 201).json({ id: detailId, reactivated });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This finding detail already exists for the selected category.' });
    console.error('Failed to create finding detail:', err);
    res.status(500).json({ error: 'Failed to create finding detail' });
  }
});

app.put('/api/finding-classifications/details/:id', authenticateUser, requireAdmin, async (req, res) => {
  const detailId = parsePositiveRecordId(req.params.id);
  if (!detailId) return res.status(400).json({ error: 'Invalid finding-detail id.' });
  const descriptionResult = classificationText(req.body?.description, 1000);
  if (!descriptionResult.ok) return res.status(400).json({ error: descriptionResult.error });

  try {
    await classificationReady;
    const beforeRows = await queryDb(
      `SELECT d.id, d.category_id AS categoryId, d.description, d.is_active, c.name AS category
       FROM finding_details d INNER JOIN finding_categories c ON c.id = d.category_id
       WHERE d.id = ? LIMIT 1`,
      [detailId]
    );
    if (beforeRows.length === 0 || !Boolean(beforeRows[0].is_active)) return res.status(404).json({ error: 'Finding detail not found.' });

    await queryDb(
      'UPDATE finding_details SET description = ?, description_hash = ? WHERE id = ?',
      [descriptionResult.value, detailHash(descriptionResult.value), detailId]
    );
    await logAuditEvent(req, {
      action: 'FINDING_DETAIL_UPDATED',
      entityType: 'finding_detail',
      entityId: String(detailId),
      description: `Updated finding detail under ${beforeRows[0].category}`,
      metadata: {
        categoryId: Number(beforeRows[0].categoryId),
        category: beforeRows[0].category,
        before: beforeRows[0].description,
        after: descriptionResult.value,
      },
    });
    res.status(200).json({ id: detailId });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This finding detail already exists for the selected category.' });
    console.error('Failed to update finding detail:', err);
    res.status(500).json({ error: 'Failed to update finding detail' });
  }
});

app.delete('/api/finding-classifications/details/:id', authenticateUser, requireAdmin, async (req, res) => {
  const detailId = parsePositiveRecordId(req.params.id);
  if (!detailId) return res.status(400).json({ error: 'Invalid finding-detail id.' });

  try {
    await classificationReady;
    const rows = await queryDb(
      `SELECT d.id, d.description, d.is_active, c.id AS categoryId, c.name AS category
       FROM finding_details d INNER JOIN finding_categories c ON c.id = d.category_id
       WHERE d.id = ? LIMIT 1`,
      [detailId]
    );
    if (rows.length === 0 || !Boolean(rows[0].is_active)) return res.status(404).json({ error: 'Finding detail not found.' });

    await queryDb('UPDATE finding_details SET is_active = FALSE WHERE id = ?', [detailId]);
    await logAuditEvent(req, {
      action: 'FINDING_DETAIL_DEACTIVATED',
      entityType: 'finding_detail',
      entityId: String(detailId),
      description: `Removed finding detail from ${rows[0].category} future selection`,
      metadata: {
        categoryId: Number(rows[0].categoryId),
        category: rows[0].category,
        description: rows[0].description,
        softDelete: true,
      },
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to deactivate finding detail:', err);
    res.status(500).json({ error: 'Failed to remove finding detail' });
  }
});

// Configure evidence image uploads with explicit type/size restrictions.
const evidenceMimeExtensions = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const extension = evidenceMimeExtensions.get(String(file.mimetype || '').toLowerCase()) || '.img';
    cb(null, `${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxEvidenceImageBytes,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!evidenceMimeExtensions.has(String(file.mimetype || '').toLowerCase())) {
      return cb(new Error('Evidence photo must be a JPG, PNG or WEBP image.'));
    }
    cb(null, true);
  },
});

const removeUploadedFileQuietly = (file) => {
  if (!file?.path) return;
  fs.unlink(file.path, () => {});
};

const uploadEvidencePicture = (req, res, next) => {
  upload.single('picture')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Evidence photo must be ${Math.max(1, Number(MAX_EVIDENCE_IMAGE_MB) || 5)} MB or smaller.` });
      }
      return res.status(400).json({ error: err.message || 'Invalid evidence photo.' });
    }

    if (!req.file?.path) return next();
    fs.open(req.file.path, 'r', (openErr, fd) => {
      if (openErr) {
        removeUploadedFileQuietly(req.file);
        return res.status(400).json({ error: 'The evidence image could not be verified.' });
      }
      const header = Buffer.alloc(16);
      fs.read(fd, header, 0, header.length, 0, (readErr, bytesRead) => {
        fs.close(fd, () => {});
        if (readErr) {
          removeUploadedFileQuietly(req.file);
          return res.status(400).json({ error: 'The evidence image could not be verified.' });
        }
        const detectedMime = detectEvidenceImageMime(header.subarray(0, bytesRead));
        if (!detectedMime || detectedMime !== String(req.file.mimetype || '').toLowerCase()) {
          removeUploadedFileQuietly(req.file);
          return res.status(400).json({ error: 'Evidence photo content does not match a supported JPG, PNG or WEBP image.' });
        }
        return next();
      });
    });
  });
};

// Production hardening: the old /api/reset-database endpoint has been removed.
// Database resets must be performed through an intentional administrative
// maintenance process outside the running application.

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

// Import-only duplicate guard. Finding No is treated as the strongest identity
// when present. Legacy workbooks without No fall back to stable observation fields.
// We intentionally do not compare mutable lifecycle fields such as status/remark,
// so re-importing an updated copy of an existing finding does not create a clone.
const findExistingImportRecord = async (finding) => {
  if (finding.no !== null && finding.no !== undefined) {
    const byNumber = await queryDb(
      `SELECT id, deleted_at AS deletedAt
       FROM audit_records
       WHERE no = ?
       ORDER BY id ASC
       LIMIT 1`,
      [finding.no]
    );
    if (byNumber.length > 0) return byNumber[0];
  }

  const rows = await queryDb(
    `SELECT id, deleted_at AS deletedAt
     FROM audit_records
     WHERE audit_date = ?
       AND COALESCE(shift, '') = ?
       AND COALESCE(auditor_name, '') = ?
       AND COALESCE(pic_finding, '') = ?
       AND COALESCE(department, '') = ?
       AND COALESCE(platform, '') = ?
       AND COALESCE(area_station, '') = ?
       AND COALESCE(group_finding, '') = ?
       AND COALESCE(category, '') = ?
       AND COALESCE(finding_details, '') = ?
       AND COALESCE(NULLIF(icar_num, ''), 'N/A') = ?
     ORDER BY id ASC
     LIMIT 1`,
    [
      finding.auditDate,
      finding.shift || '',
      finding.auditors || '',
      finding.personOnJob || '',
      finding.department || '',
      finding.platform || '',
      finding.areaStation || '',
      finding.groupFinding || '',
      finding.category || '',
      finding.detailsFindings || '',
      finding.icarNum || 'N/A',
    ]
  );
  return rows[0] || null;
};

// API: Add a New Record (CREATE)
app.post('/api/records', authenticateUser, uploadEvidencePicture, async (req, res) => {
  const validation = validateFindingPayload(req.body);
  if (!validation.ok) {
    removeUploadedFileQuietly(req.file);
    return res.status(400).json({
      error: 'Please correct the invalid finding fields.',
      fields: validation.errors,
    });
  }

  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, status, icarNum, mqeEngineer
  } = validation.value;

  const picture = req.file ? `/uploads/${req.file.filename}` : (validation.value.picture || null);
  const normalizedIcar = normalizeIcarInput(icarNum);
  const source = String(req.headers['x-audit-source'] || '').trim().toLowerCase();

  try {
    await auditTrailReady;

    if (source === 'excel-import') {
      const duplicate = await findExistingImportRecord({
        ...validation.value,
        icarNum: normalizedIcar.icarNum,
      });
      if (duplicate) {
        removeUploadedFileQuietly(req.file);
        return res.status(409).json({
          error: duplicate.deletedAt
            ? 'This finding already exists in the recycle bin. Restore it instead of importing another copy.'
            : 'This finding already exists and was skipped to prevent a duplicate import.',
          code: 'DUPLICATE_IMPORT',
          duplicate: true,
          existingId: Number(duplicate.id),
          inRecycleBin: Boolean(duplicate.deletedAt),
        });
      }
    }

    const result = await queryDb(
      `INSERT INTO audit_records (
        no, audit_date, ww, shift, auditor_name, pic_finding, department,
        platform, area_station, group_finding, category, finding_details,
        picture, remark, status, icar_status, icar_num, mqe_engineer,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        no, auditDate, ww, shift, auditors, personOnJob, department,
        platform, areaStation, groupFinding, category, detailsFindings,
        picture, remark, status || 'Open', normalizedIcar.icarStatus, normalizedIcar.icarNum, mqeEngineer,
        req.user.id,
      ]
    );

    const created = await selectRecordById(result.insertId);
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
    // Avoid leaving an orphan upload if the database insert fails.
    removeUploadedFileQuietly(req.file);
    console.error('Database insertion error:', err);
    res.status(500).json({ error: 'Database insertion failed' });
  }
});

// API: Update an Existing Record (UPDATE)
app.put('/api/records/:id', authenticateUser, uploadEvidencePicture, async (req, res) => {
  const id = parsePositiveRecordId(req.params.id);
  if (!id) {
    removeUploadedFileQuietly(req.file);
    return res.status(400).json({ error: 'Invalid record id' });
  }

  const validation = validateFindingPayload(req.body);
  if (!validation.ok) {
    removeUploadedFileQuietly(req.file);
    return res.status(400).json({
      error: 'Please correct the invalid finding fields.',
      fields: validation.errors,
    });
  }

  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, status, icarNum, mqeEngineer
  } = validation.value;

  const picture = req.file ? `/uploads/${req.file.filename}` : validation.value.picture;
  const normalizedIcar = normalizeIcarInput(icarNum);

  try {
    await auditTrailReady;
    const before = await selectRecordById(id);
    if (!before) {
      removeUploadedFileQuietly(req.file);
      return res.status(404).json({ error: 'Record not found' });
    }
    if (before.deletedAt) {
      removeUploadedFileQuietly(req.file);
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
        picture, remark, status || 'Open', normalizedIcar.icarStatus, normalizedIcar.icarNum, mqeEngineer,
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
      description: `${action === 'FINDING_MQE_RECALCULATED' ? 'Synced MQE ownership for' : 'Updated'} Finding ${formatRecordNumber(updated, id)}`,
      metadata: {
        changedFields,
        status: updated?.status || '',
        icarStatus: updated?.icarStatus || '',
      },
    });

    res.status(200).json(updated);
  } catch (err) {
    // A newly uploaded replacement should not remain on disk if the update fails.
    removeUploadedFileQuietly(req.file);
    console.error('Database update error:', err);
    res.status(500).json({ error: 'Database update failed' });
  }
});

// API: Delete a Record (SOFT DELETE / RECYCLE BIN)
app.delete('/api/records/:id', authenticateUser, async (req, res) => {
  const id = parsePositiveRecordId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid record id' });
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
