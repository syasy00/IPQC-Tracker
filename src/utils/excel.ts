import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
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

type PreparedExcelImage = {
  base64: string;
  extension: 'jpeg' | 'png' | 'gif';
  width: number;
  height: number;
};

export type ExcelExportResult = {
  embeddedImages: number;
  failedImages: number;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read evidence image.'));
    reader.readAsDataURL(blob);
  });

const loadBlobAsImage = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to decode evidence image.'));
    };

    image.src = objectUrl;
  });

const convertUnsupportedImageToJpeg = async (
  blob: Blob,
  image: HTMLImageElement
): Promise<PreparedExcelImage> => {
  // WEBP is accepted by the web app but ExcelJS embeds jpeg/png/gif. Convert
  // unsupported browser image formats to a high-quality JPEG before export.
  const maxDimension = 1600;
  const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare evidence image for Excel.');

  // Evidence pictures are photographic. A white backing avoids transparent
  // pixels becoming black when converted to JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    base64: canvas.toDataURL('image/jpeg', 0.9),
    extension: 'jpeg',
    width,
    height,
  };
};

const prepareImageForExcel = async (source: string): Promise<PreparedExcelImage> => {
  const trimmed = clean(source);
  if (!trimmed) throw new Error('Evidence image is empty.');

  // Stored evidence is normally either a data URL or /uploads/... from the same
  // web application. Relative paths are resolved against the current origin.
  const resolvedSource = /^(data:|blob:|https?:)/i.test(trimmed)
    ? trimmed
    : new URL(trimmed, window.location.origin).toString();

  const response = await fetch(resolvedSource);
  if (!response.ok) {
    throw new Error(`Unable to load evidence image (${response.status}).`);
  }

  const blob = await response.blob();
  const image = await loadBlobAsImage(blob);
  const width = Math.max(1, image.naturalWidth || image.width || 1);
  const height = Math.max(1, image.naturalHeight || image.height || 1);
  const mime = String(blob.type || '').toLowerCase();

  if (mime.includes('png')) {
    return {
      base64: await blobToDataUrl(blob),
      extension: 'png',
      width,
      height,
    };
  }

  if (mime.includes('jpeg') || mime.includes('jpg')) {
    return {
      base64: await blobToDataUrl(blob),
      extension: 'jpeg',
      width,
      height,
    };
  }

  if (mime.includes('gif')) {
    return {
      base64: await blobToDataUrl(blob),
      extension: 'gif',
      width,
      height,
    };
  }

  // WEBP and any other browser-decodable format are converted for Excel.
  return convertUnsupportedImageToJpeg(blob, image);
};

const fitImageInsideEvidenceCell = (width: number, height: number) => {
  const maxWidth = 126;
  const maxHeight = 88;
  const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height), 1);

  return {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale)),
  };
};

const downloadWorkbookBuffer = (buffer: any, filename: string) => {
  const blob = new Blob(
    [buffer as unknown as BlobPart],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportToExcel = async (
  data: AuditRecord[],
  filename: string = 'IPQC_Logs.xlsx'
): Promise<ExcelExportResult> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IPQC Tracker';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Audit Logs', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = [
    { header: 'No', key: 'no', width: 8 },
    { header: 'Date', key: 'auditDate', width: 13 },
    { header: 'WW', key: 'ww', width: 8 },
    { header: 'Shift', key: 'shift', width: 8 },
    { header: 'IPQC Auditor Name', key: 'auditors', width: 22 },
    { header: 'PIC Finding', key: 'personOnJob', width: 22 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Platform', key: 'platform', width: 22 },
    { header: 'Area / Station #', key: 'areaStation', width: 22 },
    { header: 'Group Finding', key: 'groupFinding', width: 18 },
    { header: 'Category', key: 'category', width: 34 },
    { header: 'Finding Details', key: 'detailsFindings', width: 45 },
    { header: 'Evidence Photo', key: 'evidencePhoto', width: 20 },
    { header: 'Remark', key: 'remark', width: 40 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'ICAR Status', key: 'icarStatus', width: 14 },
    { header: 'ICAR#', key: 'icarNum', width: 18 },
    { header: 'MQE Engineer', key: 'mqeEngineer', width: 22 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  worksheet.autoFilter = { from: 'A1', to: 'R1' };

  let embeddedImages = 0;
  let failedImages = 0;
  const evidenceColumnIndexZeroBased = 12; // Column M.

  for (const record of data) {
    const row = worksheet.addRow({
      no: record.no ?? '',
      auditDate: record.auditDate || '',
      ww: record.ww || '',
      shift: record.shift || '',
      auditors: record.auditors || '',
      personOnJob: record.personOnJob || '',
      department: record.department || '',
      platform: record.platform || '',
      areaStation: record.areaStation || '',
      groupFinding: record.groupFinding || '',
      category: CATEGORY_EXPORT_MAP[String(record.category || '')] || record.category || '',
      detailsFindings: record.detailsFindings || '',
      evidencePhoto: '',
      remark: record.remark || '',
      status: normalizeFindingStatus((record as any).status) || '',
      icarStatus: record.icarStatus || 'Locked',
      icarNum: record.icarNum || 'N/A',
      mqeEngineer: record.mqeEngineer || '',
    });

    row.height = record.picture ? 76 : 22;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.font = { size: 9, color: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      };
    });

    if (!record.picture) continue;

    try {
      const prepared = await prepareImageForExcel(record.picture);
      const imageId = workbook.addImage({
        base64: prepared.base64,
        extension: prepared.extension,
      });
      const fitted = fitImageInsideEvidenceCell(prepared.width, prepared.height);

      worksheet.addImage(imageId, {
        tl: {
          col: evidenceColumnIndexZeroBased + 0.08,
          row: row.number - 1 + 0.08,
        },
        ext: {
          width: fitted.width,
          height: fitted.height,
        },
        editAs: 'oneCell',
      });

      embeddedImages += 1;
    } catch (error) {
      failedImages += 1;
      const evidenceCell = row.getCell('evidencePhoto');
      evidenceCell.value = 'Image unavailable';
      evidenceCell.font = { italic: true, size: 9, color: { argb: 'FF94A3B8' } };
      console.warn(`Evidence image could not be embedded for record ${record.no ?? record.id}:`, error);
    }
  }

  worksheet.getColumn('no').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getColumn('ww').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getColumn('shift').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getColumn('status').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getColumn('icarStatus').alignment = { horizontal: 'center', vertical: 'middle' };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, filename);

  return { embeddedImages, failedImages };
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