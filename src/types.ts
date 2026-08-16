export type Department = 'Production Team' | 'Test Team' | 'IE Team' | 'Quality Team' | 'Calibration Team' | 'PE Team';
export type Category = 'Compliance_6S' | 'Calibration_PM' | 'Documentation_And_Process_Adherence' | 'ESD_Control' | 'Material_Control_And_Chemical_Management' | 'Safety_Concern' | 'Tooling_Labeling' | 'Training_Certification';

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
}

export type ViewState = 'dashboard' | 'ipqc' | 'import' | 'checklist' | 'add-audit' | 'history' | 'settings';