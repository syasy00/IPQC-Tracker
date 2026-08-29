import { useState, useMemo, FormEvent, useRef, ChangeEvent, useEffect, DragEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  LayoutDashboard, 
  ClipboardCheck, 
  Settings, 
  Search, 
  Plus, 
  MoreVertical, 
  X,
  CheckCircle2,
  Clock,
  Menu,
  ImageIcon,
  Pencil,
  Trash2,
  Filter,
  Lock,
  Unlock,
  Users,
  Layers,
  TrendingUp,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LogIn,
  LogOut,
  User,
  ChevronDown,
  MapPin,
  Sparkles,
  CalendarDays,
  Info,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  History,
  RotateCcw,
  DatabaseBackup,
  SlidersHorizontal,
  ArchiveRestore,
  Smartphone,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip
} from 'recharts';
import { AuditRecord, ViewState } from './types';
import { exportToExcel, importFromExcel } from './utils/excel';

type FindingStatus = 'Open' | 'Closed';
type IPQCAuditRecord = Omit<AuditRecord, 'status'> & {
  status?: FindingStatus | string | null;
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
};

type RecordVersion = {
  id: number;
  recordId: number;
  versionNo: number;
  changeType: string;
  snapshot: Partial<IPQCAuditRecord>;
  changedFields?: string[];
  actorUserId?: number | null;
  actorName: string;
  actorRole: string;
  createdAt: string;
};

type AuditLogEntry = {
  id: number;
  actorUserId?: number | null;
  actorUsername: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId?: string | null;
  description: string;
  metadata?: any;
  ipAddress?: string | null;
  createdAt: string;
};

type AppView = ViewState | 'action-center' | 'ai-insights';

type AIInsightFilters = {
  status?: string;
  icarStatus?: string;
  platform?: string;
  category?: string;
  auditor?: string;
  department?: string;
  ww?: string;
  mqe?: string;
};

type AIInsightResult = {
  answer: string;
  highlights?: Array<{
    label: string;
    value: string;
    detail?: string;
  }>;
  filters?: AIInsightFilters;
  caveat?: string;
  generatedAt?: string;
};

type UserRole = 'user' | 'admin';
type LoginMode = 'user' | 'admin';

type ToastKind = 'success' | 'error' | 'warning' | 'info';
type ToastMessage = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
};

type CurrentUser = {
  id: number;
  username: string;
  employeeId?: string;
  fullName: string;
  role: UserRole;
  jobTitle?: string;
  department?: string;
  isActive?: boolean;
  mustChangeCredential?: boolean;
  credentialReady?: boolean;
  mfaEnabled?: boolean;
  mfaEnrolledAt?: string | null;
  lastLoginAt?: string | null;
};

type ManagedUser = CurrentUser & {
  isActive: boolean;
  mustChangeCredential: boolean;
  credentialReady: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PublicEmployee = {
  id: number;
  employeeId: string;
  fullName: string;
  jobTitle?: string;
  department?: string;
};

const AUTH_TOKEN_STORAGE_KEY = 'ipqc_auth_token';
const CURRENT_USER_STORAGE_KEY = 'ipqc_current_user';

const readStoredCurrentUser = (): CurrentUser | null => {
  try {
    const raw = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.id || !parsed.username || !['user', 'admin'].includes(parsed.role)) return null;
    return parsed as CurrentUser;
  } catch {
    return null;
  }
};

const AI_SUGGESTED_QUESTIONS = [
  'What requires the most attention right now?',
  'Which platform has the most open findings?',
  'Show me submitted ICARs that are still open.',
  'Which categories are driving the most open findings?',
  'Which MQE has the highest unresolved workload?',
  'Summarize the latest work-week quality performance.',
];

const normalizeFindingStatus = (value: unknown): FindingStatus | '' => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'open') return 'Open';
  if (normalized === 'closed' || normalized === 'close') return 'Closed';
  return '';
};

const normalizeRecord = (raw: any): IPQCAuditRecord => ({
  ...raw,
  status: normalizeFindingStatus(raw?.status ?? raw?.findingStatus ?? raw?.finding_status) || null,
  icarStatus: raw?.icarStatus ?? raw?.icar_status ?? 'Locked',
});

const getFindingStatus = (record: Partial<IPQCAuditRecord>): FindingStatus | '' =>
  normalizeFindingStatus(record.status);

