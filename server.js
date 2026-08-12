import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static('public/uploads')); // Serve images to frontend

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
// ==========================================
app.delete('/api/reset-database', (req, res) => {
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