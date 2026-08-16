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
import nodemailer from 'nodemailer';

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
  ADMIN_EMAIL,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.6-flash',
  APP_BASE_URL = '',
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_SECURE = 'false',
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM_NAME = 'IPQC Tracker',
  SMTP_FROM_EMAIL,
  INVITE_EXPIRY_HOURS = '48',
  RESET_EXPIRY_MINUTES = '60'
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

const isProduction = process.env.NODE_ENV === 'production';
const smtpPort = Number(SMTP_PORT) || 587;
const smtpSecure = String(SMTP_SECURE).toLowerCase() === 'true' || smtpPort === 465;
const smtpFromEmail = String(SMTP_FROM_EMAIL || SMTP_USER || '').trim();
const emailConfigured = Boolean(SMTP_HOST && smtpFromEmail);

const mailTransporter = emailConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: smtpPort,
      secure: smtpSecure,
      ...(SMTP_USER
        ? { auth: { user: SMTP_USER, pass: SMTP_PASS || '' } }
        : {}),
    })
  : null;

if (!emailConfigured) {
  console.warn(
    isProduction
      ? 'WARNING: SMTP email is not configured. User invitations and password-reset emails will be unavailable.'
      : 'INFO: SMTP email is not configured. Development invite/reset links will be printed to the server console.'
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

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidUsername = (value) => /^[A-Za-z0-9._-]{3,100}$/.test(String(value || '').trim());

const toPublicUser = (row) => {
  const hasPassword = row?.has_password !== undefined
    ? Boolean(row.has_password)
    : Boolean(row?.password_hash);
  const isActive = Boolean(row?.is_active);
  const accountStatus = !isActive ? 'inactive' : (hasPassword ? 'active' : 'pending');

  return {
    id: Number(row.id),
    username: String(row.username),
    email: row.email || '',
    fullName: String(row.full_name || row.username),
    role: row.role === 'admin' ? 'admin' : 'user',
    jobTitle: row.job_title || '',
    department: row.department || '',
    isActive,
    hasPassword,
    accountStatus,
    lastLoginAt: row.last_login_at || null,
    invitedAt: row.invited_at || null,
    activatedAt: row.activated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

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
      email VARCHAR(190) NULL,
      password_hash VARCHAR(255) NULL,
      full_name VARCHAR(150) NOT NULL,
      role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
      job_title VARCHAR(100) NULL,
      department VARCHAR(100) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      session_version INT NOT NULL DEFAULT 0,
      invited_at DATETIME NULL,
      activated_at DATETIME NULL,
      last_login_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email),
      INDEX idx_users_role (role),
      INDEX idx_users_active (is_active)
    )
  `);

  // Non-destructive migration from the previous users-table version.
  await ensureUsersColumn('email', 'email VARCHAR(190) NULL');
  await ensureUsersColumn('session_version', 'session_version INT NOT NULL DEFAULT 0');
  await ensureUsersColumn('invited_at', 'invited_at DATETIME NULL');
  await ensureUsersColumn('activated_at', 'activated_at DATETIME NULL');

  // Invitations need a NULL password until the employee chooses their own.
  await queryDb('ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL');

  const indexes = await queryDb('SHOW INDEX FROM users');
  if (!indexes.some((row) => row.Key_name === 'uq_users_email')) {
    await queryDb('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
  }

  // Migration bridge: seed the existing env-based admin into MySQL once.
  if (ADMIN_USERNAME && ADMIN_PASSWORD_HASH) {
    const existing = await queryDb(
      'SELECT id, email FROM users WHERE username = ? LIMIT 1',
      [ADMIN_USERNAME]
    );

    if (existing.length === 0) {
      await queryDb(
        `INSERT INTO users
          (username, email, password_hash, full_name, role, job_title, department,
           is_active, session_version, activated_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?, TRUE, 0, NOW())`,
        [
          ADMIN_USERNAME,
          ADMIN_EMAIL && isValidEmail(ADMIN_EMAIL) ? ADMIN_EMAIL.trim().toLowerCase() : null,
          ADMIN_PASSWORD_HASH,
          'System Administrator',
          'Quality Administrator',
          'Quality Team'
        ]
      );
      console.log('Bootstrap administrator migrated into the users table.');
    } else if (!existing[0].email && ADMIN_EMAIL && isValidEmail(ADMIN_EMAIL)) {
      try {
        await queryDb('UPDATE users SET email = ? WHERE id = ?', [ADMIN_EMAIL.trim().toLowerCase(), existing[0].id]);
      } catch (err) {
        console.warn('Could not attach ADMIN_EMAIL to the existing bootstrap administrator:', err?.message || err);
      }
    }
  }
};

const ensureAccountTokensTable = async () => {
  await queryDb(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      id BIGINT NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      purpose ENUM('invite', 'password_reset') NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_account_tokens_hash (token_hash),
      INDEX idx_account_tokens_user (user_id, purpose),
      INDEX idx_account_tokens_expiry (expires_at)
    )
  `);
};