const getRecordAgeDays = (auditDate?: string): number => {
  if (!auditDate) return 0;
  const date = new Date(`${auditDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
};

const API_BASE_URL = '';

const getImageUrl = (path?: string) => {
  if (!path) return undefined;
  if (path.startsWith('http') || path.startsWith('data:')) return path;
  return `${API_BASE_URL}${path}`;
};

const calculateWW = (dateStr: string): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo.toString();
};

const getTodayLocalISO = (): string => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};


const formatTraceDateTime = (value?: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const auditActionLabel = (action: string): string => {
  const labels: Record<string, string> = {
    FINDING_CREATED: 'Created finding',
    FINDING_IMPORTED: 'Imported finding',
    FINDING_UPDATED: 'Updated finding',
    FINDING_MQE_RECALCULATED: 'Synced MQE ownership',
    FINDING_DELETED: 'Moved to recycle bin',
    FINDING_RESTORED: 'Restored finding',
    FINDING_VERSION_RESTORED: 'Restored record version',
    USER_CREATED: 'Created user',
    USER_UPDATED: 'Updated user',
    USER_ACTIVATED: 'Activated user',
    USER_DEACTIVATED: 'Deactivated user',
    USER_ROLE_CHANGED: 'Changed user role',
    USER_CREDENTIAL_RESET: 'Reset credential',
    USER_PIN_CHANGED: 'Changed PIN',
    ADMIN_PASSWORD_CHANGED: 'Changed admin password',
    ADMIN_MFA_ENROLLED: 'Enabled admin MFA',
    ADMIN_MFA_RESET: 'Reset admin MFA',
    ADMIN_MFA_FAILED: 'Failed MFA check',
    ADMIN_LOGIN_FAILED: 'Failed admin sign-in',
    ADMIN_ACCOUNT_LOCKED: 'Admin account locked',
    USER_SIGNED_IN: 'Signed in',
    AUDITOR_LIST_UPDATED: 'Updated auditor list',
    MQE_MAPPING_UPDATED: 'Updated MQE mapping',
    SETTINGS_UPDATED: 'Updated settings',
    DATABASE_RESET: 'Reset database',
  };
  return labels[action] || action.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
};

const versionChangeLabel = (changeType: string): string => {
  const labels: Record<string, string> = {
    created: 'Created',
    baseline: 'Baseline',
    updated: 'Updated',
    mqe_recalculated: 'MQE ownership synced',
    deleted: 'Moved to recycle bin',
    restored: 'Restored',
    version_restored: 'Version restored',
  };
  return labels[changeType] || changeType.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
};

const DEPARTMENTS = [
  'Production Team',
  'Test Team',
  'IE Team',
  'Quality Team',
  'Calibration Team',
  'PE Team'
];

const FINDING_DETAILS_BY_CATEGORY: Record<string, string[]> = {
  '6S': [
    'Mix material inside the material bin',
    'Dustbin located at non-kanban area',
    'Unnecessary item/material found on the workstation',
    'Improper storage of Tool/Equipment',
    'Mixed chemicals stored in the same bin',
    'No Workstation / Tester Identification',
    'No label Identification on Equipment / Tools',
    'Material Scrap Bin without cover',
    'Dust on workstation/rack/ect',
    'Trolly not properly inside kanban',
    'Improper storage of Kit / Bulk Material',
  ],
  'Calibration': [
    'Calibration Overdue ESD Monitor',
    'Calibration Overdue Manual Torque',
    'Equipment without Calibration Label',
    'Calibration Overdue Tools / Equipment',
    'Calibration Overdue Torque Drive',
    'Calibration Overdue Solder Iron',
  ],
  'PM': [
    'Equipment without Preventive Equipment Label',
    'Preventive Maintenance Overdue',
  ],
  'Procedural non-compliance': [
    'Setup check list not updated',
    'Operating the process without OMS/WI displayed',
    'Not following OMS / WI',
    'No Set-Up Checklist displayed',
  ],
  'Docs/WI': [
    'Use Obsolete Visual Standard',
    "OMS doesn't match current practice",
    'Incomplete OMS',
  ],
  'ESD': [
    'Ionizer turn off',
    'No Insulative Mat',
    'Ionizer is not available at the workstation',
    'ESD mat was not grounded',
    'No ESD grounding points',
    'ESD Monitoring not function',
    'Ionizer Calibration Date Expired',
  ],
  'Expired Material': [
    'Chemical / Material Overdue',
  ],
  'Safety Concern': [
    'Improper sitting position',
    'Water leaking from the tester/machine',
    'Material Handling & Storage',
    'Cable wire damage',
  ],
  'Identification': [
    'IPA without Expiry Date Label',
    'IPA Label Damage , Torn, Smear',
    'Material without Expiring Label',
    'Torque number is smear / missing /damage / torn off',
    'Missing Label Expiry Date',
    'Calibration Label damage, Torn on Tools / Equipment',
  ],
  'Training/Competency': [
    'Assembler operating without certification',
    'Assembler improper used of jigs / Fixture at Workstation',
  ],
  'Handling': [
    'Operators handling parts without required gloves or finger cots.',
    'Material handled without ESD protection.',
    'Product transferred without using the designated tray/trolley',
    'Components / Unit placed directly on the floor.',
    'Product exposed to contamination during handling.',
    'WIP transported without proper identification',
  ],
};

const CATEGORIES = Object.keys(FINDING_DETAILS_BY_CATEGORY);

const PLATFORMS = [
  'Apex',
  'Ascent',
  'Cesar',
  'Cumulus',
  'Evos',
  'Ewave',
  'HASS & Burn In',
  'HV',
  'HV (MV)',
  'HV (OL)',
  'Insource (Potting)',
  'Maxstream',
  'Navi I/AZX/LM/LFM/RFG',
  'Navi II',
  'OBA & PACKING',
  'Packing',
  'Paramount',
  'PDX',
  'Pinnacle III',
  'Scorpius',
  'Solvix',
  'VHF'
];

const CATEGORY_GROUP_MAPPING: Record<string, string> = {
  '6S': 'Method',
  'Calibration': 'Machine',
  'PM': 'Machine',
  'Procedural non-compliance': 'Method',
  'Docs/WI': 'Method',
  'ESD': 'Machine',
  'Expired Material': 'Material',
  'Safety Concern': 'Man',
  'Identification': 'Material',
  'Training/Competency': 'Man',
  'Handling': 'Man',

  // Legacy values are kept so older records can still be edited without data loss.
  Compliance_6S: 'Method',
  Calibration_PM: 'Machine',
  Documentation_And_Process_Adherence: 'Method',
  ESD_Control: 'Machine',
  Material_Control_And_Chemical_Management: 'Material',
  Safety_Concern: 'Man',
  Tooling_Labeling: 'Material',
  Training_Certification: 'Man',
};

const INITIAL_PLATFORM_MQE_MAPPING: Record<string, string> = {
  Apex: 'Siti Naimah',
  Ascent: 'Syahqila',
  Cumulus: 'Ivy',
  Evos: 'Kiri',
  Ewave: 'Syahqila',
  HV: 'Farhad',
  'HV (MV)': 'Farhad',
  'HV (OL)': 'Farhad',
  'Insource (Potting)': 'Farhad',
  Maxstream: 'Larry',
  'Navi I/AZX/LM/LFM/RFG': 'Farid',
  'Navi II': 'Azren',
  Paramount: 'Ivy',
  PDX: 'Larry',
  'Pinnacle III': 'Syahqila',
  Scorpius: 'Kornnie',
  VHF: 'Larry'
};

const SHIFTS = ['A', 'B', 'C'];
const INITIAL_AUDITORS = [
  'Ifah',
  'Amalina',
  'Amalia',
  'Annur',
  'Azmizal',
  'Firdaus',
  'Izzati',
  'Najmi',
  'Saiful',
  'Zaidi',
  'Zulfikri',
  'Ahmad',
  'Sarah Connor'
];
const WWS = Array.from({length: 52}, (_, i) => (i + 1).toString());

export default function App() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSequenceRef = useRef(0);

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (kind: ToastKind, title: string, message?: string, duration?: number) => {
    const id = ++toastSequenceRef.current;
    const timeout = duration ?? (kind === 'error' ? 6000 : kind === 'warning' ? 5200 : 4200);
    setToasts((current) => [...current.slice(-3), { id, kind, title, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, timeout);
  };

  const [view, setView] = useState<AppView>('ipqc');
  // The center content area is its own scroll container. Each top-level page
  // should open from the top instead of inheriting the previous page's scroll.
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const [records, setRecords] = useState<IPQCAuditRecord[]>([]); 
  const [powerBiUrl, setPowerBiUrl] = useState<string>(''); 
  const [dashboardMode, setDashboardMode] = useState<'system' | 'powerbi'>('system');
  // Shared authentication for both system roles: user and admin.
  // The JWT is server-issued; the role is read from the database-backed user record.
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY));
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => readStoredCurrentUser());
  // Keep the latest rolling token in a ref so background requests cannot erase
  // a newer session with a late response from an older token.
  const authTokenRef = useRef<string | null>(authToken);
  const lastSessionRefreshAtRef = useRef(0);
  const isAuthenticated = Boolean(authToken && currentUser);
  const isAdmin = currentUser?.role === 'admin';

  const [showLoginModal, setShowLoginModal] = useState(() => (
    !localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || !readStoredCurrentUser()
  ));
  const [loginMode, setLoginMode] = useState<LoginMode>('user');
  const [publicEmployees, setPublicEmployees] = useState<PublicEmployee[]>([]);
  const [publicEmployeesLoading, setPublicEmployeesLoading] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [adminMfaStage, setAdminMfaStage] = useState<'credentials' | 'setup' | 'verify'>('credentials');
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSetupKey, setMfaSetupKey] = useState('');
  const [mfaOtpAuthUrl, setMfaOtpAuthUrl] = useState('');
  const [mfaAccountLabel, setMfaAccountLabel] = useState('');
  const [showMfaSetupKey, setShowMfaSetupKey] = useState(false);

  const resetAdminMfaFlow = () => {
    setAdminMfaStage('credentials');
    setMfaChallengeToken('');
    setMfaCode('');
    setMfaSetupKey('');
    setMfaOtpAuthUrl('');
    setMfaAccountLabel('');
    setShowMfaSetupKey(false);
  };

  const [showCredentialChangeModal, setShowCredentialChangeModal] = useState(false);
  const [newCredential, setNewCredential] = useState('');
  const [confirmCredential, setConfirmCredential] = useState('');
  const [credentialChangeError, setCredentialChangeError] = useState('');
  const [changingCredential, setChangingCredential] = useState(false);

  const clearAuthSession = (_expired = false) => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    // Remove legacy single-admin keys from older builds.
    localStorage.removeItem('ipqc_admin_token');
    localStorage.removeItem('ipqc_admin_username');
    authTokenRef.current = null;
    setAuthToken(null);
    setCurrentUser(null);
    setShowCredentialChangeModal(false);
    resetAdminMfaFlow();
    setShowLoginModal(true);
    if (view === 'access-audit' || view === 'quality-config' || view === 'action-center' || view === 'ai-insights') setView('ipqc');
  };

  const authFetch = async (url: string, options: RequestInit = {}) => {
    // Capture the token used by THIS request. A slow 401 response from an old
    // session must never erase a newer token that the user just received after
    // signing in again (the previous implementation could cause a login loop).
    const requestToken = authTokenRef.current;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      const latestStoredToken = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
      if (!requestToken || latestStoredToken === requestToken) clearAuthSession(false);
    }
    if (response.status === 428) setShowCredentialChangeModal(true);
    return response;
  };

  // Profile menu (avatar dropdown in header) - closes on outside click
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sidebar destinations behave like separate pages. When the admin/user moves
  // to another destination, always start at the top of the content area.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);


  // Standard-user sign in uses a simple approved employee selector + 6-digit PIN.
  // The public endpoint returns only active standard-user display information.
  useEffect(() => {
    if (!showLoginModal || loginMode !== 'user') return;
    let cancelled = false;
    setPublicEmployeesLoading(true);
    fetch(`${API_BASE_URL}/api/public-users`)
      .then(async (response) => {
        const data = await response.json().catch(() => ([]));
        if (!cancelled && response.ok) setPublicEmployees(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setPublicEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setPublicEmployeesLoading(false);
      });
    return () => { cancelled = true; };
  }, [showLoginModal, loginMode]);
  
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importDragActive, setImportDragActive] = useState(false);
  const [importFileError, setImportFileError] = useState('');
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [exportingExcel, setExportingExcel] = useState(false);

  // Admin-only AI Insights state. The assistant is deliberately read-only:
  // it can analyze and recommend, but never writes to the audit database.
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiLastQuestion, setAiLastQuestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<AIInsightResult | null>(null);
  const aiResponseRef = useRef<HTMLElement | null>(null);
  const shouldScrollToAiResponseRef = useRef(false);

  // Settings State for CRUD Operations
  const [auditorsList, setAuditorsList] = useState(INITIAL_AUDITORS);
  const [newAuditorName, setNewAuditorName] = useState('');
  const [editingAuditorIndex, setEditingAuditorIndex] = useState<number | null>(null);
  const [editAuditorValue, setEditAuditorValue] = useState('');
  
  const [platformsList] = useState(PLATFORMS);
  const [mqeMappings, setMqeMappings] = useState(INITIAL_PLATFORM_MQE_MAPPING);
  const [selectedPlatformForMapping, setSelectedPlatformForMapping] = useState(PLATFORMS[0]);
  const [newMqeName, setNewMqeName] = useState('');


  // Database-backed account management. Only admins can load or change this list.
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSaving, setUsersSaving] = useState(false);
  const [userManagementError, setUserManagementError] = useState('');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserDraft, setNewUserDraft] = useState({
    fullName: '', employeeId: '', username: '', credential: '', role: 'user' as UserRole, jobTitle: '', department: ''
  });
  const [resetCredentialUserId, setResetCredentialUserId] = useState<number | null>(null);
  const [resetCredentialValue, setResetCredentialValue] = useState('');

  // Admin audit trail: recent business/system mutations with authenticated actor.
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [auditLogError, setAuditLogError] = useState('');
  const [deletedRecords, setDeletedRecords] = useState<IPQCAuditRecord[]>([]);
  const [deletedRecordsLoading, setDeletedRecordsLoading] = useState(false);

  // Old builds could create duplicate sign-in audit rows during an immediate
  // session-verification retry. Keep the database history intact, but collapse
  // identical sign-ins within five seconds in the UI. The backend also prevents
  // new duplicates from being written.
  const displayAuditLog = useMemo(() => {
    const lastSeen = new Map<string, number>();
    return auditLog.filter((entry) => {
      if (entry.action !== 'USER_SIGNED_IN') return true;
      const key = `${entry.actorUserId ?? entry.actorUsername}|${entry.action}|${entry.entityId ?? ''}|${entry.description}`;
      const at = new Date(entry.createdAt).getTime();
      const previous = lastSeen.get(key);
      lastSeen.set(key, at);
      return previous === undefined || Math.abs(previous - at) > 5000;
    });
  }, [auditLog]);

  const fetchAuditLog = async () => {
    if (!isAdmin || !authToken) return;
    setAuditLogLoading(true);
    setAuditLogError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/api/audit-log?limit=80`);
      const data = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error(data.error || 'Failed to load audit trail.');
      setAuditLog(Array.isArray(data) ? data : []);
    } catch (err) {
      setAuditLogError(err instanceof Error ? err.message : 'Failed to load audit trail.');
    } finally {
      setAuditLogLoading(false);
    }
  };

  const [analyticsDimension, setAnalyticsDimension] = useState<'platform' | 'category' | 'mqe' | 'auditor'>('platform');

  const categoryFilterOptions = useMemo(() => {
    const existing = records
      .map(record => String(record.category || '').trim())
      .filter(Boolean);
    return Array.from(new Set([...CATEGORIES, ...existing]));
  }, [records]);

  useEffect(() => {
    if (!authToken) {
      setRecords([]);
      return;
    }
    const fetchAudits = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/api/records`);
        const data = await response.json().catch(() => ([]));
        if (!response.ok) {
          throw new Error((data as any)?.error || 'Could not load IPQC records.');
        }
        setRecords(Array.isArray(data) ? data.map(normalizeRecord) : []);
      } catch (error) {
        console.error('Error fetching data from database:', error);
        showToast('error', 'Records unavailable', error instanceof Error ? error.message : 'Could not load IPQC records.');
      }
    };
    fetchAudits();
  }, [authToken]);

  // Load the saved auditor list & platform-MQE mapping for authenticated users.
  useEffect(() => {
    if (!authToken) return;
    const fetchSettings = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/api/settings`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load quality configuration.');
        if (Array.isArray(data.auditors) && data.auditors.length > 0) {
          setAuditorsList(data.auditors);
        }
        if (data.mqeMappings && Object.keys(data.mqeMappings).length > 0) {
          setMqeMappings(data.mqeMappings);
        }
      } catch (error) {
        console.error('Error fetching settings from database:', error);
        showToast('error', 'Configuration unavailable', error instanceof Error ? error.message : 'Could not load quality configuration.');
      }
    };
    fetchSettings();
  }, [authToken]);

  // Restore/verify a saved session against the database. Only a real 401
  // means the identity session ended. Temporary network/server errors must not
  // wipe a floor user's valid token or display a misleading expiry message.
  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      setShowLoginModal(true);
      return;
    }

    let cancelled = false;
    const tokenBeingVerified = authTokenRef.current || authToken;

    const verifySession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/verify`, {
          headers: { Authorization: `Bearer ${tokenBeingVerified}` },
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (response.status === 401) {
          const latestStoredToken = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
          // Ignore a late 401 from an older token after a rolling refresh/login.
          if (!latestStoredToken || latestStoredToken === tokenBeingVerified) {
            clearAuthSession(false);
          }
          return;
        }

        if (!response.ok) {
          console.error('Session verification failed:', response.status, data);
          // Do not interrupt an identified floor user for a temporary server/database error.
          return;
        }

        if (!data.user) {
          clearAuthSession(false);
          return;
        }

        setCurrentUser(data.user);
        localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data.user));
        setLoginError('');
        setShowLoginModal(false);
        setShowCredentialChangeModal(Boolean(data.user.mustChangeCredential));
      } catch (error) {
        if (cancelled) return;
        console.error('Session verification error:', error);
        // Keep the current screen during short network interruptions.
      }
    };

    verifySession();
    return () => { cancelled = true; };
  }, [authToken]);

  // Floor-user rolling session. Standard users receive a long-lived token
  // and the app quietly renews it while the workstation remains in use. Admins
  // retain the shorter protected-session policy.
  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'user' || currentUser.mustChangeCredential) return;

    let cancelled = false;
    const MIN_REFRESH_GAP_MS = 60 * 60 * 1000;
    const PERIODIC_CHECK_MS = 2 * 60 * 60 * 1000;

    const refreshFloorSession = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastSessionRefreshAtRef.current < MIN_REFRESH_GAP_MS) return;

      const requestToken = authTokenRef.current;
      if (!requestToken) return;

      try {
        const response = await fetch(`${API_BASE_URL}/api/session/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${requestToken}` },
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (response.status === 401) {
          const latestStoredToken = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
          if (!latestStoredToken || latestStoredToken === requestToken) clearAuthSession(false);
          return;
        }

        // A failed refresh is non-fatal. Keep the current token and retry later.
        if (!response.ok || !data.token) {
          console.warn('Session refresh skipped:', response.status, data);
          return;
        }

        authTokenRef.current = data.token;
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
        lastSessionRefreshAtRef.current = Date.now();

        if (data.user) {
          setCurrentUser(data.user);
          localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data.user));
        }
      } catch (error) {
        console.warn('Session refresh unavailable; keeping the current session.', error);
      }
    };

    // On a restored browser tab the token may already be several hours old.
    refreshFloorSession();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshFloorSession();
    }, PERIODIC_CHECK_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshFloorSession();
    };
    const handleOnline = () => refreshFloorSession();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [isAuthenticated, currentUser?.id, currentUser?.role, currentUser?.mustChangeCredential]);


  const analyticsData = useMemo(() => {
    // IMPORTANT: finding status and ICAR status are two different lifecycles.
    // status      -> Open / Closed
    // icarStatus  -> Locked / Submitted
    const submittedRecords = records.filter(r => r.icarStatus === 'Submitted');
    const categories: Record<string, number> = {};
    const platforms: Record<string, number> = {};
    const mqes: Record<string, number> = {};
    const auditors: Record<string, number> = {};
    const weeklyTrends: Record<string, number> = {};

    const findingStatusCounts = { Open: 0, Closed: 0, 'Not Set': 0 };
    const icarStatusCounts = { Locked: 0, Submitted: 0 };

    records.forEach(record => {
      const findingStatus = getFindingStatus(record);
      if (findingStatus === 'Open') findingStatusCounts.Open++;
      else if (findingStatus === 'Closed') findingStatusCounts.Closed++;
      else findingStatusCounts['Not Set']++;

      if (record.icarStatus === 'Submitted') icarStatusCounts.Submitted++;
      else icarStatusCounts.Locked++;
    });

    submittedRecords.forEach(record => {
      if (record.category) categories[record.category] = (categories[record.category] || 0) + 1;
      if (record.platform) platforms[record.platform] = (platforms[record.platform] || 0) + 1;
      if (record.mqeEngineer) mqes[record.mqeEngineer] = (mqes[record.mqeEngineer] || 0) + 1;
      if (record.auditors) auditors[record.auditors] = (auditors[record.auditors] || 0) + 1;
      const ww = `WW${record.ww || '??'}`;
      weeklyTrends[ww] = (weeklyTrends[ww] || 0) + 1;
    });

    return {
      categories: Object.entries(categories).map(([name, value]) => ({ name, value })),
      platforms: Object.entries(platforms).map(([name, value]) => ({ name, value })),
      findingStatuses: Object.entries(findingStatusCounts).map(([name, value]) => ({ name, value })),
      icarStatuses: Object.entries(icarStatusCounts).map(([name, value]) => ({ name, value })),
      findingStatusCounts,
      icarStatusCounts,
      mqes: Object.entries(mqes).map(([name, value]) => ({ name, value })),
      auditors: Object.entries(auditors).map(([name, value]) => ({ name, value })),
      weeklyTrends: Object.entries(weeklyTrends)
        .map(([name, value]) => ({
          name,
          week: Number(name.replace('WW', '')),
          value
        }))
        .sort((a, b) => a.week - b.week)
        .map(({ name, value }) => ({ name, value }))
    };
  }, [records]);

  const actionCenterData = useMemo(() => {
    const openRecords = records.filter(r => getFindingStatus(r) === 'Open');
    const closedRecords = records.filter(r => getFindingStatus(r) === 'Closed');
    const openOver14 = openRecords.filter(r => getRecordAgeDays(r.auditDate) > 14);
    const openOver30 = openRecords.filter(r => getRecordAgeDays(r.auditDate) > 30);
    const submittedButOpen = openRecords.filter(r => r.icarStatus === 'Submitted');
    const unassignedMqe = records.filter(r => {
      const value = String(r.mqeEngineer || '').trim().toLowerCase();
      return !value || value === 'unassigned' || value === 'not assigned';
    });

    const countBy = (source: IPQCAuditRecord[], key: keyof IPQCAuditRecord) => {
      const counts: Record<string, number> = {};
      source.forEach(record => {
        const value = String(record[key] ?? '').trim();
        if (value) counts[value] = (counts[value] || 0) + 1;
      });
      return Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };

    const oldestOpen = [...openRecords]
      .map(record => ({ record, ageDays: getRecordAgeDays(record.auditDate) }))
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 8);

    const classified = openRecords.length + closedRecords.length;
    const closureRate = classified > 0 ? (closedRecords.length / classified) * 100 : 0;

    return {
      open: openRecords.length,
      closed: closedRecords.length,
      openOver14: openOver14.length,
      openOver30: openOver30.length,
      submittedButOpen: submittedButOpen.length,
      unassignedMqe: unassignedMqe.length,
      closureRate,
      topOpenPlatforms: countBy(openRecords, 'platform').slice(0, 6),
      topOpenCategories: countBy(openRecords, 'category').slice(0, 6),
      oldestOpen,
    };
  }, [records]);

  const DIMENSION_LABELS: Record<'platform' | 'category' | 'mqe' | 'auditor', string> = {
    platform: 'Platform',
    category: 'Category',
    mqe: 'MQE Engineer',
    auditor: 'Auditor'
  };

  const currentDimensionData = useMemo(() => {
    const source = {
      platform: analyticsData.platforms,
      category: analyticsData.categories,
      mqe: analyticsData.mqes,
      auditor: analyticsData.auditors
    }[analyticsDimension];
    return [...source].sort((a, b) => b.value - a.value);
  }, [analyticsData, analyticsDimension]);

  const completeLoginSession = (data: any, successMessage?: string) => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data.user));
    localStorage.removeItem('ipqc_admin_token');
    localStorage.removeItem('ipqc_admin_username');
    authTokenRef.current = data.token;
    lastSessionRefreshAtRef.current = Date.now();
    setAuthToken(data.token);
    setCurrentUser(data.user);
    setShowLoginModal(false);
    setLoginError('');
    setLoginPin('');
    setLoginPassword('');
    setLoginUsername('');
    setShowLoginPassword(false);
    resetAdminMfaFlow();
    setShowCredentialChangeModal(Boolean(data.user.mustChangeCredential));
    if (successMessage) {
      showToast('success', 'Signed in', successMessage);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();

    if (loginMode === 'user') {
      if (!selectedEmployeeId || !/^\d{6}$/.test(loginPin)) {
        setLoginError('Select your name and enter your 6-digit PIN.');
        return;
      }
    } else if (!loginUsername.trim() || !loginPassword) {
      setLoginError('Enter your administrator username and password.');
      return;
    }

    setLoginError('');
    setLoggingIn(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginMode === 'user'
          ? { mode: 'user', employeeId: selectedEmployeeId, pin: loginPin }
          : { mode: 'admin', username: loginUsername.trim(), password: loginPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && loginMode === 'admin' && (data.mfaSetupRequired || data.mfaRequired) && data.challengeToken) {
        setMfaChallengeToken(String(data.challengeToken));
        setMfaAccountLabel(String(data.accountLabel || loginUsername.trim()));
        setMfaSetupKey(String(data.setupKey || ''));
        setMfaOtpAuthUrl(String(data.otpauthUrl || ''));
        setShowMfaSetupKey(false);
        setMfaCode('');
        setAdminMfaStage(data.mfaSetupRequired ? 'setup' : 'verify');
        setLoginPassword('');
        setShowLoginPassword(false);
        return;
      }

      if (response.ok && data.token && data.user) {
        completeLoginSession(
          data,
          loginMode === 'user'
            ? `Welcome, ${data.user.fullName || 'user'}.`
            : 'Administrator authentication completed.'
        );
      } else {
        setLoginError(data.error || (loginMode === 'user'
          ? 'Invalid employee or PIN. Please try again.'
          : 'Invalid administrator credentials. Please try again.'));
      }
    } catch (err) {
      setLoginError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdminMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loginMode !== 'admin' || adminMfaStage === 'credentials' || !mfaChallengeToken) return;
    if (!/^\d{6}$/.test(mfaCode)) {
      setLoginError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setLoginError('');
    setLoggingIn(true);
    try {
      const endpoint = adminMfaStage === 'setup' ? '/api/login/mfa/setup' : '/api/login/mfa/verify';
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token || !data.user) {
        throw new Error(data.error || 'Authenticator verification failed.');
      }
      completeLoginSession(
        data,
        adminMfaStage === 'setup'
          ? 'Authenticator MFA is enabled and your administrator session is ready.'
          : 'Authenticator verification completed successfully.'
      );
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Authenticator verification failed.');
      setMfaCode('');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleCredentialChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!authTokenRef.current || !currentUser || changingCredential) return;

    const isUserPin = currentUser.role === 'user';
    if (isUserPin && !/^\d{6}$/.test(newCredential)) {
      setCredentialChangeError('Choose a 6-digit PIN.');
      return;
    }
    if (!isUserPin && newCredential.length < 12) {
      setCredentialChangeError('Administrator password must be at least 12 characters.');
      return;
    }
    if (newCredential !== confirmCredential) {
      setCredentialChangeError(isUserPin ? 'PINs do not match.' : 'Passwords do not match.');
      return;
    }

    setChangingCredential(true);
    setCredentialChangeError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/change-credential`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authTokenRef.current}`,
        },
        body: JSON.stringify(isUserPin ? { pin: newCredential } : { password: newCredential }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token || !data.user) {
        throw new Error(data.error || 'Could not update your credential.');
      }

      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data.user));
      authTokenRef.current = data.token;
      lastSessionRefreshAtRef.current = Date.now();
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setNewCredential('');
      setConfirmCredential('');
      setShowCredentialChangeModal(false);
      showToast(
        'success',
        isUserPin ? 'PIN updated' : 'Password updated',
        isUserPin ? 'Your new 6-digit PIN is now active.' : 'Your administrator password has been updated.'
      );
    } catch (err) {
      setCredentialChangeError(err instanceof Error ? err.message : 'Could not update your credential.');
    } finally {
      setChangingCredential(false);
    }
  };

  const closeLoginModal = () => {
    if (loggingIn || !isAuthenticated) return;
    setShowLoginModal(false);
    setLoginError('');
    setLoginPin('');
    setLoginPassword('');
    setShowLoginPassword(false);
    resetAdminMfaFlow();
  };

  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    localStorage.removeItem('ipqc_admin_token');
    localStorage.removeItem('ipqc_admin_username');
    authTokenRef.current = null;
    setAuthToken(null);
    setCurrentUser(null);
    setShowCredentialChangeModal(false);
    setSelectedEmployeeId('');
    setLoginPin('');
    resetAdminMfaFlow();
    setShowLoginModal(true);
    setProfileMenuOpen(false);
    setView('ipqc');
  };

  const handleAskAi = async (questionOverride?: string) => {
    const question = (questionOverride ?? aiQuestion).trim();
    if (!question || aiLoading) return;

    shouldScrollToAiResponseRef.current = true;
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    setAiLastQuestion(question);
    setAiQuestion('');

    try {
      const response = await authFetch(`${API_BASE_URL}/api/ai-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'AI Insights could not process this question.');
      }

      setAiResult({
        answer: String(data.answer || 'No answer was returned.'),
        highlights: Array.isArray(data.highlights) ? data.highlights : [],
        filters: data.filters || {},
        caveat: data.caveat || '',
        generatedAt: data.generatedAt || new Date().toISOString(),
      });
    } catch (err) {
      console.error('AI Insights error:', err);
      setAiError(err instanceof Error ? err.message : 'AI Insights is currently unavailable.');
    } finally {
      setAiLoading(false);
    }
  };

  // After a question is submitted, show the progress area, then move the user
  // directly to the completed answer so there is no ambiguity about whether the
  // request is still running or finished.
  useEffect(() => {
    if (!shouldScrollToAiResponseRef.current || !aiLoading) return;
    const frame = window.requestAnimationFrame(() => {
      aiResponseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [aiLoading]);

  useEffect(() => {
    if (!shouldScrollToAiResponseRef.current || aiLoading || (!aiResult && !aiError)) return;
    const timer = window.setTimeout(() => {
      aiResponseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      shouldScrollToAiResponseRef.current = false;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [aiLoading, aiResult, aiError]);

  const getMqeForPlatform = (platform: string) => {
    return mqeMappings[platform as keyof typeof mqeMappings] || 'Unassigned';
  };

  // --- CRUD Handlers for Settings ---
  // Every edit here is persisted to /api/settings immediately so all users
  // see the same list, instead of it living only in this browser tab's memory.
  const [savingSettings, setSavingSettings] = useState(false);
  const saveSettings = async (nextAuditors: string[], nextMqeMappings: Record<string, string>): Promise<boolean> => {
    if (savingSettings) return false;
    setSavingSettings(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditors: nextAuditors, mqeMappings: nextMqeMappings }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'The change could not be saved to the database.');
      }
      if (isAdmin) fetchAuditLog();
      return true;
    } catch (err) {
      console.error('Error saving settings:', err);
      showToast(
        'error',
        'Settings not saved',
        err instanceof Error ? err.message : 'Could not reach the server. Your change was not saved.'
      );
      return false;
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddAuditor = async (e: FormEvent) => {
    e.preventDefault();
    const auditorName = newAuditorName.trim();
    if (!auditorName) {
      showToast('warning', 'Auditor name required', 'Enter an auditor name before adding it.');
      return;
    }
    if (auditorsList.some((name) => name.toLowerCase() === auditorName.toLowerCase())) {
      showToast('info', 'Auditor already exists', `${auditorName} is already in the auditor list.`);
      return;
    }

    const updated = [...auditorsList, auditorName];
    if (await saveSettings(updated, mqeMappings)) {
      setAuditorsList(updated);
      setNewAuditorName('');
      showToast('success', 'Auditor added', `${auditorName} is now available for IPQC findings.`);
    }
  };

  const handleSaveEditAuditor = async (index: number) => {
    const auditorName = editAuditorValue.trim();
    if (!auditorName) {
      showToast('warning', 'Auditor name required', 'The auditor name cannot be blank.');
      return;
    }
    if (auditorsList.some((name, itemIndex) => itemIndex !== index && name.toLowerCase() === auditorName.toLowerCase())) {
      showToast('info', 'Auditor already exists', `${auditorName} is already in the auditor list.`);
      return;
    }

    const previousName = auditorsList[index];
    const updated = [...auditorsList];
    updated[index] = auditorName;
    if (await saveSettings(updated, mqeMappings)) {
      setAuditorsList(updated);
      setEditingAuditorIndex(null);
      showToast('success', 'Auditor updated', `${previousName} was updated to ${auditorName}.`);
    }
  };

  const handleDeleteAuditor = async (auditorToDelete: string) => {
    if (savingSettings) return;
    if (!confirm(`Remove ${auditorToDelete} from the auditor list?`)) return;
    const updated = auditorsList.filter(a => a !== auditorToDelete);
    if (await saveSettings(updated, mqeMappings)) {
      setAuditorsList(updated);
      showToast('success', 'Auditor removed', `${auditorToDelete} was removed from the active auditor list.`);
    }
  };

  const handleAddOrUpdateMqeMapping = async (e: FormEvent) => {
    e.preventDefault();
    const mqeName = newMqeName.trim();
    if (!mqeName) {
      showToast('warning', 'MQE name required', 'Enter the responsible MQE engineer before saving.');
      return;
    }

    const previousOwner = String(mqeMappings[selectedPlatformForMapping] || '').trim();
    if (previousOwner === mqeName) {
      showToast('info', 'No changes to save', `${selectedPlatformForMapping} is already assigned to ${mqeName}.`);
      return;
    }

    const updated = {
      ...mqeMappings,
      [selectedPlatformForMapping]: mqeName
    };
    if (await saveSettings(auditorsList, updated)) {
      setMqeMappings(updated);
      setNewMqeName('');
      showToast(
        'success',
        previousOwner ? 'MQE ownership updated' : 'MQE assigned',
        `${selectedPlatformForMapping} is now assigned to ${mqeName}.`
      );
    }
  };

  const handleClearMqeMapping = async (platform: string) => {
    if (savingSettings) return;
    const previousOwner = mqeMappings[platform];
    if (!previousOwner) {
      showToast('info', 'No MQE assigned', `${platform} does not currently have an MQE owner.`);
      return;
    }
    if (!confirm(`Clear the MQE owner for ${platform}?`)) return;

    const updated = { ...mqeMappings };
    delete updated[platform];
    if (await saveSettings(auditorsList, updated)) {
      setMqeMappings(updated);
      if (selectedPlatformForMapping === platform) setNewMqeName('');
      showToast('success', 'MQE ownership cleared', `${platform} is now unassigned.`);
    }
  };

  const fetchManagedUsers = async () => {
    if (!isAdmin || !authToken) return;
    setUsersLoading(true);
    setUserManagementError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/api/users`);
      const data = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error(data.error || 'Failed to load users.');
      setManagedUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setUserManagementError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchDeletedRecords = async () => {
    if (!isAdmin || !authToken) return;
    setDeletedRecordsLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/deleted-records`);
      const data = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error(data.error || 'Failed to load recycle bin.');
      setDeletedRecords(Array.isArray(data) ? data.map(normalizeRecord) : []);
    } catch (err) {
      console.error('Recycle bin error:', err);
      showToast('error', 'Recycle bin unavailable', err instanceof Error ? err.message : 'Could not load deleted findings.');
    } finally {
      setDeletedRecordsLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'access-audit' && isAdmin && authToken) {
      fetchManagedUsers();
      fetchAuditLog();
      fetchDeletedRecords();
    }
  }, [view, isAdmin, authToken]);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (usersSaving) return;
    setUsersSaving(true);
    setUserManagementError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUserDraft),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to create user.');
      setManagedUsers(prev => [...prev, data].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setNewUserDraft({ fullName: '', employeeId: '', username: '', credential: '', role: 'user', jobTitle: '', department: '' });
      setShowCreateUser(false);
      fetchAuditLog();
      showToast(
        'success',
        data.role === 'admin' ? 'Administrator created' : 'Employee account created',
        `${data.fullName || 'The account'} was created successfully.`
      );
    } catch (err) {
      setUserManagementError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setUsersSaving(false);
    }
  };

  const updateManagedUser = async (user: ManagedUser, patch: Partial<ManagedUser>) => {
    if (usersSaving) return;
    setUsersSaving(true);
    setUserManagementError('');
    try {
      const payload = {
        username: patch.username ?? user.username,
        employeeId: patch.employeeId ?? user.employeeId ?? '',
        fullName: patch.fullName ?? user.fullName,
        role: user.role,
        jobTitle: patch.jobTitle ?? user.jobTitle ?? '',
        department: patch.department ?? user.department ?? '',
        isActive: patch.isActive ?? user.isActive,
      };
      const response = await authFetch(`${API_BASE_URL}/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to update user.');
      setManagedUsers(prev => prev.map(item => item.id === user.id ? data : item));
      if (currentUser?.id === user.id) {
        setCurrentUser(data);
        localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(data));
      }
      fetchAuditLog();
      showToast(
        'success',
        data.isActive ? 'Account activated' : 'Account deactivated',
        `${data.fullName || user.fullName} is now ${data.isActive ? 'active' : 'inactive'}.`
      );
    } catch (err) {
      setUserManagementError(err instanceof Error ? err.message : 'Failed to update user.');
    } finally {
      setUsersSaving(false);
    }
  };

  const handleResetUserCredential = async (e: FormEvent) => {
    e.preventDefault();
    const target = managedUsers.find(user => user.id === resetCredentialUserId);
    if (!target || usersSaving) return;
    const valid = target.role === 'user' ? /^\d{6}$/.test(resetCredentialValue) : resetCredentialValue.length >= 12;
    if (!valid) {
      setUserManagementError(
        target.role === 'user'
          ? 'Temporary PIN must be exactly 6 digits.'
          : 'Temporary administrator password must be at least 12 characters.'
      );
      return;
    }

    setUsersSaving(true);
    setUserManagementError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/api/users/${target.id}/reset-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: resetCredentialValue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to reset credential.');
      setResetCredentialUserId(null);
      setResetCredentialValue('');
      fetchManagedUsers();
      fetchAuditLog();
      showToast(
        'success',
        target.role === 'user' ? 'PIN reset' : 'Password reset',
        `${target.fullName}'s temporary ${target.role === 'user' ? 'PIN' : 'password'} was reset successfully.`
      );
    } catch (err) {
      setUserManagementError(err instanceof Error ? err.message : 'Failed to reset credential.');
    } finally {
      setUsersSaving(false);
    }
  };

  const handleResetAdminMfa = async (user: ManagedUser) => {
    if (usersSaving || user.role !== 'admin' || currentUser?.id === user.id) return;
    if (!confirm(`Reset authenticator MFA for ${user.fullName}?\n\nTheir current sessions will be revoked and they must enrol their authenticator again at next sign-in.`)) return;

    setUsersSaving(true);
    setUserManagementError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/api/users/${user.id}/reset-mfa`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to reset administrator MFA.');
      fetchManagedUsers();
      fetchAuditLog();
      showToast('success', 'MFA reset', `${user.fullName} must enrol an authenticator again at the next sign-in.`);
    } catch (err) {
      setUserManagementError(err instanceof Error ? err.message : 'Failed to reset administrator MFA.');
    } finally {
      setUsersSaving(false);
    }
  };

  const generateTemporaryPin = () => {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    setNewUserDraft(prev => ({ ...prev, credential: pin }));
  };

  // Backfills mqeEngineer on existing records using the current Platform-MQE
  // mapping - fixes records that were added/imported before a platform had
  // a mapping assigned. Only touches records whose stored MQE no longer
  // matches what the current mapping says (so it's safe to re-run anytime).
  const [recalculating, setRecalculating] = useState(false);
  const handleRecalculateMqe = async () => {
    const toFix = records.filter(r => {
      const correctMqe = getMqeForPlatform(r.platform);
      return (r.mqeEngineer || 'Unassigned') !== correctMqe;
    });

    if (toFix.length === 0) {
      showToast('info', 'MQE ownership already in sync', 'All existing records already match the current Platform → MQE ownership rules.');
      return;
    }

    if (!confirm(`This will sync ${toFix.length} existing record(s) with the current Platform → MQE ownership. Continue?`)) {
      return;
    }

    setRecalculating(true);
    let successCount = 0;
    try {
      for (const record of toFix) {
        const correctMqe = getMqeForPlatform(record.platform);
        const response = await authFetch(`${API_BASE_URL}/api/records/${record.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Audit-Source': 'mqe-recalculate',
          },
          body: JSON.stringify({ ...record, mqeEngineer: correctMqe }),
        });
        if (response.ok) successCount++;
      }

      const refreshResponse = await authFetch(`${API_BASE_URL}/api/records`);
      if (refreshResponse.ok) {
        setRecords((await refreshResponse.json()).map(normalizeRecord));
      }

      if (successCount === toFix.length) {
        showToast('success', 'MQE ownership synced', `${successCount} existing record${successCount === 1 ? '' : 's'} updated successfully.`);
      } else {
        showToast('warning', 'MQE sync partially completed', `${successCount} of ${toFix.length} records were updated. Review the remaining records before retrying.`);
      }
    } catch (err) {
      console.error('MQE ownership sync error:', err);
      showToast('error', 'MQE sync failed', 'Something went wrong while syncing existing records. Some records may not have been updated.');
    } finally {
      setRecalculating(false);
    }
  };
  // ----------------------------------

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  
  // Multi-select filters: OR within one filter group, AND across groups.
  // Example: (Platform = Paramount OR Cumulus) AND Status = Open.
  const [filterAuditor, setFilterAuditor] = useState<string[]>([]);
  const [filterDept, setFilterDept] = useState<string[]>([]);
  const [filterFindings, setFilterFindings] = useState('');
  const [filterCategory, setFilterCategory] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]); // Finding status: Open / Closed
  const [filterIcarStatus, setFilterIcarStatus] = useState<string[]>([]); // ICAR status: Locked / Submitted
  const [filterShift, setFilterShift] = useState<string[]>([]);
  const [filterPlatform, setFilterPlatform] = useState<string[]>([]);
  const [filterWW, setFilterWW] = useState<string[]>([]);
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const clearRecordFilters = () => {
    setFilterDate('');
    setFilterAuditor([]);
    setFilterFindings('');
    setFilterDept([]);
    setFilterCategory([]);
    setFilterStatus([]);
    setFilterIcarStatus([]);
    setFilterShift([]);
    setFilterPlatform([]);
    setSearchQuery('');
    setFilterWW([]);
  };

  const openRecordPreset = (preset: AIInsightFilters = {}) => {
    clearRecordFilters();
    setSelectedRecord(null);

    if (preset.status) setFilterStatus([preset.status]);
    if (preset.icarStatus) setFilterIcarStatus([preset.icarStatus]);
    if (preset.platform) setFilterPlatform([preset.platform]);
    if (preset.category) setFilterCategory([preset.category]);
    if (preset.auditor) setFilterAuditor([preset.auditor]);
    if (preset.department) setFilterDept([preset.department]);
    if (preset.ww) setFilterWW([String(preset.ww)]);

    // MQE is not a dedicated table filter in the current records view, so
    // reuse global search for a model-suggested MQE drill-down.
    if (preset.mqe) setSearchQuery(preset.mqe);

    setFiltersOpen(Boolean(
      preset.status || preset.icarStatus || preset.platform || preset.category ||
      preset.auditor || preset.department || preset.ww || preset.mqe
    ));
    setView('ipqc');
  };

  // A fresh Add Finding form must never inherit an old record or silently
  // preselect operational values. Only true system defaults are populated:
  // today's date, auto WW, Finding=Open and ICAR=N/A/Locked.
  const createEmptyAudit = (): Partial<IPQCAuditRecord> => {
    const today = getTodayLocalISO();
    return {
      no: undefined,
      auditDate: today,
      ww: calculateWW(today),
      shift: '',
      auditors: '',
      personOnJob: '',
      department: '',
      platform: '',
      areaStation: '',
      groupFinding: '',
      category: '',
      detailsFindings: '',
      remark: '',
      status: 'Open',
      icarNum: 'N/A',
      icarStatus: 'Locked',
      mqeEngineer: '',
      picture: '',
    };
  };

  const [newAudit, setNewAudit] = useState<Partial<IPQCAuditRecord>>(() => createEmptyAudit());
  const [auditSaving, setAuditSaving] = useState(false);

  const categoryOptionsForForm = useMemo(() => {
    const current = String(newAudit.category || '').trim();
    return current && !CATEGORIES.includes(current) ? [current, ...CATEGORIES] : CATEGORIES;
  }, [newAudit.category]);

  const findingDetailOptionsForForm = useMemo(() => {
    const category = String(newAudit.category || '').trim();
    const currentDetail = String(newAudit.detailsFindings || '').trim();
    const mapped = FINDING_DETAILS_BY_CATEGORY[category] || [];
    return currentDetail && !mapped.includes(currentDetail) ? [currentDetail, ...mapped] : mapped;
  }, [newAudit.category, newAudit.detailsFindings]);

  // Keep the stored WW when an existing record is opened. Recalculate WW only
  // when the user deliberately changes the audit date, so View and Edit never
  // show different work weeks for the same saved record.
  const handleAuditDateChange = (auditDate: string) => {
    setNewAudit(prev => ({
      ...prev,
      auditDate,
      ww: auditDate ? calculateWW(auditDate) : '',
    }));
  };

  const handleCategoryChange = (cat: string) => {
    setNewAudit(prev => ({
      ...prev,
      category: cat,
      groupFinding: CATEGORY_GROUP_MAPPING[cat] || '',
      detailsFindings: '',
    }));
  };

  const handlePlatformChange = (plat: string) => {
    setNewAudit(prev => ({
      ...prev,
      platform: plat,
      mqeEngineer: plat ? getMqeForPlatform(plat) : ''
    }));
  };

  const handleIcarNumChange = (num: string) => {
    const trimmed = num.trim();
    const hasIcarNumber = trimmed !== '' && trimmed.toUpperCase() !== 'N/A';
    setNewAudit(prev => ({
      ...prev,
      icarNum: num,
      icarStatus: hasIcarNumber ? 'Submitted' : 'Locked'
    }));
  };

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchesSearch = searchQuery === '' || Object.values(r).some(value => 
        value !== null && value !== undefined && String(value).toLowerCase().includes(searchQuery.toLowerCase())
      );
      
      const matchesAuditor = filterAuditor.length === 0 || filterAuditor.includes(String(r.auditors || ''));
      const matchesDept = filterDept.length === 0 || filterDept.includes(String(r.department || ''));
      const matchesFindings = !filterFindings || String(r.groupFinding) === String(filterFindings);
      const matchesDate = !filterDate || String(r.auditDate) === String(filterDate);
      const matchesWW = filterWW.length === 0 || filterWW.includes(String(r.ww || ''));
      const matchesCategory = filterCategory.length === 0 || filterCategory.includes(String(r.category || ''));
      const matchesStatus = filterStatus.length === 0 || filterStatus.includes(getFindingStatus(r));
      const matchesIcarStatus = filterIcarStatus.length === 0 || filterIcarStatus.includes(String(r.icarStatus || 'Locked'));
      const matchesShift = filterShift.length === 0 || filterShift.includes(String(r.shift || ''));
      const matchesPlatform = filterPlatform.length === 0 || filterPlatform.includes(String(r.platform || ''));

      return matchesSearch && matchesAuditor && matchesDept && matchesFindings && 
             matchesDate && matchesWW && matchesCategory && matchesStatus && matchesIcarStatus && 
             matchesShift && matchesPlatform;
    });
  }, [records, searchQuery, filterAuditor, filterDept, filterFindings, filterDate, filterWW, filterCategory, filterStatus, filterIcarStatus, filterShift, filterPlatform]);

  // Pagination - client-side slice of the already-filtered records. Resets
  // to page 1 whenever the filtered set changes (new search/filter), so
  // users don't get stranded on an empty page.
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterAuditor, filterDept, filterFindings, filterDate, filterWW, filterCategory, filterStatus, filterIcarStatus, filterShift, filterPlatform, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Briefly highlights + scrolls to a record right after it's created or
  // edited, so the change is visibly confirmed instead of silently landing
  // somewhere in a 500+ row table.
  const [highlightedId, setHighlightedId] = useState<string | number | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (highlightedId === null || view !== 'ipqc') return;

    const idx = filteredRecords.findIndex(r => String(r.id) === String(highlightedId));
    if (idx === -1) return; // hidden by active filters - nothing to scroll to

    setCurrentPage(Math.floor(idx / pageSize) + 1);

    // The row may not exist in the DOM yet - the 'add-audit' view has to
    // finish its exit animation (AnimatePresence mode="wait") before the
    // ipqc table even mounts, and the page-size slice above needs its own
    // render too. Poll for the ref instead of guessing a fixed delay.
    let frame: number;
    let attempts = 0;
    const tryScroll = () => {
      const el = rowRefs.current[String(highlightedId)];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (attempts < 60) { // ~1s ceiling at 60fps
        attempts++;
        frame = requestAnimationFrame(tryScroll);
      }
    };
    frame = requestAnimationFrame(tryScroll);

    const clearTimer = setTimeout(() => setHighlightedId(null), 2600);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(clearTimer);
    };
  }, [highlightedId, view]);


  const [selectedRecord, setSelectedRecord] = useState<IPQCAuditRecord | null>(null);
  const [selectedRecordHistory, setSelectedRecordHistory] = useState<AuditLogEntry[]>([]);
  const [recordHistoryLoading, setRecordHistoryLoading] = useState(false);
  const [recordVersions, setRecordVersions] = useState<RecordVersion[]>([]);
  const [recordVersionsLoading, setRecordVersionsLoading] = useState(false);
  const [openRowAction, setOpenRowAction] = useState<string | number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedRecord?.id || !authToken) {
      setSelectedRecordHistory([]);
      setRecordVersions([]);
      setRecordHistoryLoading(false);
      setRecordVersionsLoading(false);
      return;
    }

    let cancelled = false;
    const loadHistory = async () => {
      setRecordHistoryLoading(true);
      try {
        const response = await authFetch(`${API_BASE_URL}/api/records/${selectedRecord.id}/history`);
        const data = await response.json().catch(() => ([]));
        if (!cancelled && response.ok) setSelectedRecordHistory(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setSelectedRecordHistory([]);
      } finally {
        if (!cancelled) setRecordHistoryLoading(false);
      }
    };

    const loadVersions = async () => {
      setRecordVersionsLoading(true);
      try {
        const response = await authFetch(`${API_BASE_URL}/api/records/${selectedRecord.id}/versions`);
        const data = await response.json().catch(() => ([]));
        if (!cancelled && response.ok) setRecordVersions(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRecordVersions([]);
      } finally {
        if (!cancelled) setRecordVersionsLoading(false);
      }
    };

    loadHistory();
    loadVersions();
    return () => { cancelled = true; };
  }, [selectedRecord?.id, authToken]);

  const handleOpenAddFinding = () => {
    setEditingId(null);
    setSelectedRecord(null);
    setOpenRowAction(null);
    setNewAudit(createEmptyAudit());
    if (fileInputRef.current) fileInputRef.current.value = '';
    setView('add-audit');
  };

  const handleCloseAuditForm = () => {
    setEditingId(null);
    setNewAudit(createEmptyAudit());
    if (fileInputRef.current) fileInputRef.current.value = '';
    setView('ipqc');
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewAudit(prev => ({ ...prev, picture: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddAudit = async (e: FormEvent) => {
    e.preventDefault();
    if (auditSaving) return;

    const enteredIcarNumber = String(newAudit.icarNum ?? '').trim();
    const hasIcarNumber = enteredIcarNumber !== '' && enteredIcarNumber.toUpperCase() !== 'N/A';

    const payload = {
      ...newAudit,
      groupFinding: CATEGORY_GROUP_MAPPING[newAudit.category || ''] || '',
      // Date changes already recalculate WW. Keeping the current WW here avoids
      // silently changing a stored historical WW when an existing record is edited.
      ww: newAudit.ww || (newAudit.auditDate ? calculateWW(newAudit.auditDate) : ''),
      status: normalizeFindingStatus(newAudit.status) || 'Open',
      icarNum: hasIcarNumber ? enteredIcarNumber : 'N/A',
      icarStatus: hasIcarNumber ? 'Submitted' : 'Locked'
    };

    setAuditSaving(true);
    try {
      if (editingId) {
        const response = await authFetch(`${API_BASE_URL}/api/records/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          showToast('error', 'Finding not updated', data.error || 'Your changes could not be saved. The form has been kept so you can retry.');
          return;
        }

        const updated = normalizeRecord(data);
        setRecords(records.map(r => String(r.id) === String(editingId) ? updated : r));
        setHighlightedId(updated.id);
        showToast('success', 'Finding updated', `Finding #${updated.no ?? updated.id} was updated successfully.`);
      } else {
        const response = await authFetch(`${API_BASE_URL}/api/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          showToast('error', 'Finding not added', data.error || 'The finding could not be saved. The form has been kept so you can retry.');
          return;
        }

        const created = normalizeRecord(data);
        setRecords([...records, created]);
        setHighlightedId(created.id);
        showToast('success', 'Finding added', `Finding #${created.no ?? created.id} was saved successfully.`);
      }

      setNewAudit(createEmptyAudit());
      setEditingId(null);
      setView('ipqc');

      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error('Error submitting audit:', error);
      showToast('error', editingId ? 'Finding not updated' : 'Finding not added', 'A network error occurred while contacting the server. Your form has been kept so you can retry.');
    } finally {
      setAuditSaving(false);
    }
  };

  const handleEditClick = (record: IPQCAuditRecord) => {
    setNewAudit({
      no: record.no,
      auditDate: record.auditDate || '',
      ww: record.ww || '',
      shift: record.shift || '',
      auditors: record.auditors || '',
      personOnJob: record.personOnJob || '',
      department: record.department || '',
      platform: record.platform || '',
      areaStation: record.areaStation || '',
      groupFinding: record.groupFinding || '',
      category: record.category || '',
      detailsFindings: record.detailsFindings || '',
      remark: record.remark || '',
      status: getFindingStatus(record) || '',
      icarNum: record.icarNum || 'N/A',
      icarStatus: record.icarStatus || 'Locked',
      mqeEngineer: record.mqeEngineer || '',
      picture: record.picture || '',
    });
    setEditingId(record.id);
    setView('add-audit');
  };

  const handleDeleteRecord = async (id: string) => {
    const actor = currentUser?.fullName || currentUser?.username || 'Current user';
    if (confirm(`Move this finding to the recycle bin?\n\nRecorded as: ${actor}\n\nThe record can be restored by an administrator and its version history will be retained.`)) {
      try {
        const response = await authFetch(`${API_BASE_URL}/api/records/${id}`, { method: 'DELETE' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          showToast('error', 'Finding not moved', data.error || 'Failed to move the finding to the recycle bin.');
          return;
        }
        setRecords(prev => prev.filter(r => String(r.id) !== String(id)));
        if (isAdmin) fetchDeletedRecords();
        showToast('success', 'Moved to recycle bin', 'The finding was removed from active records and can be restored by an administrator.');
      } catch (err) {
        showToast('error', 'Finding not moved', 'Failed to move the finding to the recycle bin.');
      }
    }
  };

  const handleRestoreDeletedRecord = async (record: IPQCAuditRecord) => {
    if (!isAdmin || !record.id) return;
    if (!confirm(`Restore Finding #${record.no ?? record.id} from the recycle bin?`)) return;
    try {
      const response = await authFetch(`${API_BASE_URL}/api/records/${record.id}/restore`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to restore record.');
      const restored = normalizeRecord(data);
      setRecords(prev => [...prev.filter(item => String(item.id) !== String(restored.id)), restored]
        .sort((a, b) => Number(a.id) - Number(b.id)));
      setDeletedRecords(prev => prev.filter(item => String(item.id) !== String(record.id)));
      fetchAuditLog();
      showToast('success', 'Finding restored', `Finding #${restored.no ?? restored.id} is active again.`);
    } catch (err) {
      showToast('error', 'Restore failed', err instanceof Error ? err.message : 'Failed to restore the finding.');
    }
  };

  const handleRestoreRecordVersion = async (version: RecordVersion) => {
    if (!isAdmin || !selectedRecord?.id) return;
    if (!confirm(`Restore Finding #${selectedRecord.no ?? selectedRecord.id} to version ${version.versionNo}?\n\nThe current state will remain in version history.`)) return;
    try {
      const response = await authFetch(`${API_BASE_URL}/api/records/${selectedRecord.id}/versions/${version.versionNo}/restore`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to restore version.');
      const restored = normalizeRecord(data);
      setSelectedRecord(restored);
      setRecords(prev => prev.map(item => String(item.id) === String(restored.id) ? restored : item));
      const versionsResponse = await authFetch(`${API_BASE_URL}/api/records/${restored.id}/versions`);
      const versionsData = await versionsResponse.json().catch(() => ([]));
      if (versionsResponse.ok) setRecordVersions(Array.isArray(versionsData) ? versionsData : []);
      fetchAuditLog();
      showToast('success', 'Version restored', `Finding #${restored.no ?? restored.id} was restored to version ${version.versionNo}.`);
    } catch (err) {
      showToast('error', 'Version restore failed', err instanceof Error ? err.message : 'Failed to restore this version.');
    }
  };

  const formatImportFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateImportFile = (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['xlsx', 'xls'].includes(extension)) {
      return 'Please select a valid Excel workbook (.xlsx or .xls).';
    }
    if (file.size > 10 * 1024 * 1024) {
      return 'The selected file is larger than 10 MB.';
    }
    return '';
  };

  const selectImportFile = (file: File | null) => {
    if (!file) return;
    const validationError = validateImportFile(file);
    if (validationError) {
      setSelectedImportFile(null);
      setImportFileError(validationError);
      if (importFileInputRef.current) importFileInputRef.current.value = '';
      return;
    }
    setSelectedImportFile(file);
    setImportFileError('');
    setImportProgress({ current: 0, total: 0 });
  };

  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    selectImportFile(e.target.files?.[0] || null);
  };

  const handleImportDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImportDragActive(false);
    if (importing) return;
    selectImportFile(e.dataTransfer.files?.[0] || null);
  };

  const clearImportFile = () => {
    if (importing) return;
    setSelectedImportFile(null);
    setImportFileError('');
    setImportProgress({ current: 0, total: 0 });
    if (importFileInputRef.current) importFileInputRef.current.value = '';
  };

  const closeImportModal = () => {
    if (importing) return;
    setShowImportModal(false);
    setImportDragActive(false);
    clearImportFile();
  };

  const handleExcelImportProcess = async () => {
    const file = selectedImportFile;
    if (!file) {
      setImportFileError('Choose an Excel workbook before starting the import.');
      return;
    }

    const validationError = validateImportFile(file);
    if (validationError) {
      setImportFileError(validationError);
      return;
    }

    setImportFileError('');
    setImporting(true);
    setImportProgress({ current: 0, total: 0 });

    try {
      const importedRows = await importFromExcel(file);
      if (!Array.isArray(importedRows) || importedRows.length === 0) {
        throw new Error('No importable rows were found in this workbook.');
      }

      let successCount = 0;
      let failedCount = 0;
      setImportProgress({ current: 0, total: importedRows.length });

      for (let index = 0; index < importedRows.length; index++) {
        const row = importedRows[index];
        const importedStatus = normalizeFindingStatus(
          (row as any).status ?? (row as any).Status ?? (row as any).findingStatus ?? (row as any).finding_status
        );

        const payload = {
          no: row.no,
          auditDate: row.auditDate || new Date().toISOString().split('T')[0],
          ww: row.ww || calculateWW(row.auditDate || new Date().toISOString().split('T')[0]),
          shift: row.shift || SHIFTS[0],
          auditors: row.auditors || INITIAL_AUDITORS[0],
          personOnJob: row.personOnJob || '',
          department: row.department || DEPARTMENTS[0],
          platform: row.platform || PLATFORMS[0],
          areaStation: row.areaStation || '',
          groupFinding: row.groupFinding || (row.category ? CATEGORY_GROUP_MAPPING[row.category] || '' : ''),
          category: row.category || '',
          detailsFindings: row.detailsFindings || '',

          remark: row.remark || '',
          status: importedStatus || 'Open',
          icarNum: row.icarNum || 'N/A',
          icarStatus: row.icarStatus || 'Locked',
          mqeEngineer: row.mqeEngineer || getMqeForPlatform(row.platform || PLATFORMS[0]),
          picture: row.picture || null
        };

        const response = await authFetch(`${API_BASE_URL}/api/records`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Audit-Source': 'excel-import',
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) successCount++;
        else failedCount++;

        setImportProgress({ current: index + 1, total: importedRows.length });
      }

      const refreshResponse = await authFetch(`${API_BASE_URL}/api/records`);
      if (refreshResponse.ok) {
        const latestData = await refreshResponse.json();
        setRecords(Array.isArray(latestData) ? latestData.map(normalizeRecord) : []);
      }

      if (failedCount > 0) {
        showToast('warning', 'Import partially completed', `${successCount} saved, ${failedCount} failed. Review the failed rows before retrying.`, 6500);
      } else {
        showToast('success', 'Import completed', `${successCount} record${successCount === 1 ? '' : 's'} saved successfully.`);
      }

      setShowImportModal(false);
      setSelectedImportFile(null);
      setImportProgress({ current: 0, total: 0 });
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    } catch (err) {
      console.error('Import error:', err);
      const message = err instanceof Error ? err.message : 'The workbook could not be processed. Check its format and try again.';
      setImportFileError(message);
      showToast('error', 'Import failed', message);
    } finally {
      setImporting(false);
    }
  };

  const handleExcelExport = async () => {
    if (exportingExcel) return;

    setExportingExcel(true);
    try {
      const result = await exportToExcel(records);

      if (result.failedImages > 0) {
        showToast(
          'warning',
          'Excel exported with photo warnings',
          `${result.embeddedImages} photo${result.embeddedImages === 1 ? '' : 's'} embedded; ${result.failedImages} could not be loaded into the workbook.`,
          6000
        );
      } else {
        showToast(
          'success',
          'Excel export completed',
          result.embeddedImages > 0
            ? `${records.length} records exported with ${result.embeddedImages} embedded photo${result.embeddedImages === 1 ? '' : 's'}.`
            : `${records.length} record${records.length === 1 ? '' : 's'} exported successfully.`
        );
      }
    } catch (err) {
      console.error('Excel export error:', err);
      showToast('error', 'Excel export failed', err instanceof Error ? err.message : 'The Excel workbook could not be exported.');
    } finally {
      setExportingExcel(false);
    }
  };

  // Header title changes with the active tab, replacing the old static
  // "IPQC TRACKER" label + the separate "IPQC Records Management" panel
  // that used to repeat the same info and eat vertical space.
  const viewTitles: Record<string, string> = {
    dashboard: 'Analytics Dashboard',
    ipqc: 'IPQC Records',
    import: 'Import Records',
    checklist: 'Checklist',
    'add-audit': editingId ? 'Edit Finding' : 'Add Finding',
    history: 'History',
    'action-center': 'Admin Action Center',
    'ai-insights': 'AI Insights',
    'access-audit': 'Access & Audit',
    'quality-config': 'Quality Configuration',
  };
  const headerTitle = view === 'ipqc' && selectedRecord ? 'Finding Details' : (viewTitles[view] || 'IPQC Tracker');
  // Count active filter GROUPS, not individual checked values.
  const activeFilterCount = [
    filterAuditor.length > 0,
    filterDept.length > 0,
    Boolean(filterFindings),
    filterCategory.length > 0,
    filterStatus.length > 0,
    filterIcarStatus.length > 0,
    filterShift.length > 0,
    filterPlatform.length > 0,
    filterWW.length > 0,
    Boolean(filterDate),
  ].filter(Boolean).length;
  const hasActiveQuery = searchQuery.trim().length > 0 || activeFilterCount > 0;

  return (
    <div className="flex h-screen bg-bg-main font-sans text-text-main">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      <aside className={`fixed md:static inset-y-0 left-0 z-50 bg-sidebar-bg transition-[width,transform] duration-300 ease-out flex flex-col shrink-0 overflow-hidden ${sidebarOpen ? 'w-[232px] translate-x-0' : 'w-0 -translate-x-full md:w-[84px] md:translate-x-0'}`}>
        <div className={`h-[76px] border-b border-white/5 flex items-center gap-3 shrink-0 transition-all duration-300 ${sidebarOpen ? 'px-5' : 'px-0 md:justify-center'}`}>
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-white shrink-0 flex items-center justify-center shadow-sm ring-1 ring-white/10">
            <img
              src="/AE.png"
              alt="IPQC Tracker logo"
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>

          {sidebarOpen && (
            <div className="min-w-0">
              <h1 className="font-black text-[13px] tracking-[0.14em] text-white uppercase whitespace-nowrap">
                IPQC TRACKER
              </h1>
              <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500 whitespace-nowrap">
                Quality Management
              </p>
            </div>
          )}
        </div>

        <nav className={`flex-1 overflow-y-auto custom-scrollbar transition-all duration-300 ${sidebarOpen ? 'px-3 py-5' : 'px-2 py-5'}`}>
          {sidebarOpen ? (
            <div className="px-3 pb-2">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.22em]">Insights</span>
            </div>
          ) : (
            <div className="mx-3 mb-3 h-px bg-white/[0.07]" aria-hidden="true" />
          )}
          <NavItem 
            icon={<LayoutDashboard size={18} />} 
            label="Analytics" 
            active={view === 'dashboard'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => { setView('dashboard'); if (window.innerWidth < 768) setSidebarOpen(false); }}
          />

          {sidebarOpen ? (
            <div className="px-3 pt-5 pb-2">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.22em]">Operations</span>
            </div>
          ) : (
            <div className="mx-3 my-4 h-px bg-white/[0.07]" aria-hidden="true" />
          )}
          <NavItem 
            icon={<ClipboardCheck size={18} />} 
            label="IPQC Records" 
            active={view === 'ipqc'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => { setSelectedRecord(null); setView('ipqc'); if (window.innerWidth < 768) setSidebarOpen(false); }}
          />

          {sidebarOpen ? (
            <div className="px-3 pt-5 pb-2">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.22em]">Administration</span>
            </div>
          ) : (
            <div className="mx-3 my-4 h-px bg-white/[0.07]" aria-hidden="true" />
          )}
          <NavItem 
            icon={isAdmin ? <AlertCircle size={18} /> : <Lock size={18} />} 
            label="Action Center" 
            active={view === 'action-center'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            disabled={!isAdmin}
            onClick={() => {
              setView('action-center');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />
          <NavItem 
            icon={isAdmin ? <Sparkles size={18} /> : <Lock size={18} />} 
            label="AI Insights" 
            active={view === 'ai-insights'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            disabled={!isAdmin}
            onClick={() => {
              setView('ai-insights');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />
          <NavItem 
            icon={isAdmin ? <ShieldCheck size={18} /> : <Lock size={18} />} 
            label="Access & Audit" 
            active={view === 'access-audit'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            disabled={!isAdmin}
            onClick={() => {
              setView('access-audit');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />
          <NavItem 
            icon={isAdmin ? <SlidersHorizontal size={18} /> : <Lock size={18} />} 
            label="Quality Configuration" 
            active={view === 'quality-config'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            disabled={!isAdmin}
            onClick={() => {
              setView('quality-config');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />

        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between sticky top-0 z-10 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-slate-50 rounded-lg transition-all text-slate-500 hover:text-brand-orange hover:shadow-sm shrink-0"
            >
              <Menu size={20} />
            </button>
            <h2 className="text-sm md:text-lg font-black text-slate-800 uppercase tracking-tight truncate">{headerTitle}</h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative" ref={profileMenuRef}>
              <button
                onClick={() => setProfileMenuOpen(o => !o)}
                className="flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 rounded-full border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors"
                aria-label="Account menu"
              >
                <div className={`relative w-8 h-8 rounded-full flex items-center justify-center text-white font-black text-xs shrink-0 ${isAdmin ? 'bg-emerald-500' : isAuthenticated ? 'bg-slate-700' : 'bg-slate-400'}`}>
                  {currentUser ? (currentUser.fullName || currentUser.username).charAt(0).toUpperCase() : <User size={16} />}
                  {isAuthenticated && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white" />
                  )}
                </div>
                <ChevronDown size={14} className={`hidden sm:block text-slate-400 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {profileMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden z-50"
                  >
                    <div className="p-4 flex items-center gap-3 border-b border-slate-100 bg-slate-50/60">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0 ${isAdmin ? 'bg-emerald-500' : isAuthenticated ? 'bg-slate-700' : 'bg-slate-400'}`}>
                        {currentUser ? (currentUser.fullName || currentUser.username).charAt(0).toUpperCase() : <User size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-800 truncate">{currentUser?.fullName || currentUser?.username || 'Not signed in'}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${isAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                            {isAdmin ? 'Admin' : 'User'}
                          </span>
                          {currentUser?.jobTitle && <span className="truncate text-[10px] font-semibold text-slate-400">{currentUser.jobTitle}</span>}
                          {currentUser?.role === 'user' && currentUser.employeeId && <span className="truncate font-mono text-[9px] font-semibold text-slate-400">ID {currentUser.employeeId}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="p-2">
                      {isAuthenticated ? (
                        <button
                          onClick={logout}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors text-[11px] font-black uppercase tracking-widest"
                        >
                          <LogOut size={15} /> Sign Out
                        </button>
                      ) : (
                        <button
                          onClick={() => { setShowLoginModal(true); setProfileMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors text-[11px] font-black uppercase tracking-widest"
                        >
                          <LogIn size={15} /> Sign In
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main ref={mainScrollRef} className="flex-1 overflow-y-auto p-5 md:p-6 min-h-0 bg-[#f6f8fb] flex flex-col">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 pb-20 custom-scrollbar"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-lg border border-border-subtle">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-widest text-text-muted">Analytics Dashboard</h3>
                    <p className="text-[10px] text-text-muted/60 font-bold uppercase mt-0.5">Real-time lifecycle, ICAR and submitted-finding insights</p>
                  </div>
                  <div className="flex bg-bg-main p-1 rounded-md border border-border-subtle w-full sm:w-auto">
                    <button 
                      onClick={() => setDashboardMode('system')}
                      className={`flex-1 sm:flex-none px-4 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${dashboardMode === 'system' ? 'bg-white shadow-sm text-brand-orange' : 'text-text-muted hover:text-text-main'}`}
                    >
                      App Charts
                    </button>
                    <button 
                      onClick={() => setDashboardMode('powerbi')}
                      className={`flex-1 sm:flex-none px-4 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${dashboardMode === 'powerbi' ? 'bg-white shadow-sm text-brand-orange' : 'text-text-muted hover:text-text-main'}`}
                    >
                      Power BI Live
                    </button>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {dashboardMode === 'system' ? (
                    <motion.div 
                      key="system-dash"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-6"
                    >
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <KPICard
                          icon={<ClipboardCheck size={16} className="text-blue-500" />}
                          label="Total Findings"
                          value={records.length}
                          trend="All Records"
                          color="blue"
                        />
                        <KPICard
                          icon={<AlertCircle size={16} className="text-orange-500" />}
                          label="Open Findings"
                          value={analyticsData.findingStatusCounts.Open}
                          trend="Requires Action"
                          color="orange"
                        />
                        <KPICard
                          icon={<CheckCircle2 size={16} className="text-emerald-500" />}
                          label="Closed Findings"
                          value={analyticsData.findingStatusCounts.Closed}
                          trend="Resolved"
                          color="emerald"
                        />
                        <KPICard
                          icon={<Unlock size={16} className="text-slate-600" />}
                          label="Submitted ICARs"
                          value={analyticsData.icarStatusCounts.Submitted}
                          trend="ICAR Issued"
                          color="slate"
                        />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm h-[500px] flex flex-col">
                          <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
                            <TrendingUp size={14} className="text-brand-orange" />
                            Submitted Findings Trend (by Work Week)
                          </h3>
                          <div className="flex-1 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={analyticsData.weeklyTrends} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                                <defs>
                                  <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#F15D22" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#F15D22" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis 
                                  dataKey="name" 
                                  axisLine={false} 
                                  tickLine={false} 
                                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                                  dy={10}
                                />
                                <YAxis 
                                  axisLine={false} 
                                  tickLine={false} 
                                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                                />
                                <RechartsTooltip 
                                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 700 }}
                                />
                                <Area 
                                  type="monotone" 
                                  dataKey="value" 
                                  stroke="#F15D22" 
                                  fillOpacity={1} 
                                  fill="url(#colorTrend)" 
                                  strokeWidth={3}
                                  name="Finding Count"
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="flex h-[500px] flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em]">Finding Status Breakdown</h3>
                              <p className="mt-1.5 text-[10px] font-medium text-slate-400">Open and closed reflect the finding lifecycle, not ICAR status.</p>
                            </div>
                            {analyticsData.findingStatusCounts['Not Set'] > 0 && (
                              <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                                {analyticsData.findingStatusCounts['Not Set']} not set
                              </span>
                            )}
                          </div>

                          <div className="h-[285px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={analyticsData.findingStatuses}
                                  innerRadius={72}
                                  outerRadius={104}
                                  paddingAngle={5}
                                  dataKey="value"
                                  stroke="none"
                                >
                                  {analyticsData.findingStatuses.map((entry) => (
                                    <Cell
                                      key={entry.name}
                                      fill={entry.name === 'Open' ? '#f59e0b' : entry.name === 'Closed' ? '#10b981' : '#cbd5e1'}
                                    />
                                  ))}
                                </Pie>
                                <RechartsTooltip
                                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 8px 20px rgb(15 23 42 / 0.08)', fontSize: '11px', fontWeight: 700 }}
                                />
                                <Legend
                                  verticalAlign="bottom"
                                  height={30}
                                  iconType="circle"
                                  formatter={(value) => <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{value}</span>}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="mt-auto border-t border-slate-100 pt-4">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">ICAR progress</p>
                              <p className="text-[9px] font-medium text-slate-400">Separate corrective-action lifecycle</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2.5">
                                <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Locked</p>
                                <p className="mt-1 text-lg font-black text-slate-800">{analyticsData.icarStatusCounts.Locked}</p>
                              </div>
                              <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5">
                                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">Submitted</p>
                                <p className="mt-1 text-lg font-black text-slate-800">{analyticsData.icarStatusCounts.Submitted}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                          <div>
                            <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                              <Layers size={14} className="text-brand-orange" />
                              Findings Breakdown by {DIMENSION_LABELS[analyticsDimension]}
                            </h3>
                            {currentDimensionData.length > 0 && (
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">
                                Highest: <span className="text-brand-orange">{currentDimensionData[0].name}</span> &middot; {currentDimensionData[0].value} Submitted Finding{currentDimensionData[0].value === 1 ? '' : 's'}
                              </p>
                            )}
                          </div>
                          <div className="flex bg-bg-main p-1 rounded-md border border-border-subtle w-full sm:w-auto overflow-x-auto">
                            {(Object.keys(DIMENSION_LABELS) as Array<'platform' | 'category' | 'mqe' | 'auditor'>).map(dim => (
                              <button
                                key={dim}
                                onClick={() => setAnalyticsDimension(dim)}
                                className={`flex-1 sm:flex-none px-4 py-1.5 rounded text-[10px] font-bold uppercase whitespace-nowrap transition-all ${
                                  analyticsDimension === dim ? 'bg-white shadow-sm text-brand-orange' : 'text-text-muted hover:text-text-main'
                                }`}
                              >
                                {DIMENSION_LABELS[dim]}
                              </button>
                            ))}
                          </div>
                        </div>

                        {currentDimensionData.length === 0 ? (
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center py-12">
                            No submitted findings yet for this breakdown.
                          </p>
                        ) : (
                          <div style={{ height: Math.max(240, currentDimensionData.length * 40) }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={currentDimensionData}
                                layout="vertical"
                                margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis
                                  type="number"
                                  allowDecimals={false}
                                  axisLine={false}
                                  tickLine={false}
                                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                                />
                                <YAxis
                                  type="category"
                                  dataKey="name"
                                  axisLine={false}
                                  tickLine={false}
                                  width={150}
                                  tick={{ fontSize: 10, fontWeight: 700, fill: '#334155' }}
                                />
                                <RechartsTooltip
                                  cursor={{ fill: '#f8fafc' }}
                                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 700 }}
                                />
                                <Bar dataKey="value" name="Submitted Findings" fill="#F15D22" radius={[0, 6, 6, 0]} maxBarSize={22} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="powerbi-dash"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="w-full h-[600px] bg-white rounded-lg border border-border-subtle overflow-hidden relative"
                    >
                      {powerBiUrl ? (
                        <iframe 
                          title="Power BI Report" 
                          className="w-full h-full border-none"
                          src={powerBiUrl} 
                          allowFullScreen={true}
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                          <div className="w-16 h-16 bg-bg-main text-brand-orange rounded-full flex items-center justify-center mb-6">
                            <LayoutDashboard size={32} />
                          </div>
                          <h3 className="text-lg font-bold">Power BI Connection Ready</h3>
                          <p className="max-w-md text-xs text-text-muted mt-2 leading-relaxed">
                            You can directly embed your organizational Power BI reports here for enterprise-grade analytics and deeper data slicing.
                          </p>
                          <div className="mt-8 w-full max-w-sm">
                            <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 block text-left pl-1">Embed URL</label>
                            <input 
                              type="text" 
                              placeholder="Paste your Power BI Publish URL here..."
                              className="w-full bg-slate-50 border border-border-subtle rounded-lg p-3 text-xs focus:border-brand-orange outline-none transition-all"
                              value={powerBiUrl}
                              onChange={(e) => setPowerBiUrl(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {view === 'ipqc' && (
              <motion.div
                key="ipqc"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col min-h-0 space-y-3"
              >
                {selectedRecord ? (
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="mx-auto w-full max-w-7xl pb-10">
                      {/* Quiet page navigation: actions live in the record snapshot to avoid duplication. */}
                      <div className="mb-4">
                        <button
                          type="button"
                          onClick={() => setSelectedRecord(null)}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:text-brand-orange"
                        >
                          <ChevronLeft size={15} />
                          Back to IPQC records
                        </button>
                      </div>

                      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                        {/* Main authoritative record content */}
                        <div className="min-w-0 space-y-4">
                          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <div className="p-5 md:p-6">
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                      <ClipboardCheck size={12} />
                                      Finding {selectedRecord.no ? `#${selectedRecord.no}` : `#${selectedRecord.id}`}
                                    </span>

                                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
                                      getFindingStatus(selectedRecord) === 'Closed'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : getFindingStatus(selectedRecord) === 'Open'
                                          ? 'border-orange-200 bg-orange-50 text-orange-700'
                                          : 'border-slate-200 bg-slate-50 text-slate-500'
                                    }`}>
                                      {getFindingStatus(selectedRecord) === 'Closed' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                                      {getFindingStatus(selectedRecord) || 'Not set'}
                                    </span>

                                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
                                      selectedRecord.icarStatus === 'Submitted'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-amber-200 bg-amber-50 text-amber-700'
                                    }`}>
                                      {selectedRecord.icarStatus === 'Submitted' ? <Unlock size={10} /> : <Lock size={10} />}
                                      ICAR {selectedRecord.icarStatus || 'Locked'}
                                    </span>
                                  </div>

                                  <h2 className="max-w-4xl text-xl font-bold leading-tight tracking-tight text-slate-900 md:text-2xl">
                                    {selectedRecord.detailsFindings || 'Finding details'}
                                  </h2>
                                </div>

                                <div className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 lg:min-w-[130px] lg:text-right">
                                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">ICAR reference</p>
                                  <p className="mt-1 font-mono text-sm font-bold text-slate-800">{selectedRecord.icarNum || 'N/A'}</p>
                                </div>
                              </div>

                              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-[11px] font-medium text-slate-500">
                                <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" /> {selectedRecord.auditDate || '—'}</span>
                                <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                                <span>WW{selectedRecord.ww || '—'}</span>
                                <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                                <span>Shift {selectedRecord.shift || '—'}</span>
                                <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                                <span>{selectedRecord.department || '—'}</span>
                              </div>
                            </div>
                          </section>

                          {/* View follows the exact same 01–05 hierarchy as Add / Edit. */}
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <RecordDetailSection
                              number="01"
                              icon={<CalendarDays size={15} />}
                              title="Audit context"
                              description="When the audit was conducted and which operation was reviewed."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                                <RecordDetailField label="Audit date" value={selectedRecord.auditDate} mono />
                                <RecordDetailField label="Work week (WW)" value={selectedRecord.ww ? `WW${selectedRecord.ww}` : '—'} />
                                <RecordDetailField label="Shift" value={selectedRecord.shift} />
                                <RecordDetailField label="Department" value={selectedRecord.department} />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="02"
                              icon={<MapPin size={15} />}
                              title="Location & ownership"
                              description="Identify the platform, exact station and responsible MQE."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                                <RecordDetailField label="Platform" value={selectedRecord.platform} />
                                <RecordDetailField label="Area / station" value={selectedRecord.areaStation} />
                                <RecordDetailField label="MQE engineer" value={selectedRecord.mqeEngineer} accent />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="03"
                              icon={<AlertCircle size={15} />}
                              title="Finding classification"
                              description="Classify the issue consistently for reporting and follow-up."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                                <RecordDetailField label="Category" value={selectedRecord.category} />
                                <RecordDetailField label="Group finding" value={selectedRecord.groupFinding} />
                                <div className="sm:col-span-2">
                                  <RecordDetailField label="Finding details" value={selectedRecord.detailsFindings} />
                                </div>
                              </div>

                              <div className="mt-5 grid grid-cols-1 gap-5 border-t border-slate-100 pt-5 md:grid-cols-[180px_minmax(0,1fr)]">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Finding status</p>
                                  <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold ${
                                    getFindingStatus(selectedRecord) === 'Closed'
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : getFindingStatus(selectedRecord) === 'Open'
                                        ? 'border-orange-200 bg-orange-50 text-orange-700'
                                        : 'border-slate-200 bg-slate-50 text-slate-500'
                                  }`}>
                                    {getFindingStatus(selectedRecord) === 'Closed' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                                    {getFindingStatus(selectedRecord) || 'Not set'}
                                  </div>
                                </div>

                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Remark / containment notes</p>
                                  <p className={`mt-1.5 text-sm leading-6 ${selectedRecord.remark ? 'font-medium text-slate-700' : 'italic text-slate-400'}`}>
                                    {selectedRecord.remark || 'No additional remarks were recorded.'}
                                  </p>
                                </div>
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="04"
                              icon={<Users size={15} />}
                              title="People & accountability"
                              description="Audit ownership and the person responsible at the point of finding."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                                <RecordDetailField label="IPQC auditor" value={selectedRecord.auditors} />
                                <RecordDetailField label="PIC (finding)" value={selectedRecord.personOnJob} />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="05"
                              icon={<ImageIcon size={15} />}
                              title="ICAR & evidence"
                              description="Corrective-action reference and supporting evidence for the finding."
                            >
                              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
                                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                                    <RecordDetailField label="ICAR number" value={selectedRecord.icarNum || 'N/A'} mono />
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">ICAR status</p>
                                      <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold ${
                                        selectedRecord.icarStatus === 'Submitted'
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                          : 'border-amber-200 bg-amber-50 text-amber-700'
                                      }`}>
                                        {selectedRecord.icarStatus === 'Submitted' ? <Unlock size={12} /> : <Lock size={12} />}
                                        {selectedRecord.icarStatus || 'Locked'}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="min-w-0">
                                  <div className="mb-2 flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Evidence</p>
                                    {selectedRecord.picture && (
                                      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-brand-orange">Click to enlarge</span>
                                    )}
                                  </div>

                                  {selectedRecord.picture ? (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewImage(getImageUrl(selectedRecord.picture!)!)}
                                      className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left transition-colors hover:border-slate-300"
                                    >
                                      <div className="flex h-[220px] items-center justify-center bg-slate-50 p-3">
                                        <img
                                          src={getImageUrl(selectedRecord.picture)}
                                          className="max-h-full w-full object-contain"
                                          referrerPolicy="no-referrer"
                                          alt="Finding evidence"
                                        />
                                      </div>
                                      <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2.5">
                                        <span className="text-[11px] font-semibold text-slate-700">Supporting evidence</span>
                                        <span className="text-[10px] font-bold text-brand-orange">View full size</span>
                                      </div>
                                    </button>
                                  ) : (
                                    <div className="flex min-h-[112px] items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4">
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                                        <ImageIcon size={17} />
                                      </div>
                                      <div>
                                        <p className="text-[11px] font-semibold text-slate-700">No evidence attached</p>
                                        <p className="mt-0.5 text-[10px] leading-4 text-slate-400">This finding was saved without a supporting image.</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </RecordDetailSection>
                          </div>
                        </div>

                        {/* Compact snapshot: traceability + actions only, no duplicate lifecycle card. */}
                        <aside className="space-y-4 xl:sticky xl:top-0">
                          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Record snapshot</p>
                                <p className="mt-1 text-[11px] text-slate-500">Traceability and current lifecycle state</p>
                              </div>
                              <Info size={15} className="text-slate-300" />
                            </div>

                            <div className="divide-y divide-slate-100 border-y border-slate-100">
                              <DetailRow label="Record no." value={String(selectedRecord.no ?? selectedRecord.id ?? '—')} mono />

                              <div className="flex items-center justify-between gap-4 py-3">
                                <span className="text-[10px] font-medium text-slate-500">Finding status</span>
                                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${
                                  getFindingStatus(selectedRecord) === 'Closed'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : getFindingStatus(selectedRecord) === 'Open'
                                      ? 'border-orange-200 bg-orange-50 text-orange-700'
                                      : 'border-slate-200 bg-slate-50 text-slate-500'
                                }`}>
                                  {getFindingStatus(selectedRecord) === 'Closed' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                                  {getFindingStatus(selectedRecord) || 'Not set'}
                                </span>
                              </div>

                              <div className="flex items-center justify-between gap-4 py-3">
                                <span className="text-[10px] font-medium text-slate-500">ICAR status</span>
                                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${
                                  selectedRecord.icarStatus === 'Submitted'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                                }`}>
                                  {selectedRecord.icarStatus === 'Submitted' ? <Unlock size={10} /> : <Lock size={10} />}
                                  {selectedRecord.icarStatus || 'Locked'}
                                </span>
                              </div>

                              <DetailRow label="ICAR reference" value={selectedRecord.icarNum || 'N/A'} mono />
                              <DetailRow label="MQE owner" value={selectedRecord.mqeEngineer || 'Unassigned'} accent />
                              <DetailRow label="Evidence" value={selectedRecord.picture ? 'Attached' : 'None'} />
                              <DetailRow
                                label="Created by"
                                value={selectedRecord.createdByName || selectedRecord.createdByUsername || 'Legacy / unknown'}
                              />
                              <DetailRow label="Created at" value={formatTraceDateTime(selectedRecord.createdAt)} />
                              <DetailRow
                                label="Last edited by"
                                value={selectedRecord.updatedByName || selectedRecord.updatedByUsername || 'Not edited yet'}
                              />
                              <DetailRow label="Last edited at" value={formatTraceDateTime(selectedRecord.updatedAt)} />
                            </div>

                            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Recent activity</p>
                                  <p className="mt-0.5 text-[10px] text-slate-500">Authenticated changes to this finding</p>
                                </div>
                                <Clock size={14} className="text-slate-400" />
                              </div>

                              <div className="mt-3 space-y-2.5">
                                {recordHistoryLoading ? (
                                  <p className="text-[10px] font-medium text-slate-400">Loading activity…</p>
                                ) : selectedRecordHistory.length > 0 ? (
                                  selectedRecordHistory.slice(0, 5).map((entry) => (
                                    <div key={entry.id} className="flex items-start gap-2.5">
                                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-orange" />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[10px] font-bold leading-4 text-slate-700">{entry.description}</p>
                                        <p className="mt-0.5 text-[9px] font-medium text-slate-400">
                                          {entry.actorName} · {formatTraceDateTime(entry.createdAt)}
                                        </p>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-[10px] leading-4 text-slate-400">
                                    No authenticated activity is available for this legacy record yet.
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3.5">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Version history</p>
                                  <p className="mt-0.5 text-[10px] text-slate-500">Recover earlier states after an accidental edit</p>
                                </div>
                                <History size={14} className="text-slate-400" />
                              </div>

                              <div className="mt-3 space-y-2">
                                {recordVersionsLoading ? (
                                  <p className="text-[10px] font-medium text-slate-400">Loading versions…</p>
                                ) : recordVersions.length > 0 ? (
                                  recordVersions.slice(0, 6).map((version, index) => (
                                    <div key={version.id} className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[8px] font-black text-slate-600 ring-1 ring-slate-200">v{version.versionNo}</span>
                                            <span className="text-[9px] font-black text-slate-700">{versionChangeLabel(version.changeType)}</span>
                                            {index === 0 && <span className="text-[8px] font-black uppercase tracking-wider text-emerald-600">Current</span>}
                                          </div>
                                          <p className="mt-1 text-[9px] font-medium text-slate-400">{version.actorName} · {formatTraceDateTime(version.createdAt)}</p>
                                          {version.changedFields && version.changedFields.length > 0 && (
                                            <p className="mt-1 truncate text-[8.5px] text-slate-400" title={version.changedFields.join(', ')}>
                                              Changed: {version.changedFields.join(', ')}
                                            </p>
                                          )}
                                        </div>
                                        {isAdmin && index !== 0 && version.changeType !== 'deleted' && (
                                          <button
                                            type="button"
                                            onClick={() => handleRestoreRecordVersion(version)}
                                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[8px] font-black uppercase tracking-wider text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                          >
                                            <RotateCcw size={10} /> Restore
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-[10px] leading-4 text-slate-400">Version history starts automatically with the next create or edit. Legacy records receive a baseline before their first versioned change.</p>
                                )}
                              </div>
                            </div>

                            <div className="mt-4 space-y-2">
                              <button
                                type="button"
                                onClick={() => { handleEditClick(selectedRecord); setSelectedRecord(null); }}
                                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-[11px] font-bold text-white transition-all hover:bg-slate-800 active:translate-y-px"
                              >
                                <Pencil size={13} />
                                Edit finding
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedRecord(null)}
                                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
                              >
                                <ChevronLeft size={13} />
                                Back to records
                              </button>
                            </div>
                          </section>
                        </aside>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                {/* Compact command area: search, filter and actions share one horizontal workflow. */}
                <section className="shrink-0">
                  <div className="flex flex-col xl:flex-row xl:items-center gap-2.5">
                    {/* Search */}
                    <div className="relative flex-1 min-w-0">
                      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search keyword, platform, station or auditor..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-11 rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-xs font-semibold text-slate-700 outline-none transition-all placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus:border-slate-300 focus:ring-4 focus:ring-slate-900/5"
                        aria-label="Search IPQC records"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                          title="Clear search"
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Filter */}
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(!filtersOpen)}
                      aria-expanded={filtersOpen}
                      className={`h-11 shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border px-4 text-[10px] font-black uppercase tracking-[0.12em] transition-all ${
                        filtersOpen
                          ? 'border-slate-800 bg-slate-800 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Filter size={14} />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className={`min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center text-[9px] font-black ${
                          filtersOpen ? 'bg-white text-slate-800' : 'bg-brand-orange text-white'
                        }`}>
                          {activeFilterCount}
                        </span>
                      )}
                    </button>

                    <div className="hidden xl:block h-7 w-px bg-slate-200" aria-hidden="true" />

                    {/* Secondary actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowImportModal(true)}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                      >
                        <Upload size={14} className="text-blue-600" />
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={handleExcelExport}
                        disabled={exportingExcel}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <Download size={14} className={`text-emerald-600 ${exportingExcel ? 'animate-pulse' : ''}`} />
                        {exportingExcel ? 'Exporting...' : 'Export'}
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenAddFinding}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-orange px-5 text-[10px] font-black uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(241,93,34,0.16)] transition-all hover:brightness-110 active:translate-y-px"
                      >
                        <Plus size={16} />
                        Add Finding
                      </button>
                    </div>
                  </div>

                  {/* Quiet secondary information row. */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-400">
                      {(() => {
                        const openCount = records.filter(r => getFindingStatus(r) === 'Open').length;
                        const closedCount = records.filter(r => getFindingStatus(r) === 'Closed').length;
                        const unclassifiedCount = records.filter(r => !getFindingStatus(r)).length;
                        const submittedCount = records.filter(r => r.icarStatus === 'Submitted').length;
                        return (
                          <>
                            <button type="button" onClick={() => setFilterStatus(prev => prev.length === 1 && prev[0] === 'Open' ? [] : ['Open'])} className="hover:text-slate-700 transition-colors">
                              <span className="font-black text-slate-700">{openCount.toLocaleString()}</span> open
                            </button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setFilterStatus(prev => prev.length === 1 && prev[0] === 'Closed' ? [] : ['Closed'])} className="hover:text-slate-700 transition-colors">
                              <span className="font-black text-slate-700">{closedCount.toLocaleString()}</span> closed
                            </button>
                            {unclassifiedCount > 0 && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span><span className="font-black text-slate-600">{unclassifiedCount.toLocaleString()}</span> status not set</span>
                              </>
                            )}
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setFilterIcarStatus(prev => prev.length === 1 && prev[0] === 'Submitted' ? [] : ['Submitted'])} className="hover:text-slate-700 transition-colors">
                              <span className="font-black text-slate-700">{submittedCount.toLocaleString()}</span> submitted ICAR
                            </button>
                            <span className="text-slate-300">·</span>
                            <span><span className="font-black text-slate-700">{records.length.toLocaleString()}</span> total</span>
                          </>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-400">
                      {(searchQuery || activeFilterCount > 0) && (
                        <span>Showing <span className="font-black text-slate-700">{filteredRecords.length.toLocaleString()}</span> matching</span>
                      )}
                      {hasActiveQuery && (
                        <>
                          <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                          <button
                            type="button"
                            onClick={clearRecordFilters}
                            className="font-black uppercase tracking-[0.12em] text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            Clear all
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </section>

                <AnimatePresence>
                  {filtersOpen && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                      animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
                      exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                      className={filtersOpen ? 'overflow-visible relative z-40' : 'overflow-hidden'}
                    >
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-700">Advanced filters</h4>
                            <p className="mt-1 text-[10px] font-medium leading-4 text-slate-400">
                              Select multiple values in each group. Values within a group use OR; different groups use AND.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {activeFilterCount > 0 && (
                              <span className="rounded-full bg-brand-orange/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-brand-orange">
                                {activeFilterCount} active
                              </span>
                            )}
                            {activeFilterCount > 0 && (
                              <button
                                type="button"
                                onClick={clearRecordFilters}
                                className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400 transition-colors hover:text-slate-700"
                              >
                                Clear all
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                          <MultiSelectFilter
                            label="Work Week"
                            allLabel="All Work Weeks"
                            options={WWS}
                            values={filterWW}
                            onChange={setFilterWW}
                          />
                          <FilterInput label="Date" type="date" value={filterDate} onChange={setFilterDate} />
                          <MultiSelectFilter
                            label="Shift"
                            allLabel="All Shifts"
                            options={SHIFTS}
                            values={filterShift}
                            onChange={setFilterShift}
                          />
                          <MultiSelectFilter
                            label="Auditor"
                            allLabel="All Auditors"
                            options={auditorsList}
                            values={filterAuditor}
                            onChange={setFilterAuditor}
                          />
                          <MultiSelectFilter
                            label="Department"
                            allLabel="All Departments"
                            options={DEPARTMENTS}
                            values={filterDept}
                            onChange={setFilterDept}
                          />
                          <MultiSelectFilter
                            label="Platform"
                            allLabel="All Platforms"
                            options={platformsList}
                            values={filterPlatform}
                            onChange={setFilterPlatform}
                          />
                          <MultiSelectFilter
                            label="Category"
                            allLabel="All Categories"
                            options={categoryFilterOptions}
                            values={filterCategory}
                            onChange={setFilterCategory}
                          />
                          <MultiSelectFilter
                            label="Finding Status"
                            allLabel="All Finding Statuses"
                            options={['Open', 'Closed']}
                            values={filterStatus}
                            onChange={setFilterStatus}
                            searchable={false}
                          />
                          <MultiSelectFilter
                            label="ICAR Status"
                            allLabel="All ICAR Statuses"
                            options={['Locked', 'Submitted']}
                            values={filterIcarStatus}
                            onChange={setFilterIcarStatus}
                            searchable={false}
                          />

                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={clearRecordFilters}
                              disabled={activeFilterCount === 0 && !searchQuery}
                              className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Clear Filters
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col flex-1 shadow-[0_8px_30px_rgba(15,23,42,0.05)] min-h-0">
                  <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1760px]">
                      <thead className="bg-slate-50/95 backdrop-blur sticky top-0 z-20 shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                        <tr>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 text-center sticky left-0 bg-slate-100 z-30 shadow-[2px_0_5px_rgba(0,0,0,0.03)] w-16">No</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Date</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 text-center">WW</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 text-center">Shift</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Auditor Name</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">PIC Finding</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Department</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Platform</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">MQE Engineer</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 bg-slate-200/50">Station / Area</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Group Finding</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Category</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Finding Details</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 text-center">Image</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">Remark</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 text-center">Finding Status</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 text-center">ICAR Status</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200">ICAR#</th>
                          <th className="px-4 py-3.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-200 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {paginatedRecords.map((record, index) => (
                          <tr 
                            key={record.id} 
                            ref={(el) => { rowRefs.current[String(record.id)] = el; }}
                            onClick={() => setSelectedRecord(record)}
                            className={`transition-colors duration-700 text-[11px] text-slate-700 cursor-pointer group border-l-2 hover:bg-orange-50/40 hover:border-l-brand-orange/60 ${
                              String(record.id) === String(highlightedId)
                                ? 'bg-orange-50 border-l-brand-orange'
                                : `border-l-transparent ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`
                            }`}
                          >
                            <td className="px-4 py-4 text-center font-bold text-slate-500 border-r border-slate-200 sticky left-0 bg-inherit z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)] group-hover:text-brand-orange">
                              {(currentPage - 1) * pageSize + index + 1}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap font-medium border-r border-slate-100">{record.auditDate}</td>
                            <td className="px-4 py-4 text-center font-black text-slate-600 border-r border-slate-100">{record.ww}</td>
                            <td className="px-4 py-4 text-center font-bold border-r border-slate-100">{record.shift}</td>
                            <td className="px-4 py-4 font-semibold text-slate-900 border-r border-slate-100">{record.auditors}</td>
                            <td className="px-4 py-4 font-medium text-slate-700 border-r border-slate-100">{record.personOnJob}</td>
                            <td className="px-4 py-4 font-bold text-blue-700 border-r border-slate-100">{record.department}</td>
                            <td className="px-4 py-4 font-bold text-brand-orange border-r border-slate-100">{record.platform}</td>
                            <td className="px-4 py-4 font-medium italic text-slate-600 border-r border-slate-100">{record.mqeEngineer}</td>
                            <td className="px-4 py-4 font-black text-slate-900 bg-slate-100/50 border-r border-slate-200">{record.areaStation}</td>
                            <td className="px-4 py-4 italic border-r border-slate-100">{record.groupFinding}</td>
                            <td className="px-4 py-4 whitespace-nowrap border-r border-slate-100">
                              <span className="px-2.5 py-1 bg-slate-200/70 rounded text-[9px] font-black uppercase tracking-widest text-slate-700">
                                {record.category}
                              </span>
                            </td>
                            <td className="px-4 py-4 max-w-[200px] truncate leading-tight border-r border-slate-100 font-medium" title={record.detailsFindings}>
                              {record.detailsFindings}
                            </td>
                            <td className="px-4 py-4 text-center border-r border-slate-100">
                              {record.picture ? (
                                <div 
                                  onClick={(e) => { e.stopPropagation(); setPreviewImage(getImageUrl(record.picture!)!); }}
                                  className="w-16 h-12 rounded-lg border border-slate-300 overflow-hidden mx-auto shadow-sm group-hover:scale-105 transition-transform cursor-zoom-in relative bg-white"
                                >
                                  <img src={getImageUrl(record.picture)} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                                </div>
                              ) : <ImageIcon size={20} className="mx-auto opacity-30" />}
                            </td>
                            <td className="px-4 py-4 max-w-[150px] truncate italic text-slate-500 border-r border-slate-100">{record.remark || '-'}</td>
                            <td className="px-4 py-4 text-center border-r border-slate-100">
                              {getFindingStatus(record) ? (
                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                                  getFindingStatus(record) === 'Closed'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-orange-200 bg-orange-50 text-orange-700'
                                }`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${getFindingStatus(record) === 'Closed' ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                                  {getFindingStatus(record)}
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Not set</span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-center border-r border-slate-100">
                              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm ${
                                record.icarStatus === 'Submitted' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold' : 'bg-amber-100 text-amber-800 border border-amber-300 font-bold'
                              }`}>
                                {record.icarStatus || 'Locked'}
                              </span>
                            </td>
                            <td className="px-4 py-4 font-mono text-[10px] font-bold text-slate-600 border-r border-slate-100">{record.icarNum || 'N/A'}</td>
                            <td className="px-4 py-4 text-right" onClick={e => e.stopPropagation()}>
                              <div className="relative flex justify-end">
                                <button
                                  onClick={() => setOpenRowAction(openRowAction === record.id ? null : record.id)}
                                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-all ${
                                    openRowAction === record.id
                                      ? 'border-slate-300 bg-slate-100 text-slate-800 shadow-sm'
                                      : 'border-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700'
                                  }`}
                                  title="Row actions"
                                  aria-label={`Actions for finding ${record.no ?? ''}`}
                                  aria-expanded={openRowAction === record.id}
                                >
                                  <MoreVertical size={16} />
                                </button>

                                <AnimatePresence>
                                  {openRowAction === record.id && (
                                    <motion.div
                                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                      transition={{ duration: 0.12 }}
                                      className="absolute right-0 top-full mt-2 z-50 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
                                    >
                                      <button
                                        onClick={() => { setSelectedRecord(record); setOpenRowAction(null); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-50"
                                      >
                                        <Layers size={14} className="text-slate-400" />
                                        View details
                                      </button>
                                      <button
                                        onClick={() => { handleEditClick(record); setOpenRowAction(null); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold text-slate-700 transition-colors hover:bg-orange-50 hover:text-brand-orange"
                                      >
                                        <Pencil size={14} />
                                        Edit finding
                                      </button>
                                      <button
                                        onClick={() => { setOpenRowAction(null); handleDeleteRecord(record.id); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold text-rose-600 transition-colors hover:bg-rose-50"
                                      >
                                        <Trash2 size={14} />
                                        Delete finding
                                      </button>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {filteredRecords.length === 0 && (
                    <div className="p-20 text-center bg-white flex-1 flex flex-col items-center justify-center">
                      <div className="w-16 h-16 bg-bg-main rounded-full flex items-center justify-center mb-4 text-text-muted/30">
                        <Filter size={32} />
                      </div>
                      <h4 className="font-bold text-text-muted uppercase tracking-widest text-sm">No Results Found</h4>
                      <p className="text-xs text-text-muted/60 mt-2">Try adjusting your filters or search query.</p>
                    </div>
                  )}

                  {filteredRecords.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 bg-slate-50/70 border-t border-slate-200 shrink-0">
                      <div className="flex items-center gap-3 text-[11px] font-bold text-slate-500">
                        <span>
                          Showing <span className="text-slate-800">{(currentPage - 1) * pageSize + 1}</span>
                          {'–'}
                          <span className="text-slate-800">{Math.min(currentPage * pageSize, filteredRecords.length)}</span>
                          {' of '}
                          <span className="text-slate-800">{filteredRecords.length}</span>
                        </span>
                        <select
                          value={pageSize}
                          onChange={(e) => setPageSize(Number(e.target.value))}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] font-black text-slate-600 outline-none focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 cursor-pointer"
                        >
                          <option value={25}>25 / page</option>
                          <option value={50}>50 / page</option>
                          <option value={100}>100 / page</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCurrentPage(1)}
                          disabled={currentPage === 1}
                          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                          title="First page"
                        >
                          <ChevronsLeft size={15} />
                        </button>
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                          title="Previous page"
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <span className="px-3 text-[11px] font-black text-slate-600 tabular-nums">
                          Page {currentPage} of {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                          title="Next page"
                        >
                          <ChevronRight size={15} />
                        </button>
                        <button
                          onClick={() => setCurrentPage(totalPages)}
                          disabled={currentPage === totalPages}
                          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                          title="Last page"
                        >
                          <ChevronsRight size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                  </>
                )}
              </motion.div>
            )}

            {view === 'add-audit' && (
              <motion.div
                key="add-audit"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="flex-1 overflow-y-auto pb-8 custom-scrollbar"
              >
                <div className="w-full max-w-7xl mx-auto">
                  {/* Page heading */}
                  <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={handleCloseAuditForm}
                        className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:text-brand-orange"
                      >
                        <ChevronLeft size={15} />
                        Back to IPQC records
                      </button>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-100 bg-orange-50 text-brand-orange">
                          <ClipboardCheck size={19} />
                        </div>
                        <div>
                          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
                            {editingId ? 'Edit Finding' : 'Add Finding'}
                          </h2>
                          <p className="mt-1 text-xs text-slate-500">
                            Record the audit context, finding details, ownership and supporting evidence.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        Required fields marked *
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${
                        newAudit.icarStatus === 'Submitted'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        {newAudit.icarStatus === 'Submitted' ? <Unlock size={11} /> : <Lock size={11} />}
                        ICAR {newAudit.icarStatus || 'Locked'}
                      </span>
                    </div>
                  </div>

                  <form
                    onSubmit={handleAddAudit}
                    className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
                  >
                    {/* Main form */}
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
                      {/* 01 Audit context */}
                      <section className="border-b border-slate-200 p-5 md:p-6">
                        <div className="mb-5 flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">01</div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <CalendarDays size={15} className="text-brand-orange" />
                              <h3 className="text-sm font-bold text-slate-900">Audit context</h3>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">When the audit was conducted and which operation was reviewed.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <FormInput
                            label="Audit date"
                            type="date"
                            required
                            value={newAudit.auditDate}
                            onChange={handleAuditDateChange}
                          />
                          <AutoField
                            label="Work week (WW)"
                            value={newAudit.ww ? `WW${newAudit.ww}` : '—'}
                          />
                          <FormSelect
                            label="Shift"
                            required
                            value={newAudit.shift || ''}
                            onChange={(v: string) => setNewAudit({ ...newAudit, shift: v })}
                            options={SHIFTS}
                            placeholder="Select shift"
                          />
                          <FormSelect
                            label="Department"
                            required
                            value={newAudit.department || ''}
                            onChange={(v: string) => setNewAudit({ ...newAudit, department: v })}
                            options={DEPARTMENTS}
                            placeholder="Select department"
                          />
                        </div>
                      </section>

                      {/* 02 Location */}
                      <section className="border-b border-slate-200 p-5 md:p-6">
                        <div className="mb-5 flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">02</div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <MapPin size={15} className="text-brand-orange" />
                              <h3 className="text-sm font-bold text-slate-900">Location & ownership</h3>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">Identify the platform, exact station and responsible MQE.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                          <FormSelect
                            label="Platform"
                            required
                            value={newAudit.platform || ''}
                            onChange={handlePlatformChange}
                            options={platformsList}
                            placeholder="Select platform"
                          />
                          <FormInput
                            label="Area / station"
                            required
                            value={newAudit.areaStation}
                            onChange={(v: string) => setNewAudit({ ...newAudit, areaStation: v })}
                            placeholder="e.g. Station 2, EM2"
                          />
                          <AutoField label="MQE engineer" value={newAudit.mqeEngineer} accent="orange" />
                        </div>
                      </section>

                      {/* 03 Finding */}
                      <section className="border-b border-slate-200 p-5 md:p-6">
                        <div className="mb-5 flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">03</div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <AlertCircle size={15} className="text-brand-orange" />
                              <h3 className="text-sm font-bold text-slate-900">Finding classification</h3>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">Classify the issue consistently for reporting and follow-up.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                          <FormSelect
                            label="Category"
                            required
                            value={newAudit.category || ''}
                            onChange={handleCategoryChange}
                            options={categoryOptionsForForm}
                            placeholder="Select category"
                          />
                          <AutoField label="Group finding" value={newAudit.groupFinding} />
                          <FormSelect
                            label="Finding details"
                            required
                            value={newAudit.detailsFindings || ''}
                            onChange={(v: string) => setNewAudit({ ...newAudit, detailsFindings: v })}
                            options={findingDetailOptionsForForm}
                            placeholder={newAudit.category ? 'Select finding detail' : 'Select category first'}
                            disabled={!newAudit.category}
                          />
                        </div>

                        <div className="mt-4 max-w-md">
                          <FormSelect
                            label="Finding status"
                            required
                            value={newAudit.status || ''}
                            onChange={(v: string) => setNewAudit({ ...newAudit, status: v })}
                            options={['Open', 'Closed']}
                            placeholder="Select finding status"
                          />
                        </div>

                        <div className="mt-4">
                          <label className="mb-1.5 block text-[11px] font-semibold text-slate-700">
                            Remark <span className="font-normal text-slate-400">(optional)</span>
                          </label>
                          <textarea
                            className="min-h-[92px] w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                            placeholder="Add concise context, observation details or immediate containment information..."
                            value={newAudit.remark || ''}
                            onChange={(e) => setNewAudit({ ...newAudit, remark: e.target.value })}
                          />
                        </div>
                      </section>

                      {/* 04 People */}
                      <section className="border-b border-slate-200 p-5 md:p-6">
                        <div className="mb-5 flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">04</div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Users size={15} className="text-brand-orange" />
                              <h3 className="text-sm font-bold text-slate-900">People & accountability</h3>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">Audit ownership and the person responsible at the point of finding.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormSelect
                            label="IPQC auditor"
                            required
                            value={newAudit.auditors || ''}
                            onChange={(v: string) => setNewAudit({ ...newAudit, auditors: v })}
                            options={auditorsList}
                            placeholder="Select auditor"
                          />
                          <FormInput
                            label="PIC name (finding)"
                            required
                            value={newAudit.personOnJob}
                            onChange={(v: string) => setNewAudit({ ...newAudit, personOnJob: v })}
                            placeholder="Person responsible on shift"
                          />
                        </div>
                      </section>

                      {/* 05 ICAR & evidence */}
                      <section className="p-5 md:p-6">
                        <div className="mb-5 flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">05</div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 size={15} className="text-brand-orange" />
                              <h3 className="text-sm font-bold text-slate-900">ICAR & evidence</h3>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">Attach the corrective-action reference and supporting evidence.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                          <div className="space-y-4 lg:col-span-5">
                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold text-slate-700">ICAR number</label>
                              <input
                                type="text"
                                value={newAudit.icarNum ?? ''}
                                onChange={(e) => handleIcarNumChange(e.target.value)}
                                placeholder="Enter ICAR number"
                                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                              />
                            </div>

                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold text-slate-700">ICAR status</label>
                              <div className={`flex h-11 w-full items-center justify-between rounded-lg border px-3.5 text-sm font-semibold ${
                                newAudit.icarStatus === 'Submitted'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}>
                                <span className="flex items-center gap-2">
                                  {newAudit.icarStatus === 'Submitted' ? <Unlock size={14} /> : <Lock size={14} />}
                                  {newAudit.icarStatus || 'Locked'}
                                </span>
                              </div>
                            </div>

                          </div>

                          <div className="lg:col-span-7">
                            <div className="mb-1.5 flex items-center justify-between gap-3">
                              <label className="text-[11px] font-semibold text-slate-700">Audit evidence</label>
                              <span className="text-[10px] text-slate-400">JPG, PNG or WEBP · optional</span>
                            </div>
                            <div
                              onClick={() => !newAudit.picture && fileInputRef.current?.click()}
                              className={`relative flex w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed transition-all ${
                                newAudit.picture
                                  ? 'h-[190px] border-slate-300 bg-slate-50'
                                  : 'h-[190px] cursor-pointer border-slate-300 bg-slate-50/70 hover:border-brand-orange/60 hover:bg-orange-50/30'
                              }`}
                            >
                              <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageChange}
                              />
                              {newAudit.picture ? (
                                <>
                                  <img
                                    src={getImageUrl(newAudit.picture)}
                                    alt="Audit Evidence"
                                    className="h-full w-full object-contain p-2"
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="absolute right-2 top-2 flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                      className="rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-white"
                                    >
                                      Replace
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setNewAudit(prev => ({ ...prev, picture: '' }));
                                        if (fileInputRef.current) fileInputRef.current.value = '';
                                      }}
                                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-rose-600 shadow-sm transition-colors hover:bg-rose-50"
                                      title="Remove image"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="px-6 text-center">
                                  <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                                    <ImageIcon size={17} />
                                  </div>
                                  <p className="text-xs font-semibold text-slate-700">Upload evidence photo</p>
                                  <p className="mt-1 text-[10px] text-slate-400">Click to choose a file from this device</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>

                    {/* Right-side review / actions */}
                    <aside className="space-y-4 xl:sticky xl:top-4">
                      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">Entry summary</h3>
                            <p className="mt-0.5 text-[10px] text-slate-400">Quick review before saving</p>
                          </div>
                          <ClipboardCheck size={17} className="text-slate-400" />
                        </div>

                        <div className="divide-y divide-slate-100 border-y border-slate-100">
                          <div className="py-3">
                            <p className="text-[10px] font-medium text-slate-400">Audit</p>
                            <p className="mt-1 text-xs font-semibold text-slate-800">
                              {newAudit.auditDate || 'Date not set'} · WW{newAudit.ww || '—'} · Shift {newAudit.shift || '—'}
                            </p>
                          </div>
                          <div className="py-3">
                            <p className="text-[10px] font-medium text-slate-400">Location</p>
                            <p className="mt-1 text-xs font-semibold text-slate-800">{newAudit.platform || 'Platform not selected'}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">{newAudit.areaStation || 'Area / station pending'}</p>
                          </div>
                          <div className="py-3">
                            <p className="text-[10px] font-medium text-slate-400">MQE owner</p>
                            <p className="mt-1 text-xs font-semibold text-brand-orange">{newAudit.mqeEngineer || 'Pending platform selection'}</p>
                          </div>
                          <div className="py-3">
                            <p className="text-[10px] font-medium text-slate-400">Finding</p>
                            <p className="mt-1 truncate text-xs font-semibold text-slate-800" title={newAudit.detailsFindings || ''}>{newAudit.detailsFindings || 'Finding details pending'}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500" title={newAudit.category || ''}>{newAudit.category || 'Category pending'}</p>
                          </div>
                          <div className="py-3">
                            <p className="text-[10px] font-medium text-slate-400">Ownership</p>
                            <p className="mt-1 text-xs font-semibold text-slate-800">{newAudit.auditors || 'Auditor pending'}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">PIC: {newAudit.personOnJob || 'Not entered'}</p>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2 rounded-lg bg-slate-50 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[10px] font-medium text-slate-500">Finding status</span>
                            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold ${
                              normalizeFindingStatus(newAudit.status) === 'Closed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : normalizeFindingStatus(newAudit.status) === 'Open'
                                  ? 'border-orange-200 bg-orange-50 text-orange-700'
                                  : 'border-slate-200 bg-white text-slate-400'
                            }`}>
                              {normalizeFindingStatus(newAudit.status) === 'Closed' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                              {normalizeFindingStatus(newAudit.status) || 'Not set'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
                            <span className="text-[10px] font-medium text-slate-500">ICAR status</span>
                            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold ${
                              newAudit.icarStatus === 'Submitted'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}>
                              {newAudit.icarStatus === 'Submitted' ? <Unlock size={10} /> : <Lock size={10} />}
                              {newAudit.icarStatus || 'Locked'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
                        <button
                          type="submit"
                          disabled={auditSaving}
                          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-orange px-4 text-xs font-bold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CheckCircle2 size={15} className={auditSaving ? 'animate-pulse' : ''} />
                          {auditSaving ? (editingId ? 'Updating...' : 'Submitting...') : (editingId ? 'Update Finding' : 'Submit Finding')}
                        </button>
                        <button
                          type="button"
                          onClick={handleCloseAuditForm}
                          className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </aside>
                  </form>
                </div>
              </motion.div>
            )}


            {view === 'action-center' && isAdmin && (
              <motion.div
                key="action-center"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-7xl mx-auto pb-20 space-y-5"
              >
                <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-brand-orange">
                      <AlertCircle size={13} />
                      Admin operations
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">Action Center</h2>
                    <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">
                      A read-only operational queue for unresolved findings, aging risk, ICAR follow-up and ownership gaps.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700">
                      <Lock size={11} />
                      Admin only
                    </span>
                    <button
                      type="button"
                      onClick={() => setView('ai-insights')}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-slate-800"
                    >
                      <Sparkles size={13} />
                      Ask AI Insights
                    </button>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => openRecordPreset({ status: 'Open' })}
                    className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Open findings</p>
                        <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{actionCenterData.open}</p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                        <AlertCircle size={17} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-[10px] font-medium text-slate-500">Requires follow-up</span>
                      <ChevronRight size={13} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-orange-500" />
                    </div>
                  </button>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Open &gt; 14 days</p>
                        <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{actionCenterData.openOver14}</p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <Clock size={17} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-[10px] font-medium text-slate-500">{actionCenterData.openOver30} older than 30 days</span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-amber-600">Aging risk</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openRecordPreset({ status: 'Open', icarStatus: 'Submitted' })}
                    className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Submitted ICAR + Open</p>
                        <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{actionCenterData.submittedButOpen}</p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <Unlock size={17} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-[10px] font-medium text-slate-500">Corrective action still unresolved</span>
                      <ChevronRight size={13} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-500" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setView('quality-config')}
                    className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Ownership gaps</p>
                        <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{actionCenterData.unassignedMqe}</p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <Users size={17} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-[10px] font-medium text-slate-500">Records without MQE ownership</span>
                      <ChevronRight size={13} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </div>
                  </button>
                </section>

                <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] xl:col-span-8">
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Oldest unresolved findings</h3>
                        <p className="mt-0.5 text-[10px] font-medium text-slate-400">Prioritized by elapsed days from the audit date.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openRecordPreset({ status: 'Open' })}
                        className="text-[10px] font-black uppercase tracking-wider text-brand-orange hover:underline"
                      >
                        View all open
                      </button>
                    </div>

                    {actionCenterData.oldestOpen.length === 0 ? (
                      <div className="px-5 py-14 text-center">
                        <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
                        <p className="mt-3 text-xs font-bold text-slate-700">No open findings</p>
                        <p className="mt-1 text-[10px] text-slate-400">There are currently no unresolved findings in the dataset.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left">
                          <thead className="bg-slate-50/80">
                            <tr className="border-b border-slate-200">
                              <th className="px-5 py-3 text-[9px] font-black uppercase tracking-wider text-slate-400">Record</th>
                              <th className="px-5 py-3 text-[9px] font-black uppercase tracking-wider text-slate-400">Finding</th>
                              <th className="px-5 py-3 text-[9px] font-black uppercase tracking-wider text-slate-400">Platform</th>
                              <th className="px-5 py-3 text-[9px] font-black uppercase tracking-wider text-slate-400">MQE</th>
                              <th className="px-5 py-3 text-right text-[9px] font-black uppercase tracking-wider text-slate-400">Age</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {actionCenterData.oldestOpen.map(({ record, ageDays }) => (
                              <tr
                                key={record.id}
                                onClick={() => { setSelectedRecord(record); setView('ipqc'); }}
                                className="cursor-pointer transition-colors hover:bg-orange-50/40"
                              >
                                <td className="px-5 py-3.5">
                                  <p className="text-xs font-black text-slate-800">#{record.no ?? record.id}</p>
                                  <p className="mt-0.5 text-[9px] font-medium text-slate-400">{record.auditDate || 'Date not set'}</p>
                                </td>
                                <td className="max-w-[300px] px-5 py-3.5">
                                  <p className="truncate text-xs font-bold text-slate-800">{record.detailsFindings || 'Finding details not set'}</p>
                                  <p className="mt-0.5 truncate text-[9px] text-slate-400">{String(record.category || '').replaceAll('_', ' ') || 'Category not set'}</p>
                                </td>
                                <td className="px-5 py-3.5 text-xs font-semibold text-slate-600">{record.platform || '—'}</td>
                                <td className="px-5 py-3.5 text-xs font-semibold text-slate-600">{record.mqeEngineer || 'Unassigned'}</td>
                                <td className="px-5 py-3.5 text-right">
                                  <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-black ${
                                    ageDays > 30
                                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                                      : ageDays > 14
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-slate-200 bg-slate-50 text-slate-600'
                                  }`}>
                                    {ageDays}d
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="space-y-5 xl:col-span-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Lifecycle health</p>
                          <p className="mt-1 text-sm font-black text-slate-900">Closure performance</p>
                        </div>
                        <CheckCircle2 size={18} className="text-emerald-500" />
                      </div>
                      <div className="mt-5 flex items-end justify-between gap-4">
                        <div>
                          <p className="text-3xl font-black tracking-tight text-slate-900">{actionCenterData.closureRate.toFixed(1)}%</p>
                          <p className="mt-1 text-[10px] font-medium text-slate-400">Closed / classified findings</p>
                        </div>
                        <p className="text-right text-[10px] leading-5 text-slate-500">
                          <span className="font-black text-emerald-600">{actionCenterData.closed}</span> closed<br />
                          <span className="font-black text-orange-600">{actionCenterData.open}</span> open
                        </p>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.min(100, actionCenterData.closureRate)}%` }}
                        />
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Open workload</p>
                          <p className="mt-1 text-sm font-black text-slate-900">Top platforms</p>
                        </div>
                        <Layers size={17} className="text-slate-300" />
                      </div>
                      <div className="space-y-3">
                        {actionCenterData.topOpenPlatforms.length === 0 ? (
                          <p className="py-5 text-center text-[10px] text-slate-400">No open workload to rank.</p>
                        ) : actionCenterData.topOpenPlatforms.map((item) => {
                          const maxValue = actionCenterData.topOpenPlatforms[0]?.value || 1;
                          return (
                            <button
                              type="button"
                              key={item.name}
                              onClick={() => openRecordPreset({ status: 'Open', platform: item.name })}
                              className="block w-full text-left"
                            >
                              <div className="mb-1.5 flex items-center justify-between gap-3">
                                <span className="truncate text-[10px] font-bold text-slate-600">{item.name}</span>
                                <span className="text-[10px] font-black text-slate-800">{item.value}</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-brand-orange"
                                  style={{ width: `${Math.max(8, (item.value / maxValue) * 100)}%` }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Issue concentration</p>
                      <h3 className="mt-1 text-sm font-black text-slate-900">Top categories among open findings</h3>
                    </div>
                    <p className="text-[10px] text-slate-400">Click a category to drill into matching records.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {actionCenterData.topOpenCategories.map(item => (
                      <button
                        type="button"
                        key={item.name}
                        onClick={() => openRecordPreset({ status: 'Open', category: item.name })}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/40"
                      >
                        <span className="min-w-0 truncate text-[10px] font-bold text-slate-600">{item.name.replaceAll('_', ' ')}</span>
                        <span className="shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-black text-slate-800 shadow-sm">{item.value}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </motion.div>
            )}

            {view === 'ai-insights' && isAdmin && (
              <motion.div
                key="ai-insights"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-7xl mx-auto pb-20"
              >
                <section className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-brand-orange">
                      <Sparkles size={13} />
                      Admin intelligence
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">AI Insights</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700">
                      <Lock size={11} />
                      Read only
                    </span>
                    <button
                      type="button"
                      onClick={() => setView('action-center')}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-[10px] font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      <AlertCircle size={13} />
                      Action Center
                    </button>
                  </div>
                </section>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-5">
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
                      <div className="border-b border-slate-100 px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                            <Sparkles size={16} />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-900">Ask about IPQC performance</h3>
                            <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
                              Findings, platforms, categories, work weeks, auditors, MQE ownership and ICAR lifecycle.
                            </p>
                          </div>
                        </div>
                      </div>

                      <form
                        onSubmit={(e) => { e.preventDefault(); handleAskAi(); }}
                        className="p-5"
                      >
                        <textarea
                          value={aiQuestion}
                          onChange={(e) => setAiQuestion(e.target.value)}
                          disabled={aiLoading}
                          rows={4}
                          placeholder="Example: Which platform has the most open findings and what should management review first?"
                          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-900/5 disabled:cursor-wait disabled:opacity-70"
                        />
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[9px] leading-4 text-slate-400">
                            AI answers should support investigation, not replace record verification or quality approval.
                          </p>
                          <button
                            type="submit"
                            disabled={!aiQuestion.trim() || aiLoading}
                            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-orange px-4 text-[10px] font-black uppercase tracking-wider text-white shadow-sm transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {aiLoading ? (
                              <>
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                Analyzing
                              </>
                            ) : (
                              <>
                                <Sparkles size={13} />
                                Ask AI
                              </>
                            )}
                          </button>
                        </div>
                      </form>

                      <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4">
                        <p className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Suggested questions</p>
                        <div className="flex flex-wrap gap-2">
                          {AI_SUGGESTED_QUESTIONS.map(question => (
                            <button
                              key={question}
                              type="button"
                              disabled={aiLoading}
                              onClick={() => handleAskAi(question)}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[10px] font-semibold text-slate-600 transition-all hover:border-orange-200 hover:text-brand-orange disabled:opacity-40"
                            >
                              {question}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>

                    {aiLoading && (
                      <section ref={aiResponseRef} className="rounded-xl border border-orange-200 bg-orange-50/70 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                        <div className="flex items-center gap-3">
                          <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-orange-200 border-t-brand-orange" />
                          <p className="text-xs font-black text-slate-800">Analyzing current IPQC data…</p>
                        </div>
                      </section>
                    )}

                    {aiError && (
                      <section ref={aiResponseRef} className="scroll-mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                        <div className="flex items-start gap-3">
                          <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />
                          <div>
                            <p className="text-xs font-black text-rose-800">AI Insights unavailable</p>
                            <p className="mt-1 text-[10px] leading-5 text-rose-700">{aiError}</p>
                          </div>
                        </div>
                      </section>
                    )}

                    {aiResult ? (
                      <section ref={aiResponseRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
                        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-brand-orange">AI response</p>
                            <h3 className="mt-1 text-sm font-black text-slate-900">{aiLastQuestion || 'IPQC insight'}</h3>
                          </div>
                          {aiResult.generatedAt && (
                            <span className="shrink-0 text-[9px] font-medium text-slate-400">
                              {new Date(aiResult.generatedAt).toLocaleString()}
                            </span>
                          )}
                        </div>

                        {aiResult.highlights && aiResult.highlights.length > 0 && (
                          <div className="grid grid-cols-1 gap-2 border-b border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                            {aiResult.highlights.slice(0, 4).map((highlight, index) => (
                              <div key={`${highlight.label}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
                                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{highlight.label}</p>
                                <p className="mt-1 text-xl font-black tracking-tight text-slate-900">{highlight.value}</p>
                                {highlight.detail && <p className="mt-1 text-[9px] leading-4 text-slate-400">{highlight.detail}</p>}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="p-5">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-brand-orange">
                              <Sparkles size={13} />
                            </div>
                            <p className="whitespace-pre-wrap text-[12px] font-medium leading-6 text-slate-700">{aiResult.answer}</p>
                          </div>

                          {aiResult.filters && Object.values(aiResult.filters).some(Boolean) && (
                            <div className="mt-5 border-t border-slate-100 pt-4 text-right">
                              <button
                                type="button"
                                onClick={() => openRecordPreset(aiResult.filters)}
                                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3.5 text-[10px] font-black uppercase tracking-wider text-brand-orange transition-colors hover:bg-orange-100"
                              >
                                <Layers size={13} />
                                View matching records
                              </button>
                            </div>
                          )}
                        </div>
                      </section>
                    ) : !aiLoading && !aiError ? (
                      <section className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-5 py-8 text-center">
                        <Sparkles size={22} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-xs font-black text-slate-700">Ask a question to begin</p>
                      </section>
                    ) : null}
                  </div>

                  <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
                    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Current data context</p>
                      <div className="mt-4 divide-y divide-slate-100">
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[10px] font-medium text-slate-500">Total findings</span>
                          <span className="text-xs font-black text-slate-800">{records.length}</span>
                        </div>
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[10px] font-medium text-slate-500">Open</span>
                          <span className="text-xs font-black text-orange-600">{actionCenterData.open}</span>
                        </div>
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[10px] font-medium text-slate-500">Closed</span>
                          <span className="text-xs font-black text-emerald-600">{actionCenterData.closed}</span>
                        </div>
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[10px] font-medium text-slate-500">Submitted ICAR</span>
                          <span className="text-xs font-black text-blue-600">{analyticsData.icarStatusCounts.Submitted}</span>
                        </div>
                      </div>
                    </section>

                  </aside>
                </div>
              </motion.div>
            )}


            {(view === 'access-audit' || view === 'quality-config') && isAdmin && (
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-7xl mx-auto pb-20 space-y-5"
              >
                {/* Page introduction */}
                <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-brand-orange mb-2">
                      {view === 'access-audit' ? <ShieldCheck size={13} /> : <SlidersHorizontal size={13} />}
                      Administration
                    </div>
                    <h2 className="text-xl md:text-2xl font-black tracking-tight text-slate-900">
                      {view === 'access-audit' ? 'Access & Audit' : 'Quality Configuration'}
                    </h2>
                    <p className="mt-1.5 max-w-2xl text-xs md:text-sm leading-6 text-slate-500">
                      {view === 'access-audit'
                        ? 'Manage employee access, review accountable system activity and recover accidentally deleted findings.'
                        : 'Manage the IPQC auditor directory and Platform → MQE ownership rules used across finding records.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {view === 'access-audit' ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-blue-700">
                        <ShieldCheck size={12} />
                        Protected access
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                          savingSettings
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${savingSettings ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                        {savingSettings ? 'Saving changes' : 'Settings synced'}
                      </span>
                    )}
                  </div>
                </section>

                {/* Page-specific overview */}
                {view === 'access-audit' ? (
                  <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Active users</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{managedUsers.filter(user => user.isActive).length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <Users size={17} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Administrators</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{managedUsers.filter(user => user.role === 'admin' && user.isActive).length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <ShieldCheck size={17} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Recent events</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{displayAuditLog.length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                          <Clock size={17} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Recycle bin</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{deletedRecords.length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                          <DatabaseBackup size={17} />
                        </div>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Auditors</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{auditorsList.length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                          <Users size={17} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Platforms</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{platformsList.length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <Layers size={17} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Assigned MQE</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{platformsList.filter(platform => Boolean(mqeMappings[platform]?.trim())).length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <CheckCircle2 size={17} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Unassigned</p>
                          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{platformsList.filter(platform => !mqeMappings[platform]?.trim()).length}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                          <AlertCircle size={17} />
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {view === 'access-audit' && (
                  <>
                {/* User access management */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                  <div className="border-b border-slate-100 px-5 py-4 md:px-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                          <Users size={17} />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900">User Access Management</h3>
                          <p className="mt-0.5 max-w-2xl text-[10px] font-medium leading-4 text-slate-400">
                            Standard users use Employee ID + PIN. Administrators use an individual username, strong password and authenticator MFA. Temporary credentials must be changed on first sign-in.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                          {managedUsers.filter(user => user.isActive).length} active
                        </span>
                        <button
                          type="button"
                          onClick={() => { setShowCreateUser(value => !value); setUserManagementError(''); }}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-orange px-3.5 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:brightness-105"
                        >
                          <Plus size={13} /> {showCreateUser ? 'Close' : 'Add account'}
                        </button>
                      </div>
                    </div>

                    {showCreateUser && (
                      <form onSubmit={handleCreateUser} className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-semibold leading-4 text-blue-700">
                          Create a temporary PIN for standard users or a temporary password for administrators. New administrators enrol an authenticator app at first sign-in.
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <FormInput label="Full name" required value={newUserDraft.fullName} onChange={(v: string) => setNewUserDraft(prev => ({ ...prev, fullName: v }))} placeholder="Employee full name" />
                          <FormSelect label="System role" required value={newUserDraft.role} onChange={(v: UserRole) => setNewUserDraft(prev => ({ ...prev, role: v, employeeId: '', username: '', credential: '' }))} options={['user', 'admin']} />
                          {newUserDraft.role === 'user' ? (
                            <FormInput label="Employee ID" required value={newUserDraft.employeeId} onChange={(v: string) => setNewUserDraft(prev => ({ ...prev, employeeId: v }))} placeholder="e.g. 104582" />
                          ) : (
                            <FormInput label="Admin username" required value={newUserDraft.username} onChange={(v: string) => setNewUserDraft(prev => ({ ...prev, username: v }))} placeholder="e.g. quality.admin" />
                          )}
                          <FormInput label="Job title / function" value={newUserDraft.jobTitle} onChange={(v: string) => setNewUserDraft(prev => ({ ...prev, jobTitle: v }))} placeholder="Operator, IPQC Auditor, MQE..." />
                          <FormInput label="Department" value={newUserDraft.department} onChange={(v: string) => setNewUserDraft(prev => ({ ...prev, department: v }))} placeholder="Production, Quality, Test..." />
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-semibold text-slate-700">
                              {newUserDraft.role === 'user' ? 'Temporary 6-digit PIN' : 'Temporary admin password'}<span className="ml-0.5 text-rose-500">*</span>
                            </label>
                            <div className="flex gap-2">
                              <input
                                type={newUserDraft.role === 'user' ? 'text' : 'password'}
                                inputMode={newUserDraft.role === 'user' ? 'numeric' : undefined}
                                maxLength={newUserDraft.role === 'user' ? 6 : undefined}
                                value={newUserDraft.credential}
                                onChange={(e) => setNewUserDraft(prev => ({
                                  ...prev,
                                  credential: newUserDraft.role === 'user' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value,
                                }))}
                                placeholder={newUserDraft.role === 'user' ? '6 digits' : 'Minimum 12 characters'}
                                className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                              />
                              {newUserDraft.role === 'user' && (
                                <button type="button" onClick={generateTemporaryPin} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50">
                                  Generate
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <button
                            type="submit"
                            disabled={usersSaving || !newUserDraft.fullName.trim() || (
                              newUserDraft.role === 'user'
                                ? !newUserDraft.employeeId.trim() || !/^\d{6}$/.test(newUserDraft.credential)
                                : !newUserDraft.username.trim() || newUserDraft.credential.length < 12
                            )}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ShieldCheck size={14} /> Create account
                          </button>
                        </div>
                      </form>
                    )}

                    {userManagementError && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-semibold text-rose-700">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" /> {userManagementError}
                      </div>
                    )}
                  </div>

                  <div className="overflow-auto custom-scrollbar">
                    <table className="w-full min-w-[940px] text-left">
                      <thead className="bg-slate-50/95">
                        <tr className="border-b border-slate-200">
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400 md:px-6">Person</th>
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Identity</th>
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Department</th>
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Role</th>
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Status</th>
                          <th className="px-5 py-3 text-right text-[9px] font-black uppercase tracking-[0.14em] text-slate-400 md:px-6">Security</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {usersLoading ? (
                          <tr><td colSpan={6} className="px-6 py-10 text-center text-xs font-semibold text-slate-400">Loading accounts...</td></tr>
                        ) : managedUsers.length === 0 ? (
                          <tr><td colSpan={6} className="px-6 py-10 text-center text-xs font-semibold text-slate-400">No accounts found.</td></tr>
                        ) : managedUsers.map(user => (
                          <tr key={user.id} className="transition-colors hover:bg-slate-50/70">
                            <td className="px-5 py-3.5 md:px-6">
                              <div className="flex items-center gap-2.5">
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white ${user.role === 'admin' ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                                  {(user.fullName || user.username).charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-black text-slate-800">{user.fullName}</p>
                                  <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">{user.jobTitle || 'General user'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <p className="font-mono text-[11px] font-semibold text-slate-600">{user.role === 'user' ? (user.employeeId || 'ID not set') : user.username}</p>
                              <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{user.role === 'user' ? 'Employee ID' : 'Admin username'}</p>
                            </td>
                            <td className="px-5 py-3.5 text-xs font-semibold text-slate-600">{user.department || '—'}</td>
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${user.role === 'admin' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                {user.role}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-col items-start gap-1.5">
                                <button
                                  type="button"
                                  disabled={usersSaving || currentUser?.id === user.id}
                                  onClick={() => updateManagedUser(user, { isActive: !user.isActive })}
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50 ${user.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                  {user.isActive ? 'Active' : 'Inactive'}
                                </button>
                                {user.mustChangeCredential && user.isActive && (
                                  <span className="text-[9px] font-bold text-amber-600">Temporary credential</span>
                                )}
                                {!user.credentialReady && (
                                  <span className="text-[9px] font-bold text-rose-600">Credential not set</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right md:px-6">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {user.role === 'admin' && (
                                  <span className={`inline-flex h-7 items-center rounded-lg border px-2 text-[8px] font-black uppercase tracking-wider ${user.mfaEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                    {user.mfaEnabled ? 'MFA enabled' : 'MFA pending'}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={usersSaving || currentUser?.id === user.id}
                                  onClick={() => { setResetCredentialUserId(user.id); setResetCredentialValue(''); setUserManagementError(''); }}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[9px] font-black uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Lock size={12} /> {user.role === 'user' ? 'Reset PIN' : 'Reset password'}
                                </button>
                                {user.role === 'admin' && user.mfaEnabled && currentUser?.id !== user.id && (
                                  <button
                                    type="button"
                                    disabled={usersSaving}
                                    onClick={() => handleResetAdminMfa(user)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[9px] font-black uppercase tracking-wider text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40"
                                  >
                                    <Smartphone size={12} /> Reset MFA
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {resetCredentialUserId && (() => {
                    const target = managedUsers.find(user => user.id === resetCredentialUserId);
                    if (!target) return null;
                    const isPin = target.role === 'user';
                    const valid = isPin ? /^\d{6}$/.test(resetCredentialValue) : resetCredentialValue.length >= 12;
                    return (
                      <form onSubmit={handleResetUserCredential} className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 md:flex-row md:items-end md:px-6">
                        <div className="flex-1">
                          <label className="mb-1.5 block text-[10px] font-bold text-slate-600">
                            Temporary {isPin ? 'PIN' : 'password'} for {target.fullName}
                          </label>
                          <input
                            type={isPin ? 'text' : 'password'}
                            inputMode={isPin ? 'numeric' : undefined}
                            maxLength={isPin ? 6 : undefined}
                            value={resetCredentialValue}
                            onChange={(e) => setResetCredentialValue(isPin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
                            placeholder={isPin ? '6 digits' : 'Minimum 12 characters'}
                            autoComplete="new-password"
                            className="h-10 w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-brand-orange focus:ring-4 focus:ring-orange-100/60"
                          />
                          <p className="mt-1 text-[9px] font-medium text-slate-400">The account holder must replace this temporary credential at the next sign-in.</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setResetCredentialUserId(null); setResetCredentialValue(''); }} className="h-10 rounded-lg border border-slate-200 bg-white px-3.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Cancel</button>
                          <button type="submit" disabled={usersSaving || !valid} className="h-10 rounded-lg bg-slate-900 px-4 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-40">Update credential</button>
                        </div>
                      </form>
                    );
                  })()}
                </section>

                {/* Operational audit trail */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <Clock size={17} />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Operational Audit Trail</h3>
                        <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                          Verified PIN/password activity across findings, accounts and protected system configuration.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                        Latest {displayAuditLog.length}
                      </span>
                      <button
                        type="button"
                        onClick={fetchAuditLog}
                        disabled={auditLogLoading}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[10px] font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Clock size={13} className={auditLogLoading ? 'animate-spin' : ''} />
                        Refresh
                      </button>
                    </div>
                  </div>

                  {auditLogError && (
                    <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-semibold text-rose-700 md:mx-6">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" /> {auditLogError}
                    </div>
                  )}

                  <div className="max-h-[430px] overflow-auto custom-scrollbar">
                    {auditLogLoading && displayAuditLog.length === 0 ? (
                      <div className="px-6 py-12 text-center text-xs font-semibold text-slate-400">Loading audit trail...</div>
                    ) : displayAuditLog.length === 0 ? (
                      <div className="px-6 py-12 text-center">
                        <Clock size={22} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-xs font-black text-slate-700">No tracked changes yet</p>
                        <p className="mt-1 text-[10px] text-slate-400">New authenticated changes will appear here automatically.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {displayAuditLog.map((entry) => (
                          <div key={entry.id} className="grid gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/60 md:grid-cols-[150px_180px_minmax(0,1fr)_120px] md:items-center md:px-6">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold text-slate-600">{formatTraceDateTime(entry.createdAt)}</p>
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white ${entry.actorRole === 'admin' ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                                  {(entry.actorName || entry.actorUsername || '?').charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[10px] font-black text-slate-800">{entry.actorName || entry.actorUsername}</p>
                                  <p className="truncate text-[9px] font-medium text-slate-400">@{entry.actorUsername}</p>
                                </div>
                              </div>
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-slate-100 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-slate-500">
                                  {auditActionLabel(entry.action)}
                                </span>
                                {entry.entityId && (
                                  <span className="font-mono text-[9px] font-semibold text-slate-400">
                                    {entry.entityType} #{entry.entityId}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1.5 text-[10px] font-semibold leading-4 text-slate-700">{entry.description}</p>
                            </div>

                            <div className="md:text-right">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-wider ${
                                entry.actorRole === 'admin'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-500'
                              }`}>
                                {entry.actorRole}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-[9px] font-medium leading-4 text-slate-400 md:px-6">
                    Audit entries are append-only application records. Deactivating a user does not remove their historical actions.
                  </div>
                </section>

                {/* Recycle bin / accidental deletion recovery */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                        <ArchiveRestore size={17} />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-black text-slate-900">Record Recovery</h3>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-700">Soft delete enabled</span>
                        </div>
                        <p className="mt-0.5 text-[10px] font-medium leading-4 text-slate-400">
                          Deleted findings are removed from daily records but retained here with their audit trail and version history.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={fetchDeletedRecords}
                      disabled={deletedRecordsLoading}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[10px] font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RotateCcw size={13} className={deletedRecordsLoading ? 'animate-spin' : ''} />
                      Refresh
                    </button>
                  </div>

                  <div className="max-h-[360px] overflow-auto custom-scrollbar">
                    {deletedRecordsLoading && deletedRecords.length === 0 ? (
                      <div className="px-6 py-10 text-center text-xs font-semibold text-slate-400">Loading recycle bin...</div>
                    ) : deletedRecords.length === 0 ? (
                      <div className="px-6 py-10 text-center">
                        <DatabaseBackup size={22} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-xs font-black text-slate-700">Recycle bin is empty</p>
                        <p className="mt-1 text-[10px] text-slate-400">Deleted findings will remain recoverable here instead of being permanently removed.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {deletedRecords.map((record) => (
                          <div key={record.id} className="grid gap-3 px-5 py-3.5 hover:bg-slate-50/60 md:grid-cols-[90px_minmax(0,1fr)_180px_130px] md:items-center md:px-6">
                            <div>
                              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Finding</p>
                              <p className="mt-0.5 font-mono text-xs font-black text-slate-800">#{record.no ?? record.id}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-black text-slate-800">{record.detailsFindings || 'Finding record'}</p>
                              <p className="mt-0.5 truncate text-[9px] font-medium text-slate-400">{record.platform || '—'} · {record.areaStation || '—'} · {record.category || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold text-slate-500">Deleted by {record.deletedByName || record.deletedByUsername || 'Unknown user'}</p>
                              <p className="mt-0.5 text-[9px] text-slate-400">{formatTraceDateTime(record.deletedAt)}</p>
                            </div>
                            <div className="md:text-right">
                              <button
                                type="button"
                                onClick={() => handleRestoreDeletedRecord(record)}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[9px] font-black uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-100"
                              >
                                <RotateCcw size={12} /> Restore
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-[9px] font-medium leading-4 text-slate-400 md:px-6">
                    No permanent-delete button is exposed in the application. This protects against accidental removal while preserving QMS traceability.
                  </div>
                </section>
                  </>
                )}

                {view === 'quality-config' && (
                  <>
                {/* Main management area */}
                <section className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                  {/* Auditors */}
                  <div className="xl:col-span-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                    <div className="border-b border-slate-100 px-5 py-4 md:px-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-brand-orange">
                              <Users size={16} />
                            </div>
                            <div>
                              <h3 className="text-sm font-black text-slate-900">IPQC Auditors</h3>
                              <p className="mt-0.5 text-[10px] font-medium text-slate-400">People available in the auditor selection list.</p>
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                          {auditorsList.length} total
                        </span>
                      </div>

                      <form onSubmit={handleAddAuditor} className="mt-4 flex gap-2">
                        <div className="relative flex-1 min-w-0">
                          <Users size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={newAuditorName}
                            onChange={(e) => setNewAuditorName(e.target.value)}
                            placeholder="Enter auditor name"
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={!newAuditorName.trim() || savingSettings}
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-orange px-4 text-[10px] font-black uppercase tracking-wider text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus size={14} />
                          Add
                        </button>
                      </form>
                    </div>

                    <div className="max-h-[480px] overflow-y-auto custom-scrollbar">
                      {auditorsList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                            <Users size={20} />
                          </div>
                          <p className="text-xs font-black text-slate-700">No auditors configured</p>
                          <p className="mt-1 text-[10px] text-slate-400">Add an auditor using the field above.</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {auditorsList.map((auditor, i) => (
                            <div key={`${auditor}-${i}`} className="group px-5 py-3 md:px-6 transition-colors hover:bg-slate-50/70">
                              {editingAuditorIndex === i ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">
                                    {(editAuditorValue || auditor).charAt(0).toUpperCase()}
                                  </div>
                                  <input
                                    type="text"
                                    value={editAuditorValue}
                                    onChange={(e) => setEditAuditorValue(e.target.value)}
                                    className="h-9 min-w-0 flex-1 rounded-lg border border-brand-orange bg-white px-3 text-xs font-bold text-slate-800 outline-none ring-4 ring-brand-orange/5"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSaveEditAuditor(i);
                                      }
                                      if (e.key === 'Escape') setEditingAuditorIndex(null);
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditAuditor(i)}
                                    disabled={!editAuditorValue.trim() || savingSettings}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-40"
                                    title="Save auditor"
                                    aria-label={`Save ${auditor}`}
                                  >
                                    <CheckCircle2 size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingAuditorIndex(null)}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                                    title="Cancel editing"
                                    aria-label="Cancel editing"
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-600 ring-1 ring-inset ring-slate-200">
                                    {auditor.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-black text-slate-800">{auditor}</p>
                                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">IPQC Auditor</p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingAuditorIndex(i);
                                        setEditAuditorValue(auditor);
                                      }}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-700 hover:shadow-sm"
                                      title="Edit auditor"
                                      aria-label={`Edit ${auditor}`}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAuditor(auditor)}
                                      disabled={savingSettings}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                                      title="Remove auditor"
                                      aria-label={`Remove ${auditor}`}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Platform ownership */}
                  <div className="xl:col-span-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                    <div className="border-b border-slate-100 px-5 py-4 md:px-6">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-brand-orange">
                            <Layers size={16} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-black text-slate-900">Platform Ownership</h3>
                            <p className="mt-0.5 text-[10px] font-medium text-slate-400">Assign the responsible MQE engineer for each production platform.</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <span className="font-black text-emerald-600">{platformsList.filter(platform => Boolean(mqeMappings[platform]?.trim())).length}</span>
                          <span>of</span>
                          <span className="font-black text-slate-800">{platformsList.length}</span>
                          <span>assigned</span>
                        </div>
                      </div>

                      <form onSubmit={handleAddOrUpdateMqeMapping} className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2.5">
                          <div>
                            <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Platform</label>
                            <select
                              value={selectedPlatformForMapping}
                              onChange={(e) => {
                                const platform = e.target.value;
                                setSelectedPlatformForMapping(platform);
                                setNewMqeName(mqeMappings[platform] || '');
                              }}
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none transition-all focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 cursor-pointer"
                            >
                              {platformsList.map(platform => (
                                <option key={platform} value={platform}>{platform}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Responsible MQE</label>
                            <input
                              type="text"
                              value={newMqeName}
                              onChange={(e) => setNewMqeName(e.target.value)}
                              placeholder="Enter MQE engineer"
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5"
                            />
                          </div>
                          <div className="md:self-end">
                            <button
                              type="submit"
                              disabled={!newMqeName.trim() || savingSettings || newMqeName.trim() === String(mqeMappings[selectedPlatformForMapping] || '').trim()}
                              className="inline-flex h-10 w-full md:w-auto items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <CheckCircle2 size={14} />
                              {mqeMappings[selectedPlatformForMapping]?.trim() ? 'Update MQE' : 'Assign MQE'}
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>

                    <div className="max-h-[480px] overflow-auto custom-scrollbar">
                      <table className="w-full min-w-[620px] text-left">
                        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                          <tr className="border-b border-slate-200">
                            <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400 md:px-6">Platform</th>
                            <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">MQE Owner</th>
                            <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Status</th>
                            <th className="px-5 py-3 text-right text-[9px] font-black uppercase tracking-[0.14em] text-slate-400 md:px-6">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {platformsList.map((platform) => {
                            const assignedMqe = mqeMappings[platform];
                            const isAssigned = Boolean(assignedMqe?.trim());
                            const isSelected = selectedPlatformForMapping === platform;

                            return (
                              <tr
                                key={platform}
                                className={`group transition-colors ${isSelected ? 'bg-orange-50/40' : 'hover:bg-slate-50/70'}`}
                              >
                                <td className="px-5 py-3.5 md:px-6">
                                  <div className="flex items-center gap-2.5">
                                    <span className={`h-2 w-2 shrink-0 rounded-full ${isAssigned ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                    <span className="text-xs font-black text-slate-800">{platform}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className={`text-xs font-bold ${isAssigned ? 'text-slate-700' : 'italic text-slate-400'}`}>
                                    {assignedMqe || 'Not assigned'}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                                    isAssigned
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-slate-200 bg-slate-50 text-slate-500'
                                  }`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${isAssigned ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                    {isAssigned ? 'Assigned' : 'Unassigned'}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 text-right md:px-6">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedPlatformForMapping(platform);
                                        setNewMqeName(assignedMqe || '');
                                      }}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[9px] font-black uppercase tracking-wider text-slate-500 transition-colors hover:bg-white hover:text-slate-800 hover:shadow-sm"
                                      title="Edit assignment"
                                    >
                                      <Pencil size={13} />
                                      Edit
                                    </button>
                                    {isAssigned && (
                                      <button
                                        type="button"
                                        onClick={() => handleClearMqeMapping(platform)}
                                        disabled={savingSettings}
                                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                                        title="Clear assignment"
                                        aria-label={`Clear MQE assignment for ${platform}`}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                {/* Data maintenance */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
                        <TrendingUp size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-black text-slate-900">Sync MQE Ownership</h3>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700">Maintenance</span>
                        </div>
                        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                          Apply the current Platform → MQE ownership rules to existing findings. Use this after changing the MQE assigned to a platform.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRecalculateMqe}
                      disabled={recalculating || savingSettings}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-wider text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <TrendingUp size={14} className={recalculating ? 'animate-pulse' : ''} />
                      {recalculating ? 'Syncing records...' : 'Sync existing records'}
                    </button>
                  </div>
                </section>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Excel Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !importing) closeImportModal();
            }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[3px]"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-records-title"
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ duration: 0.16 }}
              className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5 md:px-7">
                <div className="flex min-w-0 items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                    <Upload size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 id="import-records-title" className="text-lg font-bold tracking-tight text-slate-900">
                      Import Historical Records
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Validate an Excel tracker and append its findings to the IPQC database.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeImportModal}
                  disabled={importing}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Close import dialog"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 px-6 py-5 md:px-7 md:py-6">
                {/* Upload zone */}
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (!importing) setImportDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!importing) setImportDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setImportDragActive(false);
                  }}
                  onDrop={handleImportDrop}
                  onClick={() => !importing && importFileInputRef.current?.click()}
                  className={`group flex min-h-[190px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-7 text-center transition-all ${
                    importDragActive
                      ? 'border-brand-orange bg-orange-50/60 ring-4 ring-brand-orange/5'
                      : selectedImportFile
                        ? 'border-emerald-300 bg-emerald-50/25'
                        : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
                  } ${importing ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <input
                    id="excelImportModalInput"
                    ref={importFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="hidden"
                    onChange={handleImportFileChange}
                  />

                  <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl border bg-white shadow-sm transition-colors ${
                    selectedImportFile ? 'border-emerald-200 text-emerald-600' : 'border-slate-200 text-slate-500 group-hover:text-brand-orange'
                  }`}>
                    {selectedImportFile ? <CheckCircle2 size={20} /> : <Upload size={20} />}
                  </div>

                  <p className="text-sm font-bold text-slate-800">
                    {selectedImportFile ? 'Workbook ready for import' : 'Drop your Excel workbook here'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedImportFile ? 'Choose another file to replace the current selection.' : 'or click anywhere in this area to browse your computer'}
                  </p>

                  {!selectedImportFile && (
                    <span className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-[11px] font-bold text-slate-700 shadow-sm transition-colors group-hover:border-brand-orange/40 group-hover:text-brand-orange">
                      Choose Excel file
                    </span>
                  )}

                  <p className="mt-4 text-[10px] font-medium text-slate-400">
                    Supported: .xlsx, .xls <span className="mx-1.5 text-slate-300">•</span> Maximum file size: 10 MB
                  </p>
                </div>

                {/* Selected file */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Selected workbook</p>
                  </div>
                  <div className="flex min-h-[70px] items-center justify-between gap-4 px-4 py-3.5">
                    {selectedImportFile ? (
                      <>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                            <CheckCircle2 size={17} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-800" title={selectedImportFile.name}>{selectedImportFile.name}</p>
                            <p className="mt-0.5 text-[10px] text-slate-400">{formatImportFileSize(selectedImportFile.size)} · Ready to validate and import</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); clearImportFile(); }}
                          disabled={importing}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-bold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        >
                          <X size={13} /> Remove
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-3 text-slate-400">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                          <Upload size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-600">No workbook selected</p>
                          <p className="mt-0.5 text-[10px]">Select or drag a file above to continue.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {importFileError && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <p className="text-[11px] font-medium leading-5">{importFileError}</p>
                  </div>
                )}

                {/* Guidance */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <Info size={16} className="mt-0.5 shrink-0 text-slate-500" />
                    <div>
                      <p className="text-xs font-bold text-slate-700">Import guidance</p>
                      <ul className="mt-1.5 space-y-1 text-[10px] leading-4 text-slate-500">
                        <li>• Use the approved IPQC Excel column format.</li>
                        <li>• Finding Status is imported separately from ICAR Status.</li>
                        <li>• Records are appended to MySQL; existing rows are not automatically removed.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Progress */}
                {importing && importProgress.total > 0 && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-blue-700">
                      <span>Saving records to database</span>
                      <span>{importProgress.current} / {importProgress.total}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-200"
                        style={{ width: `${Math.min(100, (importProgress.current / importProgress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-end md:px-7">
                <button
                  type="button"
                  onClick={closeImportModal}
                  disabled={importing}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={importing || !selectedImportFile}
                  onClick={handleExcelImportProcess}
                  className="inline-flex h-10 min-w-[210px] items-center justify-center gap-2 rounded-lg bg-brand-orange px-5 text-xs font-bold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  {importing ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Processing records...
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      Process & Save to Database
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLoginModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]"
            onMouseDown={(e) => { if (e.target === e.currentTarget) closeLoginModal(); }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-login-title"
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
            >
              <div className="border-b border-slate-100 px-7 py-6 sm:px-8">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-brand-orange">
                    <Lock size={20} strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h3 id="account-login-title" className="text-[21px] font-black tracking-[-0.02em] text-slate-900">IPQC Tracker</h3>
                  </div>
                </div>
              </div>

              <div className="px-7 py-6 sm:px-8">
                <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => { setLoginMode('user'); resetAdminMfaFlow(); setLoginError(''); }}
                    className={`h-10 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${loginMode === 'user' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Employee
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMode('admin'); resetAdminMfaFlow(); setLoginError(''); }}
                    className={`h-10 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${loginMode === 'admin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Administrator
                  </button>
                </div>

                <form onSubmit={loginMode === 'admin' && adminMfaStage !== 'credentials' ? handleAdminMfaSubmit : handleLogin} className="space-y-5">
                  {loginMode === 'user' ? (
                    <>
                      <div>
                        <label htmlFor="employee-login-select" className="mb-2 block text-[12px] font-bold text-slate-700">Who are you?</label>
                        <div className="relative">
                          <select
                            id="employee-login-select"
                            value={selectedEmployeeId}
                            onChange={(e) => { setSelectedEmployeeId(e.target.value); if (loginError) setLoginError(''); }}
                            disabled={loggingIn || publicEmployeesLoading}
                            autoFocus
                            className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 pr-10 text-[13px] font-semibold text-slate-900 outline-none transition-all hover:border-slate-300 focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-orange-100/70 disabled:opacity-60"
                          >
                            <option value="">{publicEmployeesLoading ? 'Loading employees...' : 'Select your name'}</option>
                            {publicEmployees.map(employee => (
                              <option key={employee.id} value={employee.employeeId}>
                                {employee.fullName} — {employee.employeeId}{employee.jobTitle ? ` · ${employee.jobTitle}` : ''}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="employee-login-pin" className="mb-2 block text-[12px] font-bold text-slate-700">6-digit PIN</label>
                        <input
                          id="employee-login-pin"
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          value={loginPin}
                          onChange={(e) => { setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 6)); if (loginError) setLoginError(''); }}
                          placeholder="••••••"
                          autoComplete="off"
                          disabled={loggingIn}
                          className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 text-center font-mono text-lg font-black tracking-[0.35em] text-slate-900 outline-none transition-all placeholder:tracking-[0.25em] placeholder:text-slate-300 hover:border-slate-300 focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-orange-100/70 disabled:opacity-60"
                        />
                      </div>
                    </>
                  ) : adminMfaStage === 'credentials' ? (
                    <>
                      <div>
                        <label htmlFor="account-login-username" className="mb-2 block text-[12px] font-bold text-slate-700">Administrator username</label>
                        <input
                          id="account-login-username"
                          type="text"
                          value={loginUsername}
                          onChange={(e) => { setLoginUsername(e.target.value); if (loginError) setLoginError(''); }}
                          placeholder="Enter admin username"
                          autoComplete="username"
                          autoFocus
                          disabled={loggingIn}
                          className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 text-[13px] font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-orange-100/70 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label htmlFor="account-login-password" className="mb-2 block text-[12px] font-bold text-slate-700">Password</label>
                        <div className="relative">
                          <input
                            id="account-login-password"
                            type={showLoginPassword ? 'text' : 'password'}
                            value={loginPassword}
                            onChange={(e) => { setLoginPassword(e.target.value); if (loginError) setLoginError(''); }}
                            placeholder="Enter password"
                            autoComplete="current-password"
                            disabled={loggingIn}
                            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 pr-12 text-[13px] font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-orange-100/70 disabled:opacity-60"
                          />
                          <button type="button" onClick={() => setShowLoginPassword(value => !value)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-700">
                            {showLoginPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : adminMfaStage === 'setup' ? (
                    <>
                      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-orange shadow-sm"><Smartphone size={16} /></div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-black text-slate-800">Set up authenticator</p>
                          <p className="mt-1 text-[10px] leading-4 text-slate-500">Scan the QR code with your authenticator app, then enter the current 6-digit code.</p>
                        </div>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
                          {mfaOtpAuthUrl ? (
                            <QRCodeSVG
                              value={mfaOtpAuthUrl}
                              size={188}
                              level="M"
                              bgColor="#FFFFFF"
                              fgColor="#0F172A"
                              title={`IPQC Tracker authenticator setup for ${mfaAccountLabel}`}
                            />
                          ) : (
                            <div className="flex h-[188px] w-[188px] items-center justify-center rounded-xl bg-slate-50 text-center text-[10px] font-semibold leading-4 text-slate-400">
                              QR code unavailable. Use the setup key below.
                            </div>
                          )}
                        </div>
                        <p className="mt-2 text-[9px] font-semibold text-slate-400">IPQC Tracker · {mfaAccountLabel}</p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => setShowMfaSetupKey(value => !value)}
                          className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
                        >
                          <span className="text-[10px] font-bold text-slate-600">Can't scan the QR code?</span>
                          <span className="text-[9px] font-black uppercase tracking-wider text-brand-orange">{showMfaSetupKey ? 'Hide key' : 'Show setup key'}</span>
                        </button>
                        {showMfaSetupKey && (
                          <div className="border-t border-slate-100 p-3">
                            <div className="flex gap-2">
                              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2.5 font-mono text-[10px] font-black tracking-[0.1em] text-slate-700 break-all">{mfaSetupKey}</div>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard?.writeText(mfaSetupKey)}
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                title="Copy setup key"
                              ><Copy size={14} /></button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <label htmlFor="admin-mfa-code" className="mb-2 block text-[12px] font-bold text-slate-700">6-digit authenticator code</label>
                        <input
                          id="admin-mfa-code"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={mfaCode}
                          onChange={(e) => { setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (loginError) setLoginError(''); }}
                          placeholder="000000"
                          autoFocus
                          disabled={loggingIn}
                          className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 text-center font-mono text-lg font-black tracking-[0.3em] text-slate-900 outline-none transition-all focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-orange-100/70 disabled:opacity-60"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-orange shadow-sm"><Smartphone size={16} /></div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-black text-slate-800">Two-step verification</p>
                          <p className="mt-1 text-[10px] leading-4 text-slate-500">Enter the current code from your authenticator app for {mfaAccountLabel}.</p>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="admin-mfa-code" className="mb-2 block text-[12px] font-bold text-slate-700">Authenticator code</label>
                        <input
                          id="admin-mfa-code"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={mfaCode}
                          onChange={(e) => { setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (loginError) setLoginError(''); }}
                          placeholder="000000"
                          autoFocus
                          disabled={loggingIn}
                          className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 text-center font-mono text-lg font-black tracking-[0.3em] text-slate-900 outline-none transition-all focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-orange-100/70 disabled:opacity-60"
                        />
                      </div>
                    </>
                  )}

                  {loginError && (
                    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-rose-700">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <p className="text-[11px] font-semibold leading-5">{loginError}</p>
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
                    {loginMode === 'admin' && adminMfaStage !== 'credentials' ? (
                      <button
                        type="button"
                        onClick={() => { resetAdminMfaFlow(); setLoginError(''); }}
                        disabled={loggingIn}
                        className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-[12px] font-bold text-slate-600 hover:bg-slate-50 sm:min-w-[110px]"
                      >Back</button>
                    ) : isAuthenticated ? (
                      <button type="button" onClick={closeLoginModal} disabled={loggingIn} className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-[12px] font-bold text-slate-600 hover:bg-slate-50 sm:min-w-[110px]">Cancel</button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={loggingIn || (loginMode === 'user'
                        ? !selectedEmployeeId || loginPin.length !== 6
                        : adminMfaStage === 'credentials'
                          ? !loginUsername.trim() || !loginPassword
                          : mfaCode.length !== 6)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-orange px-5 text-[12px] font-black text-white shadow-[0_8px_20px_rgba(241,93,34,0.22)] transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:min-w-[132px]"
                    >
                      {loggingIn
                        ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" /> Verifying</>
                        : loginMode === 'admin' && adminMfaStage === 'setup'
                          ? <>Enable MFA <ArrowRight size={15} /></>
                          : loginMode === 'admin' && adminMfaStage === 'verify'
                            ? <>Verify <ArrowRight size={15} /></>
                            : <>Continue <ArrowRight size={15} /></>}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCredentialChangeModal && currentUser && authToken && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px]"
          >
            <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} className="w-full max-w-[430px] rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-100 px-7 py-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><ShieldCheck size={18} /></div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Secure your account</h3>
                    <p className="mt-1 text-[11px] font-medium leading-5 text-slate-500">
                      {currentUser.role === 'user'
                        ? 'Replace the temporary PIN given by your administrator with your own 6-digit PIN.'
                        : 'Replace the temporary administrator password before using protected system controls.'}
                    </p>
                  </div>
                </div>
              </div>
              <form onSubmit={handleCredentialChange} className="space-y-4 px-7 py-6">
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold text-slate-700">{currentUser.role === 'user' ? 'New 6-digit PIN' : 'New password'}</label>
                  <input
                    type="password"
                    inputMode={currentUser.role === 'user' ? 'numeric' : undefined}
                    maxLength={currentUser.role === 'user' ? 6 : undefined}
                    value={newCredential}
                    onChange={(e) => setNewCredential(currentUser.role === 'user' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
                    placeholder={currentUser.role === 'user' ? '••••••' : 'Minimum 12 characters'}
                    autoFocus
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold text-slate-700">Confirm {currentUser.role === 'user' ? 'PIN' : 'password'}</label>
                  <input
                    type="password"
                    inputMode={currentUser.role === 'user' ? 'numeric' : undefined}
                    maxLength={currentUser.role === 'user' ? 6 : undefined}
                    value={confirmCredential}
                    onChange={(e) => setConfirmCredential(currentUser.role === 'user' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
                    placeholder={currentUser.role === 'user' ? '••••••' : 'Repeat password'}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                  />
                </div>
                {credentialChangeError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-semibold text-rose-700">{credentialChangeError}</div>}
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-medium leading-4 text-slate-500">
                  {currentUser.role === 'user' ? 'Use a PIN you can remember but others cannot easily guess. Avoid repeated digits such as 111111.' : 'Use at least 12 characters and do not reuse a personal password.'}
                </div>
                <button
                  type="submit"
                  disabled={changingCredential || !newCredential || !confirmCredential}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-wider text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {changingCredential ? 'Updating...' : currentUser.role === 'user' ? 'Set my PIN' : 'Set new password'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global operation notifications: successes are transient; contextual form errors remain inline. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[220] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 sm:bottom-5 sm:right-5" aria-live="polite" aria-atomic="true">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const visual = toast.kind === 'success'
              ? { shell: 'border-emerald-200', icon: 'bg-emerald-50 text-emerald-600', title: 'text-emerald-950' }
              : toast.kind === 'error'
                ? { shell: 'border-rose-200', icon: 'bg-rose-50 text-rose-600', title: 'text-rose-950' }
                : toast.kind === 'warning'
                  ? { shell: 'border-amber-200', icon: 'bg-amber-50 text-amber-600', title: 'text-amber-950' }
                  : { shell: 'border-sky-200', icon: 'bg-sky-50 text-sky-600', title: 'text-sky-950' };

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className={`pointer-events-auto overflow-hidden rounded-xl border bg-white shadow-[0_16px_45px_rgba(15,23,42,0.18)] ${visual.shell}`}
                role={toast.kind === 'error' ? 'alert' : 'status'}
              >
                <div className="flex items-start gap-3 p-3.5">
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${visual.icon}`}>
                    {toast.kind === 'success' ? <CheckCircle2 size={16} /> : toast.kind === 'info' ? <Info size={16} /> : <AlertCircle size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] font-black ${visual.title}`}>{toast.title}</p>
                    {toast.message && <p className="mt-0.5 text-[10px] font-medium leading-4 text-slate-500">{toast.message}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Dismiss notification"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {previewImage && (
          <div 
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-12 bg-slate-900/95 backdrop-blur-xl"
            onClick={() => setPreviewImage(null)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative max-w-5xl max-h-full flex items-center justify-center group"
            >
               <button 
                className="absolute -top-12 right-0 md:-right-12 text-white/50 hover:text-white transition-colors"
                onClick={() => setPreviewImage(null)}
              >
                <X size={32} />
              </button>
              <img 
                src={previewImage} 
                alt="Audit Detail" 
                className="max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl border-4 border-white/10 object-contain shadow-brand-orange/30"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active, collapsed, onClick, disabled }: { icon: any, label: string, active: boolean, collapsed: boolean, onClick: () => void, disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? `${label} — requires admin login` : collapsed ? label : undefined}
      aria-label={label}
      className={`relative flex min-h-11 w-full items-center rounded-xl text-[11px] font-semibold transition-all duration-200 ${
        collapsed ? 'justify-center px-0' : 'gap-3 px-3.5'
      } ${
        disabled
          ? 'cursor-not-allowed text-slate-600 opacity-40'
          : active
            ? 'bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_6px_18px_rgba(0,0,0,0.08)]'
            : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100'
      }`}
    >
      {active && !disabled && (
        <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-brand-orange" aria-hidden="true" />
      )}
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-all ${
        active && !disabled ? 'text-brand-orange' : ''
      }`}>
        {icon}
      </span>
      {!collapsed && (
        <span className="min-w-0 truncate whitespace-nowrap uppercase tracking-[0.08em]">
          {label}
        </span>
      )}
    </button>
  );
}

function KPICard({ label, value, trend, icon, color }: { label: string, value: string | number, trend: string, icon: any, color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-emerald-500/5',
    orange: 'bg-orange-50 text-orange-600 border-orange-100 shadow-orange-500/5',
    blue: 'bg-blue-50 text-blue-600 border-blue-100 shadow-blue-500/5',
    slate: 'bg-slate-50 text-slate-600 border-slate-100 shadow-slate-500/5',
    rose: 'bg-rose-50 text-rose-600 border-rose-100 shadow-rose-500/5'
  };

  return (
    <div className={`p-4 rounded-2xl border bg-white shadow-lg transition-all hover:scale-[1.02] ${colors[color] || colors.slate}`}>
      <div className="flex justify-between items-start mb-3">
        <div className="p-2 rounded-lg bg-white shadow-sm border border-inherit">
          {icon}
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-80">{trend}</span>
      </div>
      <div>
        <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
        <div className="text-2xl font-black text-slate-800 tracking-tight">{value}</div>
      </div>
    </div>
  );
}


function MultiSelectFilter({
  label,
  options = [],
  values = [],
  onChange,
  allLabel,
  searchable = true,
}: {
  label: string;
  options: Array<string | number>;
  values: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const normalizedOptions = useMemo(
    () => Array.from(new Set(options.map((option) => String(option)))),
    [options]
  );

  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((option) => option.toLowerCase().includes(q));
  }, [normalizedOptions, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const selectedSummary = (() => {
    if (values.length === 0) return allLabel || `All ${label}`;
    if (values.length === 1) return values[0];
    return `${values[0]} +${values.length - 1}`;
  })();

  const allSelected = normalizedOptions.length > 0 && values.length === normalizedOptions.length;

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1.5">
      <label className="px-1 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">
        {label}
      </label>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={`flex h-[38px] w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left transition-all ${
          open
            ? 'border-brand-orange ring-4 ring-brand-orange/5'
            : values.length > 0
              ? 'border-slate-300 shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
              : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className={`min-w-0 truncate text-[11px] font-bold ${values.length > 0 ? 'text-slate-800' : 'text-slate-500'}`}>
          {selectedSummary}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {values.length > 1 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-orange/10 px-1.5 py-0.5 text-[8px] font-black text-brand-orange">
              {values.length}
            </span>
          )}
          <ChevronDown size={13} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 top-[62px] z-[90] min-w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.16)]"
          >
            {(searchable || normalizedOptions.length > 7) && (
              <div className="border-b border-slate-100 p-2.5">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${label.toLowerCase()}...`}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-[10px] font-semibold text-slate-700 outline-none transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-brand-orange focus:bg-white focus:ring-3 focus:ring-brand-orange/5"
                    autoFocus
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => onChange(allSelected ? [] : normalizedOptions)}
                className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-500 transition-colors hover:text-slate-800"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
              {values.length > 0 && (
                <span className="text-[9px] font-bold text-slate-400">
                  {values.length} selected
                </span>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto p-1.5 custom-scrollbar">
              {visibleOptions.length > 0 ? (
                visibleOptions.map((option) => {
                  const checked = values.includes(option);
                  return (
                    <label
                      key={option}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[10px] font-semibold transition-colors ${
                        checked ? 'bg-orange-50 text-slate-800' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleValue(option)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-orange-500"
                      />
                      <span className="min-w-0 flex-1 truncate">{option}</span>
                    </label>
                  );
                })
              ) : (
                <div className="px-3 py-6 text-center text-[10px] font-semibold text-slate-400">
                  No matching options
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-3 py-2">
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={values.length === 0}
                className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-white transition-colors hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterInput({ label, value, onChange, type = 'text', options = [], placeholder }: any) {
  return (
    <div className="flex flex-col gap-1.5 overflow-hidden">
      <label className="px-1 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</label>
      {type === 'select' ? (
        <div className="relative group">
          <select 
            value={value} 
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-[11px] font-bold text-slate-700 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 focus:outline-none transition-all appearance-none cursor-pointer"
          >
            <option value="">ALL {label.toUpperCase()}</option>
            {options.map((opt: any) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
            <ChevronDown size={13} />
          </div>
        </div>
      ) : (
        <input 
          type={type} 
          value={value}
          placeholder={placeholder || `Filter ${label}...`}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-[11px] font-bold text-slate-700 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 focus:outline-none transition-all placeholder:text-slate-300 placeholder:font-normal"
        />
      )}
    </div>
  );
}

function FormInput({ label, required, value, onChange, type = 'text', placeholder, helper }: any) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-slate-700">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
      />
      {helper && <span className="px-0.5 text-[10px] leading-4 text-slate-400">{helper}</span>}
    </div>
  );
}

function FormSection({ icon, title, description, children }: { icon: any, title: string, description?: string, children: any }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 pb-3 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-700">{title}</h3>
          {description && <p className="text-[10px] text-slate-400 font-medium mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="space-y-5">
        {children}
      </div>
    </div>
  );
}

function AutoField({ label, value, accent = 'slate' }: { label: string, value?: string, accent?: 'slate' | 'orange' }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-slate-700">{label}</label>
      <div className={`flex h-11 w-full items-center truncate rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold ${
        accent === 'orange' ? 'text-brand-orange' : 'text-slate-600'
      }`}>
        {value || '—'}
      </div>
    </div>
  );
}

function DetailRow({ label, value, accent, mono }: { label: string, value: string, accent?: boolean, mono?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 ${accent ? 'bg-brand-orange/[0.04] -mx-2 px-2 rounded-lg' : ''}`}>
      <span className="text-[11px] font-medium text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm text-right truncate ${accent ? 'font-semibold text-brand-orange' : 'font-medium text-slate-800'} ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}


function RecordDetailSection({ number, icon, title, description, children }: { number: string, icon: any, title: string, description?: string, children: any }) {
  return (
    <section className="border-b border-slate-200 p-5 last:border-b-0 md:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">
          {number}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-slate-900">
            <span className="text-brand-orange">{icon}</span>
            <h3 className="text-sm font-bold">{title}</h3>
          </div>
          {description && <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function RecordDetailField({ label, value, accent, mono }: { label: string, value: any, accent?: boolean, mono?: boolean }) {
  const renderedValue = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-1.5 break-words text-sm ${accent ? 'font-bold text-brand-orange' : 'font-semibold text-slate-800'} ${mono ? 'font-mono text-[13px]' : ''}`}>
        {renderedValue}
      </p>
    </div>
  );
}

function FormSelect({ label, value, onChange, options, required, helper, placeholder, disabled = false }: any) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-slate-700">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      <div className="group relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3.5 pr-9 text-sm font-medium text-slate-800 outline-none transition-all focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          {placeholder && <option value="" disabled={required}>{placeholder}</option>}
          {options.map((opt: any) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand-orange" />
      </div>
      {helper && <span className="px-0.5 text-[10px] leading-4 text-slate-400">{helper}</span>}
    </div>
  );
}
