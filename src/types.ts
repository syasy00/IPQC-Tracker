export type Department = 'Production Team' | 'Test Team' | 'IE Team' | 'Quality Team' | 'Calibration Team' | 'PE Team';
export type Category = 'Compliance_6S' | 'Calibration_PM' | 'Documentation_And_Process_Adherence' | 'ESD_Control' | 'Material_Control_And_Chemical_Management' | 'Safety_Concern' | 'Tooling_Labeling' | 'Training_Certification';

export interface AuditRecord {
  id: string;
  no: number;
  auditDate: string;
  ww: string;
  shift: string;
  auditors: string; // IPQC Auditor Name
  personOnJob: string; // PIC Finding
  department: string;
  platform: string;
  areaStation: string;
  groupFinding: string;
  category: string;
  detailsFindings: string;
  picture?: string;
  remark?: string;
  icarNum?: string;
  icarStatus?: 'Locked' | 'Submitted';
  mqeEngineer?: string;
}

export type ViewState = 'dashboard' | 'ipqc' | 'import' | 'checklist' | 'add-audit' | 'history' | 'settings';