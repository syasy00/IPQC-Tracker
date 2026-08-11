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
app.use(express.json());
app.use('/uploads', express.static('public/uploads')); // Serve images to frontend

// Resilient MySQL Connection with Auto-Reconnect
let db;

function handleDisconnect() {
  db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 30000
  });

  db.connect((err) => {
    if (err) {
      console.error('Error connecting to MySQL, retrying in 2s...', err);
      setTimeout(handleDisconnect, 2000);
    } else {
      console.log('Connected to MySQL Database!');
    }
  });

  db.on('error', (err) => {
    console.error('MySQL database error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect();

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

// API: Get All Audits (READ)
app.get('/api/audits', (req, res) => {
  const sql = `
    SELECT 
      id, no, DATE_FORMAT(audit_date, '%Y-%m-%d') as auditDate, ww, shift, 
      auditor_name as auditors, pic_finding as personOnJob, department, 
      platform, area_station as areaStation, group_finding as groupFinding, 
      category, finding_details as detailsFindings, picture, remark, 
      status, icar_num as icarNum, action_taken as actionTaken, mqe_engineer as mqeEngineer 
    FROM audit_records 
    ORDER BY id DESC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.status(200).json(results);
  });
});

// API: Add a New Audit (CREATE)
app.post('/api/audits', upload.single('picture'), (req, res) => {
  const {
    auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    remark, status, icarNum, actionTaken, mqeEngineer
  } = req.body;

  const picture = req.file ? `/uploads/${req.file.filename}` : null;

  const sql = `
    INSERT INTO audit_records (
      audit_date, ww, shift, auditor_name, pic_finding, department,
      platform, area_station, group_finding, category, finding_details,
      picture, remark, status, icar_num, action_taken, mqe_engineer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    auditDate, ww, shift, auditors, personOnJob, department,
    platform, areaStation, groupFinding, category, detailsFindings,
    picture, remark, status, icarNum, actionTaken, mqeEngineer
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Database insertion error:', err);
      return res.status(500).json({ error: 'Database insertion failed' });
    }
    res.status(201).json({ message: 'Audit added successfully', id: result.insertId });
  });
});

app.use(express.static('dist'));

app.get('*', (req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));