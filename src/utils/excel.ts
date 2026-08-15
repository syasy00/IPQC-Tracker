import * as XLSX from 'xlsx';
import { AuditRecord } from '../types';

// Excel category label -> internal app category value.
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

// Internal app category value -> Excel-friendly label.
const CATEGORY_EXPORT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_MAP).map(([excelLabel, internalValue]) => [internalValue, excelLabel])
);

const clean = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

const normalizeFindingStatus = (value: unknown): 'Open' | 'Closed' | '' => {
  const normalized = clean(value).toLowerCase();

  if (normalized === 'open') return 'Open';
  if (normalized === 'closed' || normalized === 'close') return 'Closed';

  return '';
};

const normalizeIcarStatus = (
  explicitStatus: unknown,
  icarNum: string
): 'Locked' | 'Submitted' => {
  const normalized = clean(explicitStatus).toLowerCase();

  if (normalized === 'submitted') return 'Submitted';
  if (normalized === 'locked') return 'Locked';

  // Fall back to the ICAR number when the workbook has no ICAR Status column.
  return icarNum && icarNum.toUpperCase() !== 'N/A' ? 'Submitted' : 'Locked';
};

// Converts an Excel date cell to YYYY-MM-DD.
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

  const text = clean(value);

  // Explicitly support dd/mm/yyyy as well as ISO/text dates.
  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const importFromExcel = (file: File): Promise<Partial<AuditRecord>[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;

        const workbook = XLSX.read(data, {
          type: 'array',
          cellDates: true,
        });

        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('The Excel workbook does not contain any worksheet.');
        }

        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, {
          defval: '',
          raw: true,
        });

        const mapped: Partial<AuditRecord>[] = rawRows
          .filter((row) => Object.values(row).some((value) => clean(value) !== ''))
          .map((row) => {
            const rawCategory = clean(row['Category']);
            const icarNum = clean(row['ICAR#']) || 'N/A';

            // THIS IS THE IMPORTANT FIX:
            // import the Excel "Status" column as the finding lifecycle.
            const findingStatus = normalizeFindingStatus(
              row['Status'] ??
              row['Finding Status'] ??
              row['finding_status']
            );

            const icarStatus = normalizeIcarStatus(
              row['ICAR Status'] ?? row['icar_status'],
              icarNum
            );

            return {
              no: clean(row['No']) !== '' ? Number(row['No']) : undefined,
              auditDate: toIsoDate(row['Date']),
              ww: clean(row['WW']).replace(/\.0$/, ''),
              shift: clean(row['Shift']),
              auditors: clean(row['IPQC Auditor Name']),
              personOnJob: clean(row['PIC Finding']),
              department: clean(row['Department']),
              platform: clean(row['Platform']),
              areaStation: clean(
                row['Area / Station #'] ??
                row['Area / Station'] ??
                row['Area/Station']
              ),
              groupFinding: clean(row['Group Finding']),
              category: CATEGORY_MAP[rawCategory] || rawCategory,
              detailsFindings: clean(row['Finding Details']),
              remark: clean(row['Remark']),

              // Finding lifecycle: Open / Closed.
              status: findingStatus || undefined,

              // Corrective-action lifecycle: Locked / Submitted.
              icarNum,
              icarStatus,

              // Optional columns. App.tsx can still apply its fallback mapping
              // when MQE Engineer is blank.
              mqeEngineer: clean(
                row['MQE Engineer'] ??
                row['MQE'] ??
                row['mqe_engineer']
              ) || undefined,

              picture: clean(row['Picture'] ?? row['Image']) || undefined,
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

export const exportToExcel = (
  data: AuditRecord[],
  filename: string = 'IPQC_Logs.xlsx'
) => {
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
    'Category': CATEGORY_EXPORT_MAP[String(r.category || '')] || r.category,
    'Finding Details': r.detailsFindings,
    'Remark': r.remark,

    // Keep both lifecycles in exported files so they can be re-imported safely.
    'Status': normalizeFindingStatus((r as any).status) || '',
    'ICAR Status': r.icarStatus || 'Locked',
    'ICAR#': r.icarNum || 'N/A',
    'MQE Engineer': r.mqeEngineer || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Make the exported workbook easier to inspect in Excel.
  worksheet['!cols'] = [
    { wch: 8 },   // No
    { wch: 13 },  // Date
    { wch: 8 },   // WW
    { wch: 8 },   // Shift
    { wch: 22 },  // Auditor
    { wch: 22 },  // PIC
    { wch: 20 },  // Department
    { wch: 22 },  // Platform
    { wch: 22 },  // Area
    { wch: 18 },  // Group Finding
    { wch: 34 },  // Category
    { wch: 45 },  // Finding Details
    { wch: 40 },  // Remark
    { wch: 12 },  // Status
    { wch: 14 },  // ICAR Status
    { wch: 18 },  // ICAR#
    { wch: 22 },  // MQE
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Logs');
  XLSX.writeFile(workbook, filename);
};

export const calculateWW = (dateStr: string): string => {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );

  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    (((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7
  );

  return weekNo.toString();
};