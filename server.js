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
const {
  JWT_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.6-flash'
} = process.env;

if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
  console.warn(
    'WARNING: JWT_SECRET, ADMIN_USERNAME, or ADMIN_PASSWORD_HASH is missing from .env. ' +
    'Admin login and all protected write routes will fail until these are set. ' +
    'Run `node scripts/generate-password-hash.js` to create a hash.'
  );
}

if (!GEMINI_API_KEY) {
  console.warn(
    'INFO: GEMINI_API_KEY is not configured. The application will work normally, ' +
    'but the admin-only AI Insights page will remain unavailable until a Gemini API key is added.'
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


// Small Promise wrapper used by read-only analytics endpoints.
const queryDb = (sql, values = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, values, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
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
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
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
      category, finding_details as detailsFindings, picture, remark, status,
      icar_status as icarStatus, icar_num as icarNum, mqe_engineer as mqeEngineer 
    FROM audit_records 
    ORDER BY id ASC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.status(200).json(results);
  });
});


// ==========================================
// Admin-only AI Insights (READ ONLY)
// ==========================================
// Important design boundary:
// - The model never receives a database connection or SQL execution tool.
// - The server first computes a compact, read-only operational snapshot.
// - The route has no INSERT / UPDATE / DELETE capability.
// - Evidence images and free-form remarks are not sent to the AI service.
app.post('/api/ai-insights', authenticateAdmin, async (req, res) => {
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
5. When comparing work weeks, treat WW values numerically.
6. A filter should only be returned when the answer clearly maps to matching records.
7. Filter values must use exact database values from snapshot.filterValues. Leave unsupported filters blank.
8. Do not output Markdown tables.

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
            temperature: 0.2,
            maxOutputTokens: 900,
            responseMimeType: 'application/json',
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

    if (!parsed || typeof parsed.answer !== 'string') {
      return res.status(200).json({
        answer: modelText || 'The AI service returned an empty response.',
        highlights: [],
        filters: {},
        caveat: 'Verify important decisions against the source IPQC records.',
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
app.post('/api/records', upload.single('picture'), (req, res) => {
  const {
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, status, icarNum, icarStatus, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : (req.body.picture || null);
  const rowNo = no !== undefined && no !== null && no !== '' ? no : null;

  const sql = `
    INSERT INTO audit_records (
      no, audit_date, ww, shift, auditor_name, pic_finding, department,
      platform, area_station, group_finding, category, finding_details,
      picture, remark, status, icar_status, icar_num, mqe_engineer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    rowNo, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    picture, remark, status || 'Open', icarStatus || 'Locked', icarNum || 'N/A', mqeEngineer
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
      picture, remark, status: status || 'Open', icarStatus: icarStatus || 'Locked', icarNum: icarNum || 'N/A', mqeEngineer
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
    remark, status, icarNum, icarStatus, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : req.body.picture;

  const sql = `
    UPDATE audit_records SET 
      no = ?, audit_date = ?, ww = ?, shift = ?, auditor_name = ?, pic_finding = ?, department = ?,
      platform = ?, area_station = ?, group_finding = ?, category = ?, finding_details = ?,
      picture = COALESCE(?, picture), remark = ?, status = ?, icar_status = ?, icar_num = ?, mqe_engineer = ?
    WHERE id = ?
  `;

  const values = [
    no, auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    picture, remark, status || 'Open', icarStatus || 'Locked', icarNum || 'N/A', mqeEngineer, id
  ];

  db.query(sql, values, (err) => {
    if (err) {
      console.error('Database update error:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    const updatedRecord = {
      id, no, auditDate, ww, shift, auditors, personOnJob, department,
      platform, areaStation, groupFinding, category, detailsFindings,
      picture, remark, status: status || 'Open', icarStatus: icarStatus || 'Locked', icarNum: icarNum || 'N/A', mqeEngineer
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