const usersReady = (async () => {
  await ensureUsersTable();
  await ensureAccountTokensTable();
})().catch((err) => {
  console.error('Failed to initialize authentication tables:', err);
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
  const tableRows = await queryDb(`SHOW TABLES LIKE 'audit_records'`);
  if (tableRows.length > 0) {
    await ensureAuditRecordColumn('created_by', 'created_by INT NULL');
    await ensureAuditRecordColumn('updated_by', 'updated_by INT NULL');
    await ensureAuditRecordColumn('created_at', 'created_at DATETIME NULL');
    await ensureAuditRecordColumn('updated_at', 'updated_at DATETIME NULL');
  } else {
    console.warn('audit_records table was not found; traceability columns will be added after the table exists.');
  }

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
  actorOverride = null,
}) => {
  try {
    await auditTrailReady;
    const actor = actorOverride || req.user || {};
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
      creator.full_name AS createdByName, creator.username AS createdByUsername,
      editor.full_name AS updatedByName, editor.username AS updatedByUsername
    FROM audit_records ar
    LEFT JOIN users creator ON creator.id = ar.created_by
    LEFT JOIN users editor ON editor.id = ar.updated_by
    WHERE ar.id = ?
    LIMIT 1
  `, [id]);
  return rows[0] || null;
};

// ==========================================
// Invitation / Password Reset Email Helpers
// ==========================================
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const getAppBaseUrl = (req) => {
  const configured = String(APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const origin = String(req.headers.origin || '').trim().replace(/\/+$/, '');
  if (origin) return origin;
  return `${req.protocol}://${req.get('host')}`;
};

const buildOneTimeUrl = (req, key, rawToken) =>
  `${getAppBaseUrl(req)}/?${key}=${encodeURIComponent(rawToken)}`;

const tokenHash = (rawToken) =>
  crypto.createHash('sha256').update(String(rawToken)).digest('hex');

const createOneTimeToken = async ({ userId, purpose, createdBy = null }) => {
  await queryDb(
    `UPDATE account_tokens SET used_at = NOW()
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    [userId, purpose]
  );

  const rawToken = crypto.randomBytes(32).toString('hex');
  const ttlMs = purpose === 'invite'
    ? Math.max(1, Number(INVITE_EXPIRY_HOURS) || 48) * 60 * 60 * 1000
    : Math.max(5, Number(RESET_EXPIRY_MINUTES) || 60) * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await queryDb(
    `INSERT INTO account_tokens
      (user_id, purpose, token_hash, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, purpose, tokenHash(rawToken), expiresAt, createdBy]
  );

  return { rawToken, expiresAt };
};

const findValidOneTimeToken = async (rawToken, purpose) => {
  if (!rawToken || String(rawToken).length < 20) return null;
  const rows = await queryDb(`
    SELECT
      t.id AS token_id, t.user_id, t.purpose, t.expires_at,
      u.id, u.username, u.email, u.password_hash, u.full_name, u.role,
      u.job_title, u.department, u.is_active, u.session_version,
      u.invited_at, u.activated_at, u.last_login_at, u.created_at, u.updated_at
    FROM account_tokens t
    INNER JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
      AND t.purpose = ?
      AND t.used_at IS NULL
      AND t.expires_at > NOW()
    LIMIT 1
  `, [tokenHash(rawToken), purpose]);
  return rows[0] || null;
};

const consumeToken = async (tokenId, userId, purpose) => {
  await queryDb('UPDATE account_tokens SET used_at = NOW() WHERE id = ?', [tokenId]);
  await queryDb(
    `UPDATE account_tokens SET used_at = NOW()
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    [userId, purpose]
  );
};

const sendSystemEmail = async ({ to, subject, text, html, previewUrl }) => {
  if (!mailTransporter) {
    if (isProduction) {
      const err = new Error('Email delivery is not configured on the server.');
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }
    console.log(`\n[IPQC EMAIL PREVIEW]\nTO: ${to}\nSUBJECT: ${subject}\nLINK: ${previewUrl}\n`);
    return { sent: false, mode: 'console' };
  }

  await mailTransporter.sendMail({
    from: `"${String(SMTP_FROM_NAME).replaceAll('"', '')}" <${smtpFromEmail}>`,
    to,
    subject,
    text,
    html,
  });
  return { sent: true, mode: 'smtp' };
};

