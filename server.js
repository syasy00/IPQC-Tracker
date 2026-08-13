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
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static('public/uploads')); // Serve images to frontend

// ==========================================
// Admin Authentication (single admin account)
// ==========================================
// Credentials never live in the frontend bundle. The username is plain env
// config; the password is stored server-side as a bcrypt hash (see
// scripts/generate-password-hash.js to create ADMIN_PASSWORD_HASH).
const { JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH } = process.env;

if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
  console.warn(
    'WARNING: JWT_SECRET, ADMIN_USERNAME, or ADMIN_PASSWORD_HASH is missing from .env. ' +
    'Admin login and all protected write routes will fail until these are set. ' +
    'Run `node scripts/generate-password-hash.js` to create a hash.'
  );
}

// Verifies a Bearer token on protected routes. Rejects the request outright
// if it's missing or invalid, rather than just hiding a UI button.
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session, please log in again' });
  }
};

// API: Admin Login - issues a short-lived signed token
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
    return res.status(500).json({ error: 'Server auth is not configured. Contact the administrator.' });
  }

  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  try {
    const passwordMatches = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '8h' });
    res.status(200).json({ token, expiresIn: '8h' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// API: Verify an existing token is still valid (used to restore sessions on page load)
app.get('/api/verify', authenticateAdmin, (req, res) => {
  res.status(200).json({ valid: true, username: req.admin.username });
});

// Resilient MySQL Connection Pool with Keep-Alive
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

// Test the pool connection on startup
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL Database:', err);
  } else {
    console.log('Connected to MySQL Database via Pool!');
    connection.release();
  }
});

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
// Public (no auth) - anyone creating an audit record needs these lists to
// populate dropdowns, not just admins. Empty arrays/objects mean no admin
// has saved custom values yet, in which case the frontend falls back to
// its built-in defaults.
app.get('/api/settings', (req, res) => {
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
app.put('/api/settings', authenticateAdmin, (req, res) => {
  const { auditors, mqeMappings } = req.body || {};
  if (!Array.isArray(auditors) || typeof mqeMappings !== 'object' || mqeMappings === null) {
    return res.status(400).json({ error: 'auditors must be an array and mqeMappings must be an object' });
  }
  db.query(
    'UPDATE app_settings SET auditors = ?, mqe_mappings = ? WHERE id = 1',
    [JSON.stringify(auditors), JSON.stringify(mqeMappings)],
    (err) => {
      if (err) {
        console.error('Failed to update settings:', err);
        return res.status(500).json({ error: 'Failed to update settings' });
      }
      res.status(200).json({ auditors, mqeMappings });
    }
  );
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
app.delete('/api/reset-database', authenticateAdmin, (req, res) => {
  db.query('TRUNCATE TABLE audit_records', (err) => {
    if (err) {
      console.error('Failed to clear database:', err);
      return res.status(500).json({ error: 'Failed to reset database' });
    }
    res.status(200).json({ message: 'Database wiped clean! Auto-increment reset to 1.' });
  });
});

// API: Get All Records (READ) - FIXED TO ASCENDING ORDER
app.get('/api/records', (req, res) => {
  const sql = `
    SELECT 
      id, no, DATE_FORMAT(audit_date, '%Y-%m-%d') as auditDate, ww, shift, 
      auditor_name as auditors, pic_finding as personOnJob, department, 
      platform, area_station as areaStation, group_finding as groupFinding, 
      category, finding_details as detailsFindings, picture, remark, 
      icar_status as icarStatus, icar_num as icarNum, mqe_engineer as mqeEngineer 
    FROM audit_records 
    ORDER BY id ASC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.status(200).json(results);
  });
});

// API: Add a New Record (CREATE)
app.post('/api/records', upload.single('picture'), (req, res) => {
  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, icarNum, icarStatus, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : (req.body.picture || null);
  const rowNo = no !== undefined && no !== null && no !== '' ? no : null;

  const sql = `
    INSERT INTO audit_records (
      no, audit_date, ww, shift, auditor_name, pic_finding, department,
      platform, area_station, group_finding, category, finding_details,
      picture, remark, icar_status, icar_num, mqe_engineer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    rowNo, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    picture, remark, icarStatus || 'Locked', icarNum || 'N/A', mqeEngineer
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Database insertion error:', err);
      return res.status(500).json({ error: 'Database insertion failed' });
    }
    
    const newRecord = {
      id: result.insertId,
      no: rowNo || result.insertId,
      auditDate, ww, shift, auditors, personOnJob, department,
      platform, areaStation, groupFinding, category, detailsFindings,
      picture, remark, icarStatus: icarStatus || 'Locked', icarNum: icarNum || 'N/A', mqeEngineer
    };
    res.status(201).json(newRecord);
  });
});

// API: Update an Existing Record (UPDATE) - FIXED MISSING 'NO' FIELD
app.put('/api/records/:id', upload.single('picture'), (req, res) => {
  const { id } = req.params;
  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, icarNum, icarStatus, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : req.body.picture;

  const sql = `
    UPDATE audit_records SET 
      no = ?, audit_date = ?, ww = ?, shift = ?, auditor_name = ?, pic_finding = ?, department = ?,
      platform = ?, area_station = ?, group_finding = ?, category = ?, finding_details = ?,
      picture = COALESCE(?, picture), remark = ?, icar_status = ?, icar_num = ?, mqe_engineer = ?
    WHERE id = ?
  `;

  const values = [
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    picture, remark, icarStatus || 'Locked', icarNum || 'N/A', mqeEngineer, id
  ];

  db.query(sql, values, (err) => {
    if (err) {
      console.error('Database update error:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    const updatedRecord = {
      id, no, auditDate, ww, shift, auditors, personOnJob, department,
      platform, areaStation, groupFinding, category, detailsFindings,
      picture, remark, icarStatus: icarStatus || 'Locked', icarNum: icarNum || 'N/A', mqeEngineer
    };
    res.status(200).json(updatedRecord);
  });
});

// API: Delete a Record (DELETE)
app.delete('/api/records/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM audit_records WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json(err);
    res.status(200).json({ message: 'Deleted successfully' });
  });
});

app.use(express.static('dist'));

app.get('*', (req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));