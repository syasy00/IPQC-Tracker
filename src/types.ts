export type Department = 'Etching' | 'Lithography' | 'Deposition' | 'Doping' | 'Packaging' | 'Mfg Engineering';
export type Category = 'Standard' | 'Quality' | 'Safety' | 'Process';

export interface AuditRecord {
  id: string;
  no: number;
  auditDate: string;
  ww: string;
  shift: 'D' | 'N';
  auditors: string; // IPQC Auditor Name
  personOnJob: string; // PIC Finding
  department: string;
  platform: string;
  areaStation: string;
  groupFinding: string;
  category: string;
  detailsFindings: string;
  picture?: string;
  remark: string;
  status: 'Open' | 'Closed' | 'In Progress';
  icarNum: string;
  actionTaken: string;
}

export type ViewState = 'dashboard' | 'ipqc' | 'checklist' | 'add-audit' | 'history';