const sendInvitationEmail = async (req, user, rawToken) => {
  const inviteUrl = buildOneTimeUrl(req, 'invite', rawToken);
  const hours = Math.max(1, Number(INVITE_EXPIRY_HOURS) || 48);
  const name = escapeHtml(user.fullName || user.username);
  const safeUrl = escapeHtml(inviteUrl);

  const delivery = await sendSystemEmail({
    to: user.email,
    subject: 'Set up your IPQC Tracker account',
    previewUrl: inviteUrl,
    text: `Hello ${user.fullName},\n\nYou have been invited to IPQC Tracker. Set your password using this link:\n${inviteUrl}\n\nThis link expires in ${hours} hours.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#0f172a;line-height:1.6">
        <h2 style="margin-bottom:8px">IPQC Tracker account invitation</h2>
        <p>Hello ${name},</p>
        <p>An administrator has created your IPQC Tracker access. Use the button below to create your own password.</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#F15D22;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Set up account</a></p>
        <p style="font-size:13px;color:#64748b">This secure link expires in ${hours} hours. If you were not expecting this invitation, contact your IPQC administrator.</p>
      </div>`,
  });

  return { ...delivery, previewUrl: delivery.mode === 'console' ? inviteUrl : undefined };
};

const sendPasswordResetEmail = async (req, user, rawToken) => {
  const resetUrl = buildOneTimeUrl(req, 'reset', rawToken);
  const minutes = Math.max(5, Number(RESET_EXPIRY_MINUTES) || 60);
  const name = escapeHtml(user.fullName || user.username);
  const safeUrl = escapeHtml(resetUrl);

  const delivery = await sendSystemEmail({
    to: user.email,
    subject: 'Reset your IPQC Tracker password',
    previewUrl: resetUrl,
    text: `Hello ${user.fullName},\n\nA password reset was requested for your IPQC Tracker account. Set a new password using this link:\n${resetUrl}\n\nThis link expires in ${minutes} minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#0f172a;line-height:1.6">
        <h2 style="margin-bottom:8px">Reset your IPQC Tracker password</h2>
        <p>Hello ${name},</p>
        <p>Use the button below to set a new password for your account.</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Reset password</a></p>
        <p style="font-size:13px;color:#64748b">This secure link expires in ${minutes} minutes. If you did not request a reset, you can ignore this email.</p>
      </div>`,
  });

  return { ...delivery, previewUrl: delivery.mode === 'console' ? resetUrl : undefined };
};

