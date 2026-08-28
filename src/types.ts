export type Department = 'Production Team' | 'Test Team' | 'IE Team' | 'Quality Team' | 'Calibration Team' | 'PE Team';
export type Category = '6S' | 'Calibration' | 'PM' | 'Procedural non-compliance' | 'Docs/WI' | 'ESD' | 'Expired Material' | 'Safety Concern' | 'Identification' | 'Training/Competency' | 'Handling';

export interface AuditRecord {
  id: string;
  no: number;
  auditDate: string;
  ww: string;
  shift: string;
  auditors: string; 
  personOnJob: string; 
  department: string;
  platform: string;
  areaStation: string;
  groupFinding: string;
  category: string;
  detailsFindings: string;
  picture?: string;
  remark?: string;
  status?: 'Open' | 'Closed' | string | null;
  icarNum?: string;
  icarStatus?: 'Locked' | 'Submitted';
  mqeEngineer?: string;

 
  createdByUserId?: number | null;
  createdByName?: string | null;
  createdByUsername?: string | null;
  createdAt?: string | null;
  updatedByUserId?: number | null;
  updatedByName?: string | null;
  updatedByUsername?: string | null;
  updatedAt?: string | null;


  deletedByUserId?: number | null;
  deletedByName?: string | null;
  deletedByUsername?: string | null;
  deletedAt?: string | null;
}

export type ViewState = 'dashboard' | 'ipqc' | 'import' | 'checklist' | 'add-audit' | 'history' | 'access-audit' | 'quality-config';
