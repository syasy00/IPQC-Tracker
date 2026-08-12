import * as XLSX from 'xlsx';
import { AuditRecord } from '../types';

// The master template's exact column headers -> the values the app's Category
// dropdown expects internally (see CATEGORIES in App.tsx / types.ts).
const CATEGORY_MAP: Record<string, string> = {
  '6S': 'Compliance_6S',
  'Calibration / PM': 'Calibration_PM',
  'Documentation / Process Adherence': 'Documentation_And_Process_Adherence',
  'ESD Control': 'ESD_Control',
  'Material Control / Chemical Management': 'Material_Control_And_Chemical_Management',
  'Safety Concern': 'Safety_Concern',
  'Tooling / Labeling': 'Tooling_Labeling',
  'Training / Certification': 'Training_Certification',
};

const clean = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

// Converts an Excel date cell to 'YYYY-MM-DD'. Handles real JS Date objects
// (what we get when reading with cellDates: true), raw Excel serial numbers
// (fallback, in case a cell somehow isn't parsed as a date), and plain text dates.
const toIsoDate = (value: unknown): string => {
  if (!value) return '';

  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const d = new Date(value as string);
  return isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const importFromExcel = (file: File): Promise<Partial<AuditRecord>[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;

        // cellDates: true makes Excel date cells come through as real JS Date
        // objects instead of raw serial numbers (requires readAsArrayBuffer below,
        // not readAsBinaryString - the old binary-string path doesn't parse dates
        // reliably with cellDates).
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // defval: '' guarantees every expected header key exists on every row
        // object, even when that specific cell is blank in the sheet, so we
        // never confuse "column is empty" with "column doesn't exist".
        const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        const mapped: Partial<AuditRecord>[] = rawRows
          // Skip fully blank rows (trailing empty rows in the sheet, etc.)
          .filter((row) => Object.values(row).some((v) => clean(v) !== ''))
          .map((row) => {
            const icarNum = clean(row['ICAR#']);
            const rawCategory = clean(row['Category']);

            return {
              no: row['No'] !== '' ? Number(row['No']) : undefined,
              auditDate: toIsoDate(row['Date']),
              ww: clean(row['WW']).replace(/\.0$/, ''), // guards against 2.0 instead of 2
              shift: clean(row['Shift']),
              auditors: clean(row['IPQC Auditor Name']),
              personOnJob: clean(row['PIC Finding']),
              department: clean(row['Department']),
              platform: clean(row['Platform']),
              areaStation: clean(row['Area / Station #']),
              groupFinding: clean(row['Group Finding']),
              category: CATEGORY_MAP[rawCategory] || rawCategory,
              detailsFindings: clean(row['Finding Details']),
              remark: clean(row['Remark']),
              icarNum: icarNum || 'N/A',
              icarStatus: icarNum && icarNum !== 'N/A' ? 'Submitted' : 'Locked',
            } as Partial<AuditRecord>;
          });

        resolve(mapped);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

export const exportToExcel = (data: AuditRecord[], filename: string = 'IPQC_Logs.xlsx') => {
  // Export using the same human-readable headers as the master template, so a
  // file that's exported can be re-imported cleanly.
  const rows = data.map((r) => ({
    'No': r.no,
    'Date': r.auditDate,
    'WW': r.ww,
    'Shift': r.shift,
    'IPQC Auditor Name': r.auditors,
    'PIC Finding': r.personOnJob,
    'Department': r.department,
    'Platform': r.platform,
    'Area / Station #': r.areaStation,
    'Group Finding': r.groupFinding,
    'Category': r.category,
    'Finding Details': r.detailsFindings,
    'Remark': r.remark,
    'ICAR Status': r.icarStatus,
    'ICAR#': r.icarNum,
    'MQE Engineer': r.mqeEngineer,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Logs');
  XLSX.writeFile(workbook, filename);
};

export const calculateWW = (dateStr: string): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo.toString();
};