// Small in-memory rate limiter for authentication endpoints. In a horizontally
// scaled deployment, move this to Redis or another shared store.
const authRateBuckets = new Map();
const allowAuthAttempt = (key, maxAttempts, windowMs) => {
  const now = Date.now();
  const current = authRateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    authRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= maxAttempts) return false;
  current.count += 1;
  return true;
};

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
};

// Authenticates either a normal user or an administrator. The account is
// re-checked on every protected request so deactivation takes effect immediately.
const authenticateUser = async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server authentication is not configured.' });
  }

  try {
    await usersReady;
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = Number(decoded.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid or expired session, please sign in again' });
    }

    const rows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              session_version, invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    const user = rows[0];
    if (!user || !user.is_active || !user.has_password) {
      return res.status(401).json({ error: 'Account is inactive or no longer available' });
    }

    if (Number(decoded.sessionVersion || 0) !== Number(user.session_version || 0)) {
      return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    }

    req.user = toPublicUser(user);
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

// Shared login: users may enter either company email or username.
app.post('/api/login', async (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/username and password are required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server authentication is not configured. Contact the administrator.' });
  }

  const rateKey = `login:${getRequestIp(req)}:${identifier.toLowerCase()}`;
  if (!allowAuthAttempt(rateKey, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
  }

  try {
    await usersReady;
    const rows = await queryDb(
      `SELECT id, username, email, password_hash, full_name, role, job_title, department,
              is_active, session_version, invited_at, activated_at, last_login_at, created_at, updated_at
       FROM users
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [identifier, identifier.toLowerCase()]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account is inactive. Contact your IPQC administrator.' });
    }
    if (!user.password_hash) {
      return res.status(403).json({ error: 'Account setup is incomplete. Use your invitation email to create your password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    await queryDb('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const token = jwt.sign(
      {
        userId: Number(user.id),
        username: user.username,
        role: user.role,
        sessionVersion: Number(user.session_version || 0),
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const refreshed = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );

    return res.status(200).json({
      token,
      expiresIn: '8h',
      user: toPublicUser(refreshed[0] || user),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/verify', authenticateUser, (req, res) => {
  res.status(200).json({ valid: true, user: req.user });
});

// ==========================================
// Public account setup / password recovery
// ==========================================
app.get('/api/auth/invite/validate', async (req, res) => {
  try {
    await usersReady;
    const row = await findValidOneTimeToken(String(req.query.token || ''), 'invite');
    if (!row || !row.is_active || row.password_hash) {
      return res.status(400).json({ error: 'This invitation link is invalid, expired or already used.' });
    }
    res.status(200).json({
      valid: true,
      account: {
        fullName: row.full_name,
        email: row.email,
        username: row.username,
        role: row.role === 'admin' ? 'admin' : 'user',
      },
      expiresAt: row.expires_at,
    });
  } catch (err) {
    console.error('Validate invitation error:', err);
    res.status(500).json({ error: 'Could not validate this invitation.' });
  }
});

app.post('/api/auth/invite/accept', async (req, res) => {
  const rawToken = String(req.body?.token || '');
  const password = String(req.body?.password || '');

  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  }

  const rateKey = `invite-accept:${getRequestIp(req)}`;
  if (!allowAuthAttempt(rateKey, 15, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
  }

  try {
    await usersReady;
    const row = await findValidOneTimeToken(rawToken, 'invite');
    if (!row || !row.is_active || row.password_hash) {
      return res.status(400).json({ error: 'This invitation link is invalid, expired or already used.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await queryDb(
      `UPDATE users
       SET password_hash = ?, activated_at = NOW(), session_version = session_version + 1
       WHERE id = ?`,
      [passwordHash, row.id]
    );
    await consumeToken(row.token_id, row.id, 'invite');

    const activatedRows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [row.id]
    );
    const activatedUser = toPublicUser(activatedRows[0]);

    await logAuditEvent(req, {
      action: 'USER_INVITE_ACCEPTED',
      entityType: 'user',
      entityId: activatedUser.id,
      description: `${activatedUser.fullName} completed account setup`,
      actorOverride: activatedUser,
    });

    res.status(200).json({ message: 'Account setup complete. You can now sign in.' });
  } catch (err) {
    console.error('Accept invitation error:', err);
    res.status(500).json({ error: 'Could not complete account setup.' });
  }
});

app.post('/api/password-reset/request', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'Enter your email or username.' });
  }

  const rateKey = `reset-request:${getRequestIp(req)}`;
  if (!allowAuthAttempt(rateKey, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many reset requests. Please wait a few minutes and try again.' });
  }

  const generic = 'If an active account with an email address matches, a password-reset link has been sent.';

  try {
    await usersReady;
    const rows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              password_hash, session_version
       FROM users
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [identifier, identifier.toLowerCase()]
    );
    const user = rows[0];

    if (!user || !user.is_active || !user.password_hash || !user.email) {
      return res.status(200).json({ message: generic });
    }

    const { rawToken } = await createOneTimeToken({
      userId: user.id,
      purpose: 'password_reset',
      createdBy: null,
    });

    let delivery;
    try {
      delivery = await sendPasswordResetEmail(req, toPublicUser(user), rawToken);
    } catch (emailErr) {
      console.error('Password-reset email delivery failed:', emailErr);
      if (emailErr?.code === 'EMAIL_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Password recovery email is not configured. Contact your IPQC administrator.' });
      }
      return res.status(200).json({ message: generic });
    }

    res.status(200).json({
      message: generic,
      ...(delivery.previewUrl ? { previewUrl: delivery.previewUrl } : {}),
    });
  } catch (err) {
    console.error('Password reset request error:', err);
    res.status(200).json({ message: generic });
  }
});

app.get('/api/password-reset/validate', async (req, res) => {
  try {
    await usersReady;
    const row = await findValidOneTimeToken(String(req.query.token || ''), 'password_reset');
    if (!row || !row.is_active || !row.password_hash) {
      return res.status(400).json({ error: 'This password-reset link is invalid, expired or already used.' });
    }
    res.status(200).json({
      valid: true,
      account: { fullName: row.full_name, email: row.email, username: row.username },
      expiresAt: row.expires_at,
    });
  } catch (err) {
    console.error('Validate password-reset error:', err);
    res.status(500).json({ error: 'Could not validate this password-reset link.' });
  }
});

app.post('/api/password-reset/confirm', async (req, res) => {
  const rawToken = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  }

  try {
    await usersReady;
    const row = await findValidOneTimeToken(rawToken, 'password_reset');
    if (!row || !row.is_active || !row.password_hash) {
      return res.status(400).json({ error: 'This password-reset link is invalid, expired or already used.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await queryDb(
      `UPDATE users
       SET password_hash = ?, session_version = session_version + 1
       WHERE id = ?`,
      [passwordHash, row.id]
    );
    await consumeToken(row.token_id, row.id, 'password_reset');

    const userRows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [row.id]
    );
    const user = toPublicUser(userRows[0]);
    await logAuditEvent(req, {
      action: 'USER_PASSWORD_CHANGED',
      entityType: 'user',
      entityId: user.id,
      description: `${user.fullName} reset their account password`,
      actorOverride: user,
    });

    res.status(200).json({ message: 'Password updated. Existing sessions have been signed out.' });
  } catch (err) {
    console.error('Confirm password-reset error:', err);
    res.status(500).json({ error: 'Could not reset this password.' });
  }
});

// ==========================================
// User Management (admin only)
// ==========================================
app.get('/api/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    await usersReady;
    const rows = await queryDb(`
      SELECT id, username, email, full_name, role, job_title, department, is_active,
             invited_at, activated_at, last_login_at, created_at, updated_at,
             (password_hash IS NOT NULL) AS has_password
      FROM users
      ORDER BY is_active DESC, role DESC, full_name ASC, username ASC
    `);
    res.status(200).json(rows.map(toPublicUser));
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

const createUniqueUsername = async (email, preferred = '') => {
  const preferredValue = String(preferred || '').trim();
  if (preferredValue) {
    if (!isValidUsername(preferredValue)) {
      const err = new Error('Username must be 3-100 characters using letters, numbers, dot, underscore or hyphen');
      err.code = 'INVALID_USERNAME';
      throw err;
    }
    const taken = await queryDb('SELECT id FROM users WHERE username = ? LIMIT 1', [preferredValue]);
    if (taken.length > 0) {
      const err = new Error('That username is already in use');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
    return preferredValue;
  }

  let base = String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '');
  if (base.length < 3) base = `user.${base || 'ipqc'}`;
  base = base.slice(0, 90);
  let candidate = base;
  let suffix = 1;
  while (true) {
    const rows = await queryDb('SELECT id FROM users WHERE username = ? LIMIT 1', [candidate]);
    if (rows.length === 0) return candidate;
    suffix += 1;
    candidate = `${base.slice(0, 90 - String(suffix).length)}${suffix}`;
  }
};

app.post('/api/users/invite', authenticateUser, requireAdmin, async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const preferredUsername = String(req.body?.username || '').trim();
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const jobTitle = String(req.body?.jobTitle || '').trim() || null;
  const department = String(req.body?.department || '').trim() || null;

  if (!fullName || !email) {
    return res.status(400).json({ error: 'Full name and company email are required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (isProduction && !emailConfigured) {
    return res.status(503).json({ error: 'Email delivery is not configured. Configure SMTP before inviting users.' });
  }

  try {
    await usersReady;
    const emailTaken = await queryDb('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (emailTaken.length > 0) {
      return res.status(409).json({ error: 'An account already uses that email address' });
    }

    const username = await createUniqueUsername(email, preferredUsername);
    const result = await queryDb(
      `INSERT INTO users
        (username, email, password_hash, full_name, role, job_title, department,
         is_active, session_version, invited_at, activated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, TRUE, 0, NOW(), NULL)`,
      [username, email, fullName, role, jobTitle, department]
    );

    const rows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [result.insertId]
    );
    const createdUser = toPublicUser(rows[0]);

    const { rawToken } = await createOneTimeToken({
      userId: createdUser.id,
      purpose: 'invite',
      createdBy: req.user.id,
    });

    let delivery = { sent: false, mode: 'failed' };
    try {
      delivery = await sendInvitationEmail(req, createdUser, rawToken);
    } catch (emailErr) {
      console.error('Invitation email delivery failed:', emailErr);
    }

    await logAuditEvent(req, {
      action: 'USER_INVITED',
      entityType: 'user',
      entityId: createdUser.id,
      description: `Invited ${createdUser.fullName} as ${createdUser.role}`,
      metadata: {
        email: createdUser.email,
        username: createdUser.username,
        role: createdUser.role,
        jobTitle: createdUser.jobTitle,
        department: createdUser.department,
        deliveryMode: delivery.mode,
      },
    });

    res.status(201).json({
      user: createdUser,
      delivery: {
        sent: Boolean(delivery.sent),
        mode: delivery.mode,
        ...(delivery.previewUrl ? { previewUrl: delivery.previewUrl } : {}),
      },
      message: delivery.sent
        ? `Invitation sent to ${createdUser.email}`
        : delivery.previewUrl
          ? 'Development invitation created. Use the preview link below.'
          : 'Account created as Pending, but the invitation email could not be delivered. Fix email delivery and resend the invitation.',
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.code === 'USERNAME_TAKEN') {
      return res.status(409).json({ error: err.message || 'That username or email is already in use' });
    }
    if (err?.code === 'INVALID_USERNAME') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Invite user error:', err);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

const activeAdminCount = async () => {
  const rows = await queryDb(`
    SELECT COUNT(*) AS total
    FROM users
    WHERE role = 'admin' AND is_active = TRUE AND password_hash IS NOT NULL
  `);
  return Number(rows[0]?.total || 0);
};

app.put('/api/users/:id', authenticateUser, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const username = String(req.body?.username || '').trim();
  const fullName = String(req.body?.fullName || '').trim();
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const jobTitle = String(req.body?.jobTitle || '').trim() || null;
  const department = String(req.body?.department || '').trim() || null;
  const isActive = req.body?.isActive !== false;

  if (!username || !fullName) {
    return res.status(400).json({ error: 'Full name and username are required' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-100 characters using letters, numbers, dot, underscore or hyphen' });
  }

  try {
    const currentRows = await queryDb(
      `SELECT id, username, email, password_hash, full_name, role, job_title,
              department, is_active, session_version
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    if (currentRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const target = currentRows[0];
    const email = String(req.body?.email ?? target.email ?? '').trim().toLowerCase() || null;
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    if (targetId === Number(req.user.id) && (!isActive || role !== 'admin')) {
      return res.status(400).json({ error: 'You cannot deactivate or remove administrator access from your own account' });
    }

    const removesActiveAdmin = target.role === 'admin' && Boolean(target.is_active) && Boolean(target.password_hash) && (role !== 'admin' || !isActive);
    if (removesActiveAdmin && await activeAdminCount() <= 1) {
      return res.status(400).json({ error: 'At least one active administrator account must remain' });
    }

    await queryDb(
      `UPDATE users
       SET username = ?, email = ?, full_name = ?, role = ?, job_title = ?, department = ?, is_active = ?
       WHERE id = ?`,
      [username, email, fullName, role, jobTitle, department, isActive ? 1 : 0, targetId]
    );

    // Revoke outstanding setup/reset links when access is disabled or the
    // destination email changes. A reactivated pending account must receive a
    // fresh invitation from the admin.
    if (!isActive || (target.email || '') !== (email || '')) {
      await queryDb(
        'UPDATE account_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
        [targetId]
      );
    }

    const rows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    const updatedUser = toPublicUser(rows[0]);
    const changes = {
      role: target.role !== updatedUser.role ? { from: target.role, to: updatedUser.role } : undefined,
      active: Boolean(target.is_active) !== updatedUser.isActive ? { from: Boolean(target.is_active), to: updatedUser.isActive } : undefined,
      username: target.username !== updatedUser.username ? { from: target.username, to: updatedUser.username } : undefined,
      email: (target.email || '') !== (updatedUser.email || '') ? { from: target.email || '', to: updatedUser.email || '' } : undefined,
      fullName: target.full_name !== updatedUser.fullName ? { from: target.full_name, to: updatedUser.fullName } : undefined,
      jobTitle: (target.job_title || '') !== (updatedUser.jobTitle || '') ? { from: target.job_title || '', to: updatedUser.jobTitle || '' } : undefined,
      department: (target.department || '') !== (updatedUser.department || '') ? { from: target.department || '', to: updatedUser.department || '' } : undefined,
    };
    const cleanChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    let action = 'USER_UPDATED';
    if (cleanChanges.active) action = updatedUser.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
    else if (cleanChanges.role) action = 'USER_ROLE_CHANGED';

    await logAuditEvent(req, {
      action,
      entityType: 'user',
      entityId: updatedUser.id,
      description: `${action === 'USER_DEACTIVATED' ? 'Deactivated' : action === 'USER_ACTIVATED' ? 'Activated' : action === 'USER_ROLE_CHANGED' ? 'Changed role for' : 'Updated'} user ${updatedUser.fullName}`,
      metadata: cleanChanges,
    });
    res.status(200).json(updatedUser);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That username or email is already in use' });
    }
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.post('/api/users/:id/resend-invite', authenticateUser, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (isProduction && !emailConfigured) {
    return res.status(503).json({ error: 'Email delivery is not configured. Configure SMTP before sending invitations.' });
  }

  try {
    const rows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = toPublicUser(rows[0]);
    if (!user.isActive) return res.status(400).json({ error: 'Reactivate this account before resending an invitation.' });
    if (user.hasPassword) return res.status(400).json({ error: 'This account is already set up. Send a password-reset link instead.' });
    if (!user.email) return res.status(400).json({ error: 'This account does not have an email address.' });

    const { rawToken } = await createOneTimeToken({ userId: user.id, purpose: 'invite', createdBy: req.user.id });
    const delivery = await sendInvitationEmail(req, user, rawToken);
    await queryDb('UPDATE users SET invited_at = NOW() WHERE id = ?', [user.id]);

    await logAuditEvent(req, {
      action: 'USER_INVITE_RESENT',
      entityType: 'user',
      entityId: user.id,
      description: `Resent account invitation to ${user.fullName}`,
      metadata: { email: user.email, deliveryMode: delivery.mode },
    });

    res.status(200).json({
      message: delivery.sent ? `Invitation resent to ${user.email}` : 'Development invitation refreshed.',
      delivery,
    });
  } catch (err) {
    console.error('Resend invitation error:', err);
    res.status(err?.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500).json({ error: err.message || 'Failed to resend invitation' });
  }
});

app.post('/api/users/:id/send-password-reset', authenticateUser, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (isProduction && !emailConfigured) {
    return res.status(503).json({ error: 'Email delivery is not configured. Configure SMTP before sending reset links.' });
  }

  try {
    const rows = await queryDb(
      `SELECT id, username, email, full_name, role, job_title, department, is_active,
              invited_at, activated_at, last_login_at, created_at, updated_at,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = toPublicUser(rows[0]);
    if (!user.isActive) return res.status(400).json({ error: 'Reactivate this account before sending a reset link.' });
    if (!user.hasPassword) return res.status(400).json({ error: 'This account is still pending setup. Resend the invitation instead.' });
    if (!user.email) return res.status(400).json({ error: 'This account does not have an email address.' });

    const { rawToken } = await createOneTimeToken({ userId: user.id, purpose: 'password_reset', createdBy: req.user.id });
    const delivery = await sendPasswordResetEmail(req, user, rawToken);

    await logAuditEvent(req, {
      action: 'PASSWORD_RESET_LINK_SENT',
      entityType: 'user',
      entityId: user.id,
      description: `Sent password-reset link to ${user.fullName}`,
      metadata: { email: user.email, deliveryMode: delivery.mode },
    });

    res.status(200).json({
      message: delivery.sent ? `Password-reset link sent to ${user.email}` : 'Development password-reset link created.',
      delivery,
    });
  } catch (err) {
    console.error('Admin password-reset email error:', err);
    res.status(err?.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 500).json({ error: err.message || 'Failed to send password-reset link' });
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
  try {
    await queryDb('TRUNCATE TABLE audit_records');
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
        creator.full_name AS createdByName, creator.username AS createdByUsername,
        editor.full_name AS updatedByName, editor.username AS updatedByUsername
      FROM audit_records ar
      LEFT JOIN users creator ON creator.id = ar.created_by
      LEFT JOIN users editor ON editor.id = ar.updated_by
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

// API: Delete a Record (DELETE)
app.delete('/api/records/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  try {
    await auditTrailReady;
    const before = await selectRecordById(id);
    if (!before) {
      return res.status(404).json({ error: 'Record not found' });
    }

    await queryDb('DELETE FROM audit_records WHERE id = ?', [id]);
    await logAuditEvent(req, {
      action: 'FINDING_DELETED',
      entityType: 'finding',
      entityId: id,
      description: `Deleted Finding ${formatRecordNumber(before, id)}`,
      metadata: {
        platform: before.platform || '',
        category: before.category || '',
        detailsFindings: before.detailsFindings || '',
        status: before.status || '',
      },
    });
    res.status(200).json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Delete record error:', err);
    res.status(500).json({ error: 'Failed to delete record' });
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