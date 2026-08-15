import { useState, useMemo, FormEvent, useRef, ChangeEvent, useEffect, DragEvent } from 'react';
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
  AlertCircle
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
};

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

const DEPARTMENTS = [
  'Production Team',
  'Test Team',
  'IE Team',
  'Quality Team',
  'Calibration Team',
  'PE Team'
];

const CATEGORIES = [
  'Compliance_6S',
  'Calibration_PM',
  'Documentation_And_Process_Adherence',
  'ESD_Control',
  'Material_Control_And_Chemical_Management',
  'Safety_Concern',
  'Tooling_Labeling',
  'Training_Certification'
];

const FINDING_DETAILS = [
  'Visual Standard Expired',
  'Assembly process conducted without glove usage',
  'Cable wire damage',
  'Calibration Label damage, Torn on Tools / Equipment',
  'Calibration Overdue ESD Monitor',
  'Calibration Overdue Torque Drive',
  'Chemical / Material Overdue',
  'Dust on workstation/rack/ect',
  'Dustbin located at non-kanban area',
  'Equipment without Calibration / PM Label',
  'ESD Monitoring not function',
  'Improper storage of Kit / Bulk Material',
  'Improper storage of Tool/Equipment',
  'Ionizer turn off',
  'IPA without Expiry Date Label',
  'Missing Label Expiry Date',
  'Mix material inside the material bin',
  'No ESD grounding points',
  'No Insulative Mat',
  'No Set-Up Checklist displayed',
  'Not Wear Safety Glass',
  'Preventive Maintenance Overdue',
  'Setup check list not updated',
  'Torque number is smear',
  'Unnecessary item/material found on the workstation'
];

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
  Compliance_6S: 'Method',
  Calibration_PM: 'Machine',
  Documentation_And_Process_Adherence: 'Method',
  ESD_Control: 'Machine',
  Material_Control_And_Chemical_Management: 'Material',
  Safety_Concern: 'Man',
  Tooling_Labeling: 'Material',
  Training_Certification: 'Man'
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
  const [view, setView] = useState<ViewState>('ipqc');
  const [records, setRecords] = useState<IPQCAuditRecord[]>([]); 
  const [powerBiUrl, setPowerBiUrl] = useState<string>(''); 
  const [dashboardMode, setDashboardMode] = useState<'system' | 'powerbi'>('system');
  // Auth: a signed token from the server is the source of truth for admin
  // access, not a UI-only boolean. Persisted so a refresh doesn't log you out.
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('ipqc_admin_token'));
  const [adminUsername, setAdminUsername] = useState<string | null>(() => localStorage.getItem('ipqc_admin_username'));
  const isAdmin = !!authToken;

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  // Distinguishes "your token expired mid-session" from a fresh login attempt,
  // so we can explain *why* the modal popped up instead of just showing it.
  const [sessionExpired, setSessionExpired] = useState(false);

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
  
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importDragActive, setImportDragActive] = useState(false);
  const [importFileError, setImportFileError] = useState('');
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  // Settings State for CRUD Operations
  const [auditorsList, setAuditorsList] = useState(INITIAL_AUDITORS);
  const [newAuditorName, setNewAuditorName] = useState('');
  const [editingAuditorIndex, setEditingAuditorIndex] = useState<number | null>(null);
  const [editAuditorValue, setEditAuditorValue] = useState('');
  
  const [platformsList] = useState(PLATFORMS);
  const [mqeMappings, setMqeMappings] = useState(INITIAL_PLATFORM_MQE_MAPPING);
  const [selectedPlatformForMapping, setSelectedPlatformForMapping] = useState(PLATFORMS[0]);
  const [newMqeName, setNewMqeName] = useState('');

  const [analyticsDimension, setAnalyticsDimension] = useState<'platform' | 'category' | 'mqe' | 'auditor'>('platform');

  useEffect(() => {
    const fetchAudits = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/records`);
        if (response.ok) {
          const data = await response.json();
          setRecords(Array.isArray(data) ? data.map(normalizeRecord) : []);
        }
      } catch (error) {
        console.error('Error fetching data from database:', error);
      }
    };
    fetchAudits();
  }, []);

  // Load the saved auditor list & platform-MQE mapping from the database.
  // Empty results mean no admin has saved custom values yet, in which case
  // we just keep the built-in defaults these states were initialized with.
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.auditors) && data.auditors.length > 0) {
            setAuditorsList(data.auditors);
          }
          if (data.mqeMappings && Object.keys(data.mqeMappings).length > 0) {
            setMqeMappings(data.mqeMappings);
          }
        }
      } catch (error) {
        console.error('Error fetching settings from database:', error);
      }
    };
    fetchSettings();
  }, []);

  // On load, confirm a saved token is still valid rather than trusting it
  // blindly - an expired or tampered token gets cleared immediately.
  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_BASE_URL}/api/verify`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async response => {
        if (!response.ok) {
          localStorage.removeItem('ipqc_admin_token');
          localStorage.removeItem('ipqc_admin_username');
          setAuthToken(null);
          setAdminUsername(null);
        } else {
          const data = await response.json();
          if (data.username) {
            localStorage.setItem('ipqc_admin_username', data.username);
            setAdminUsername(data.username);
          }
        }
      })
      .catch(() => {
        // Network error - leave the token as-is; authFetch will reconcile on next write.
      });
  }, []);

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

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const data = await response.json();
      if (response.ok && data.token) {
        localStorage.setItem('ipqc_admin_token', data.token);
        localStorage.setItem('ipqc_admin_username', loginUsername);
        setAuthToken(data.token);
        setAdminUsername(loginUsername);
        setShowLoginModal(false);
        setSessionExpired(false);
        setLoginPassword('');
        setLoginUsername('');
      } else {
        setLoginError(data.error || 'Invalid username or password');
      }
    } catch (err) {
      setLoginError('Could not reach the server. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('ipqc_admin_token');
    localStorage.removeItem('ipqc_admin_username');
    setAuthToken(null);
    setAdminUsername(null);
    setSessionExpired(false);
    if (view === 'settings') setView('ipqc');
  };

  // Attaches the admin token to write requests (POST/PUT/DELETE). If the
  // server rejects it as expired/invalid, we log out locally so the UI
  // reflects the real state instead of pretending the session is still good.
  const authFetch = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      localStorage.removeItem('ipqc_admin_token');
      localStorage.removeItem('ipqc_admin_username');
      setAuthToken(null);
      setAdminUsername(null);
      setSessionExpired(true);
      setShowLoginModal(true);
    }
    return response;
  };

  const getMqeForPlatform = (platform: string) => {
    return mqeMappings[platform as keyof typeof mqeMappings] || 'Unassigned';
  };

  // --- CRUD Handlers for Settings ---
  // Every edit here is persisted to /api/settings immediately so all users
  // see the same list, instead of it living only in this browser tab's memory.
  const [savingSettings, setSavingSettings] = useState(false);
  const saveSettings = async (nextAuditors: string[], nextMqeMappings: Record<string, string>) => {
    setSavingSettings(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditors: nextAuditors, mqeMappings: nextMqeMappings }),
      });
      if (!response.ok) {
        alert('Failed to save this change to the database. It may be lost on refresh - please try again.');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      alert('Could not reach the server to save this change. It may be lost on refresh.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddAuditor = (e: FormEvent) => {
    e.preventDefault();
    if (newAuditorName.trim() && !auditorsList.includes(newAuditorName.trim())) {
      const updated = [...auditorsList, newAuditorName.trim()];
      setAuditorsList(updated);
      setNewAuditorName('');
      saveSettings(updated, mqeMappings);
    }
  };

  const handleSaveEditAuditor = (index: number) => {
    if (editAuditorValue.trim()) {
      const updated = [...auditorsList];
      updated[index] = editAuditorValue.trim();
      setAuditorsList(updated);
      setEditingAuditorIndex(null);
      saveSettings(updated, mqeMappings);
    }
  };

  const handleDeleteAuditor = (auditorToDelete: string) => {
    const updated = auditorsList.filter(a => a !== auditorToDelete);
    setAuditorsList(updated);
    saveSettings(updated, mqeMappings);
  };

  const handleAddOrUpdateMqeMapping = (e: FormEvent) => {
    e.preventDefault();
    if (newMqeName.trim()) {
      const updated = {
        ...mqeMappings,
        [selectedPlatformForMapping]: newMqeName.trim()
      };
      setMqeMappings(updated);
      setNewMqeName('');
      saveSettings(auditorsList, updated);
    }
  };

  const handleClearMqeMapping = (platform: string) => {
    const updated = { ...mqeMappings };
    delete updated[platform];
    setMqeMappings(updated);
    saveSettings(auditorsList, updated);
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
      alert('All records already match the current Platform - MQE mapping.');
      return;
    }

    if (!confirm(`This will update ${toFix.length} record(s) to match the current Platform - MQE mapping. Continue?`)) {
      return;
    }

    setRecalculating(true);
    let successCount = 0;
    try {
      for (const record of toFix) {
        const correctMqe = getMqeForPlatform(record.platform);
        const response = await authFetch(`${API_BASE_URL}/api/records/${record.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...record, mqeEngineer: correctMqe }),
        });
        if (response.ok) successCount++;
      }

      const refreshResponse = await fetch(`${API_BASE_URL}/api/records`);
      if (refreshResponse.ok) {
        setRecords((await refreshResponse.json()).map(normalizeRecord));
      }

      alert(`Updated ${successCount} out of ${toFix.length} record(s).`);
    } catch (err) {
      console.error('Recalculate MQE error:', err);
      alert('Something went wrong while updating records. Some records may not have been updated.');
    } finally {
      setRecalculating(false);
    }
  };
  // ----------------------------------

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  
  const [filterAuditor, setFilterAuditor] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterFindings, setFilterFindings] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState(''); // Finding status: Open / Closed
  const [filterIcarStatus, setFilterIcarStatus] = useState(''); // ICAR status: Locked / Submitted
  const [filterShift, setFilterShift] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterWW, setFilterWW] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newAudit, setNewAudit] = useState<Partial<IPQCAuditRecord>>({
    no: undefined,
    auditDate: new Date().toISOString().split('T')[0],
    ww: calculateWW(new Date().toISOString().split('T')[0]),
    shift: SHIFTS[0],
    auditors: auditorsList[0],
    personOnJob: '',
    department: DEPARTMENTS[0],
    platform: PLATFORMS[0],
    areaStation: '',
    groupFinding: CATEGORY_GROUP_MAPPING[CATEGORIES[0]],
    category: CATEGORIES[0],
    detailsFindings: FINDING_DETAILS[0],
    remark: '',
    status: 'Open',
    icarNum: 'N/A',
    icarStatus: 'Locked',
    mqeEngineer: INITIAL_PLATFORM_MQE_MAPPING[PLATFORMS[0]] || ''
  });

  useEffect(() => {
    if (newAudit.auditDate) {
      const calculatedWW = calculateWW(newAudit.auditDate);
      if (calculatedWW !== newAudit.ww) {
        setNewAudit(prev => ({ ...prev, ww: calculatedWW }));
      }
    }
  }, [newAudit.auditDate]);

  const handleCategoryChange = (cat: string) => {
    setNewAudit(prev => ({
      ...prev,
      category: cat,
      groupFinding: CATEGORY_GROUP_MAPPING[cat] || ''
    }));
  };

  const handlePlatformChange = (plat: string) => {
    setNewAudit(prev => ({
      ...prev,
      platform: plat,
      mqeEngineer: getMqeForPlatform(plat)
    }));
  };

  const handleIcarNumChange = (num: string) => {
    const trimmed = num.trim();
    const isSubmitted = trimmed !== '' && trimmed !== 'N/A';
    setNewAudit(prev => ({
      ...prev,
      icarNum: num,
      icarStatus: isSubmitted ? 'Submitted' : 'Locked'
    }));
  };

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchesSearch = searchQuery === '' || Object.values(r).some(value => 
        value !== null && value !== undefined && String(value).toLowerCase().includes(searchQuery.toLowerCase())
      );
      
      const matchesAuditor = !filterAuditor || String(r.auditors) === String(filterAuditor);
      const matchesDept = !filterDept || String(r.department) === String(filterDept);
      const matchesFindings = !filterFindings || String(r.groupFinding) === String(filterFindings);
      const matchesDate = !filterDate || String(r.auditDate) === String(filterDate);
      const matchesWW = !filterWW || String(r.ww) === String(filterWW);
      const matchesCategory = !filterCategory || String(r.category) === String(filterCategory);
      const matchesStatus = !filterStatus || getFindingStatus(r) === filterStatus;
      const matchesIcarStatus = !filterIcarStatus || String(r.icarStatus || 'Locked') === String(filterIcarStatus);
      const matchesShift = !filterShift || String(r.shift) === String(filterShift);
      const matchesPlatform = !filterPlatform || String(r.platform) === String(filterPlatform);

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
  const [openRowAction, setOpenRowAction] = useState<string | number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    const payload = {
      ...newAudit,
      groupFinding: CATEGORY_GROUP_MAPPING[newAudit.category || ''] || '',
      ww: calculateWW(newAudit.auditDate || new Date().toISOString().split('T')[0]),
      status: normalizeFindingStatus(newAudit.status) || 'Open',
      icarStatus: (newAudit.icarNum && newAudit.icarNum !== 'N/A') ? 'Submitted' : 'Locked'
    };

    try {
      if (editingId) {
        const response = await fetch(`${API_BASE_URL}/api/records/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          const updated = normalizeRecord(await response.json());
          setRecords(records.map(r => String(r.id) === String(editingId) ? updated : r));
          setHighlightedId(updated.id);
        } else {
          alert('Failed to update record.');
        }
      } else {
        const response = await fetch(`${API_BASE_URL}/api/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const created = normalizeRecord(await response.json());
          setRecords([...records, created]);
          setHighlightedId(created.id);
        } else {
          alert('Failed to save the audit record to database.');
        }
      }

      setNewAudit({
        no: undefined,
        auditDate: new Date().toISOString().split('T')[0],
        ww: calculateWW(new Date().toISOString().split('T')[0]),
        shift: SHIFTS[0],
        auditors: auditorsList[0] || '',
        personOnJob: '',
        department: DEPARTMENTS[0],
        platform: PLATFORMS[0],
        areaStation: '',
        groupFinding: CATEGORY_GROUP_MAPPING[CATEGORIES[0]],
        category: CATEGORIES[0],
        detailsFindings: FINDING_DETAILS[0],
        remark: '',
        status: 'Open',
        icarNum: 'N/A',
        icarStatus: 'Locked',
        mqeEngineer: getMqeForPlatform(PLATFORMS[0]),
        picture: '',
      });
      setEditingId(null);
      setView('ipqc');
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error submitting audit:', error);
      alert('A network error occurred while contacting the server.');
    }
  };

  const handleEditClick = (record: IPQCAuditRecord) => {
    setNewAudit({
      no: record.no,
      auditDate: record.auditDate || '',
      ww: record.ww || '',
      shift: record.shift || 'A',
      auditors: record.auditors || auditorsList[0],
      personOnJob: record.personOnJob || '',
      department: record.department || DEPARTMENTS[0],
      platform: record.platform || PLATFORMS[0],
      areaStation: record.areaStation || '',
      groupFinding: record.groupFinding || '',
      category: record.category || CATEGORIES[0],
      detailsFindings: record.detailsFindings || FINDING_DETAILS[0],
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
    if (confirm('Are you sure you want to delete this audit record?')) {
      try {
        await fetch(`${API_BASE_URL}/api/records/${id}`, { method: 'DELETE' });
        setRecords(records.filter(r => String(r.id) !== String(id)));
      } catch (err) {
        alert('Failed to delete record.');
      }
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
          groupFinding: row.groupFinding || CATEGORY_GROUP_MAPPING[CATEGORIES[0]],
          category: row.category || CATEGORIES[0],
          detailsFindings: row.detailsFindings || FINDING_DETAILS[0],
          remark: row.remark || '',
          status: importedStatus || 'Open',
          icarNum: row.icarNum || 'N/A',
          icarStatus: row.icarStatus || 'Locked',
          mqeEngineer: row.mqeEngineer || getMqeForPlatform(row.platform || PLATFORMS[0]),
          picture: row.picture || null
        };

        const response = await fetch(`${API_BASE_URL}/api/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) successCount++;
        else failedCount++;

        setImportProgress({ current: index + 1, total: importedRows.length });
      }

      const refreshResponse = await fetch(`${API_BASE_URL}/api/records`);
      if (refreshResponse.ok) {
        const latestData = await refreshResponse.json();
        setRecords(Array.isArray(latestData) ? latestData.map(normalizeRecord) : []);
      }

      if (failedCount > 0) {
        alert(`Import finished: ${successCount} saved, ${failedCount} failed. Review the server log before retrying failed rows.`);
      } else {
        alert(`Import complete. ${successCount} record${successCount === 1 ? '' : 's'} saved successfully.`);
      }

      setShowImportModal(false);
      setSelectedImportFile(null);
      setImportProgress({ current: 0, total: 0 });
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    } catch (err) {
      console.error('Import error:', err);
      setImportFileError(err instanceof Error ? err.message : 'The workbook could not be processed. Check its format and try again.');
    } finally {
      setImporting(false);
    }
  };

  // Header title changes with the active tab, replacing the old static
  // "IPQC TRACKER" label + the separate "IPQC Records Management" panel
  // that used to repeat the same info and eat vertical space.
  const viewTitles: Record<ViewState, string> = {
    dashboard: 'Analytics Dashboard',
    ipqc: 'IPQC Records',
    import: 'Import Records',
    checklist: 'Checklist',
    'add-audit': editingId ? 'Edit Finding' : 'Add Finding',
    history: 'History',
    settings: 'Admin Panel',
  };
  const headerTitle = view === 'ipqc' && selectedRecord ? 'Finding Details' : (viewTitles[view] || 'IPQC Tracker');
  const activeFilterCount = [
    filterAuditor, filterDept, filterFindings, filterCategory, filterStatus, filterIcarStatus,
    filterShift, filterPlatform, filterWW, filterDate
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

      <aside className={`fixed md:static inset-y-0 left-0 z-50 bg-sidebar-bg transition-all duration-300 flex flex-col shrink-0 overflow-hidden ${sidebarOpen ? 'w-[220px] translate-x-0' : 'w-0 -translate-x-full md:w-20 md:translate-x-0'}`}>
        <div className="p-6 flex items-center gap-3 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden bg-brand-orange text-white font-black text-xs">
            Q
          </div>
          <h1 className="font-black text-xs tracking-widest text-white uppercase whitespace-nowrap">IPQC TRACKER</h1>
        </div>

        <nav className="flex-1 space-y-1 mt-6 overflow-y-auto px-3">
          <div className="px-3 mb-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] italic opacity-50">Insights</span>
          </div>
          <NavItem 
            icon={<LayoutDashboard size={18} />} 
            label="Analytics" 
            active={view === 'dashboard'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => { setView('dashboard'); if (window.innerWidth < 768) setSidebarOpen(false); }}
          />

          <div className="px-3 mt-6 mb-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] italic opacity-50">Operations</span>
          </div>
          <NavItem 
            icon={<ClipboardCheck size={18} />} 
            label="IPQC Records" 
            active={view === 'ipqc'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => { setSelectedRecord(null); setView('ipqc'); if (window.innerWidth < 768) setSidebarOpen(false); }}
          />

          <div className="px-3 mt-6 mb-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] italic opacity-50">System</span>
          </div>
          <NavItem 
            icon={isAdmin ? <Settings size={18} /> : <Lock size={18} />} 
            label="Admin Panel" 
            active={view === 'settings'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            disabled={!isAdmin}
            onClick={() => {
              setView('settings');
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
                <div className={`relative w-8 h-8 rounded-full flex items-center justify-center text-white font-black text-xs shrink-0 ${isAdmin ? 'bg-emerald-500' : 'bg-slate-400'}`}>
                  {isAdmin ? (adminUsername ? adminUsername.charAt(0).toUpperCase() : 'A') : <User size={16} />}
                  {isAdmin && (
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
                    className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden z-50"
                  >
                    <div className="p-4 flex items-center gap-3 border-b border-slate-100 bg-slate-50/60">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0 ${isAdmin ? 'bg-emerald-500' : 'bg-slate-400'}`}>
                        {isAdmin ? (adminUsername ? adminUsername.charAt(0).toUpperCase() : 'A') : <User size={18} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-800 truncate">{isAdmin ? (adminUsername || 'Admin') : 'Guest'}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {isAdmin ? 'Administrator' : 'Viewing as guest'}
                        </p>
                      </div>
                    </div>

                    <div className="p-2">
                      {isAdmin ? (
                        <button
                          onClick={() => { logout(); setProfileMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors text-[11px] font-black uppercase tracking-widest"
                        >
                          <LogOut size={15} /> Sign Out
                        </button>
                      ) : (
                        <button
                          onClick={() => { setShowLoginModal(true); setProfileMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors text-[11px] font-black uppercase tracking-widest"
                        >
                          <LogIn size={15} /> Log In as Admin
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5 md:p-6 min-h-0 bg-[#f6f8fb] flex flex-col">
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
                      {/* Page toolbar */}
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          type="button"
                          onClick={() => setSelectedRecord(null)}
                          className="inline-flex w-fit items-center gap-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:text-brand-orange"
                        >
                          <ChevronLeft size={15} />
                          Back to IPQC records
                        </button>

                        <button
                          type="button"
                          onClick={() => { handleEditClick(selectedRecord); setSelectedRecord(null); }}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-orange px-4 text-[11px] font-bold text-white shadow-[0_6px_16px_rgba(241,93,34,0.18)] transition-all hover:brightness-110 active:translate-y-px"
                        >
                          <Pencil size={14} />
                          Edit finding
                        </button>
                      </div>

                      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
                        {/* Main record */}
                        <div className="min-w-0 space-y-4">
                          {/* Record identity */}
                          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <div className="p-5 md:p-6">
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                      <ClipboardCheck size={12} />
                                      Finding record {selectedRecord.no ? `No. ${selectedRecord.no}` : `#${selectedRecord.id}`}
                                    </span>
                                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
                                      getFindingStatus(selectedRecord) === 'Closed'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : getFindingStatus(selectedRecord) === 'Open'
                                          ? 'border-orange-200 bg-orange-50 text-orange-700'
                                          : 'border-slate-200 bg-slate-50 text-slate-500'
                                    }`}>
                                      {getFindingStatus(selectedRecord) === 'Closed' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                                      Finding: {getFindingStatus(selectedRecord) || 'Not set'}
                                    </span>
                                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
                                      selectedRecord.icarStatus === 'Submitted'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-amber-200 bg-amber-50 text-amber-700'
                                    }`}>
                                      {selectedRecord.icarStatus === 'Submitted' ? <Unlock size={10} /> : <Lock size={10} />}
                                      ICAR: {selectedRecord.icarStatus || 'Locked'}
                                    </span>
                                  </div>

                                  <h2 className="text-xl font-bold leading-tight tracking-tight text-slate-900 md:text-2xl">
                                    {selectedRecord.detailsFindings || 'Finding details'}
                                  </h2>
                                  <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
                                    Complete IPQC finding record with audit context, production ownership, corrective-action reference and supporting evidence.
                                  </p>
                                </div>

                                <div className="shrink-0 lg:text-right">
                                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">ICAR reference</p>
                                  <p className="mt-1 font-mono text-sm font-bold text-slate-700">{selectedRecord.icarNum || 'N/A'}</p>
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

                          {/* Structured record details */}
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <RecordDetailSection
                              number="01"
                              icon={<MapPin size={15} />}
                              title="Location & ownership"
                              description="Where the finding occurred and the engineering owner responsible for the platform."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                                <RecordDetailField label="Platform" value={selectedRecord.platform} />
                                <RecordDetailField label="Station / area" value={selectedRecord.areaStation} />
                                <RecordDetailField label="MQE engineer" value={selectedRecord.mqeEngineer} accent />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="02"
                              icon={<AlertCircle size={15} />}
                              title="Finding classification"
                              description="Classification and description captured during the audit."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                                <RecordDetailField label="Category" value={selectedRecord.category} />
                                <RecordDetailField label="Group finding" value={selectedRecord.groupFinding} />
                                <RecordDetailField label="Finding details" value={selectedRecord.detailsFindings} />
                              </div>

                              <div className="mt-5 border-t border-slate-100 pt-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Remarks / containment notes</p>
                                <p className={`mt-2 text-sm leading-6 ${selectedRecord.remark ? 'font-medium text-slate-700' : 'italic text-slate-400'}`}>
                                  {selectedRecord.remark || 'No additional remarks were recorded for this finding.'}
                                </p>
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="03"
                              icon={<Users size={15} />}
                              title="People & accountability"
                              description="Audit ownership and the person responsible at the point of finding."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                                <RecordDetailField label="IPQC auditor" value={selectedRecord.auditors} />
                                <RecordDetailField label="PIC (finding)" value={selectedRecord.personOnJob} />
                                <RecordDetailField label="Department" value={selectedRecord.department} />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="04"
                              icon={<CalendarDays size={15} />}
                              title="Audit context"
                              description="Date and production timing associated with this audit record."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                                <RecordDetailField label="Audit date" value={selectedRecord.auditDate} mono />
                                <RecordDetailField label="Work week (WW)" value={selectedRecord.ww} />
                                <RecordDetailField label="Shift" value={selectedRecord.shift} />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="05"
                              icon={<ClipboardCheck size={15} />}
                              title="Lifecycle & ICAR"
                              description="Finding resolution state and the separate corrective-action reference lifecycle."
                            >
                              <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
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
                                <RecordDetailField label="ICAR number" value={selectedRecord.icarNum || 'N/A'} mono />
                              </div>
                            </RecordDetailSection>

                            <RecordDetailSection
                              number="06"
                              icon={<ImageIcon size={15} />}
                              title="Evidence"
                              description="Supporting image attached to the audit finding."
                            >
                              {selectedRecord.picture ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewImage(getImageUrl(selectedRecord.picture!)!)}
                                  className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left"
                                >
                                  <div className="flex min-h-[260px] max-h-[520px] items-center justify-center bg-slate-50 p-3">
                                    <img
                                      src={getImageUrl(selectedRecord.picture)}
                                      className="max-h-[490px] w-full object-contain"
                                      referrerPolicy="no-referrer"
                                      alt="Finding evidence"
                                    />
                                  </div>
                                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
                                    <div>
                                      <p className="text-[11px] font-semibold text-slate-700">Audit evidence</p>
                                      <p className="mt-0.5 text-[10px] text-slate-400">Click the image to enlarge</p>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-brand-orange">View full size</span>
                                  </div>
                                </button>
                              ) : (
                                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
                                  <ImageIcon size={28} className="mb-3 text-slate-300" />
                                  <p className="text-sm font-semibold text-slate-600">No evidence image attached</p>
                                  <p className="mt-1 text-[11px] text-slate-400">This record was saved without a supporting photo.</p>
                                </div>
                              )}
                            </RecordDetailSection>
                          </div>
                        </div>

                        {/* Operational summary */}
                        <aside className="space-y-4 xl:sticky xl:top-0">
                          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Finding lifecycle</p>
                            <div className="mt-4 flex items-start gap-3">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                                getFindingStatus(selectedRecord) === 'Closed'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : getFindingStatus(selectedRecord) === 'Open'
                                    ? 'bg-orange-50 text-orange-600'
                                    : 'bg-slate-100 text-slate-500'
                              }`}>
                                {getFindingStatus(selectedRecord) === 'Closed' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900">{getFindingStatus(selectedRecord) || 'Status not set'}</p>
                                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                  {getFindingStatus(selectedRecord) === 'Closed'
                                    ? 'The finding has been resolved and marked closed.'
                                    : getFindingStatus(selectedRecord) === 'Open'
                                      ? 'The finding remains open and requires follow-up.'
                                      : 'This historical record has not yet been classified as open or closed.'}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                              <span className="text-[10px] font-medium text-slate-500">ICAR status</span>
                              <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold ${
                                selectedRecord.icarStatus === 'Submitted'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}>
                                {selectedRecord.icarStatus === 'Submitted' ? <Unlock size={10} /> : <Lock size={10} />}
                                {selectedRecord.icarStatus || 'Locked'}
                              </span>
                            </div>
                          </section>

                          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Record summary</p>
                                <p className="mt-1 text-[11px] text-slate-500">Key traceability information</p>
                              </div>
                              <Info size={15} className="text-slate-300" />
                            </div>
                            <div className="divide-y divide-slate-100">
                              <DetailRow label="Record no." value={String(selectedRecord.no ?? selectedRecord.id ?? '—')} mono />
                              <DetailRow label="Department" value={selectedRecord.department || '—'} />
                              <DetailRow label="Auditor" value={selectedRecord.auditors || '—'} />
                              <DetailRow label="MQE owner" value={selectedRecord.mqeEngineer || '—'} accent />
                              <DetailRow label="Evidence" value={selectedRecord.picture ? 'Attached' : 'None'} />
                            </div>
                          </section>

                          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Actions</p>
                            <div className="mt-4 space-y-2">
                              <button
                                type="button"
                                onClick={() => { handleEditClick(selectedRecord); setSelectedRecord(null); }}
                                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-[11px] font-bold text-white transition-colors hover:bg-slate-800"
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
                        onClick={() => exportToExcel(records)}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                      >
                        <Download size={14} className="text-emerald-600" />
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setView('add-audit'); }}
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
                            <button type="button" onClick={() => setFilterStatus(filterStatus === 'Open' ? '' : 'Open')} className="hover:text-slate-700 transition-colors">
                              <span className="font-black text-slate-700">{openCount.toLocaleString()}</span> open
                            </button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setFilterStatus(filterStatus === 'Closed' ? '' : 'Closed')} className="hover:text-slate-700 transition-colors">
                              <span className="font-black text-slate-700">{closedCount.toLocaleString()}</span> closed
                            </button>
                            {unclassifiedCount > 0 && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span><span className="font-black text-slate-600">{unclassifiedCount.toLocaleString()}</span> status not set</span>
                              </>
                            )}
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setFilterIcarStatus(filterIcarStatus === 'Submitted' ? '' : 'Submitted')} className="hover:text-slate-700 transition-colors">
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
                            onClick={() => {
                              setFilterDate('');
                              setFilterAuditor('');
                              setFilterFindings('');
                              setFilterDept('');
                              setFilterCategory('');
                              setFilterStatus('');
                              setFilterIcarStatus('');
                              setFilterShift('');
                              setFilterPlatform('');
                              setSearchQuery('');
                              setFilterWW('');
                            }}
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
                      className="overflow-hidden"
                    >
                      <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200 shadow-inner">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-700">Advanced filters</h4>
                            <p className="mt-1 text-[10px] font-medium text-slate-400">Narrow records by date, ownership, status and production context.</p>
                          </div>
                          {activeFilterCount > 0 && (
                            <span className="rounded-full bg-brand-orange/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-brand-orange">{activeFilterCount} active</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        <FilterInput label="Work Week (WW)" type="select" options={WWS} value={filterWW} onChange={setFilterWW} />
                        <FilterInput label="Date" type="date" value={filterDate} onChange={setFilterDate} />
                        <FilterInput label="Shift" type="select" options={SHIFTS} value={filterShift} onChange={setFilterShift} />
                        <FilterInput label="Auditor" type="select" options={auditorsList} value={filterAuditor} onChange={setFilterAuditor} />
                        <FilterInput label="Department" type="select" options={DEPARTMENTS} value={filterDept} onChange={setFilterDept} />
                        <FilterInput label="Platform" type="select" options={platformsList} value={filterPlatform} onChange={setFilterPlatform} />
                        <FilterInput label="Category" type="select" options={CATEGORIES} value={filterCategory} onChange={setFilterCategory} />
                        <FilterInput label="Finding Status" type="select" options={['Open', 'Closed']} value={filterStatus} onChange={setFilterStatus} />
                        <FilterInput label="ICAR Status" type="select" options={['Locked', 'Submitted']} value={filterIcarStatus} onChange={setFilterIcarStatus} />
                        <div className="flex items-end lg:col-span-2">
                          <button 
                            onClick={() => {
                              setFilterDate('');
                              setFilterAuditor('');
                              setFilterFindings('');
                              setFilterDept('');
                              setFilterCategory('');
                              setFilterStatus('');
                              setFilterIcarStatus('');
                              setFilterShift('');
                              setFilterPlatform('');
                              setSearchQuery('');
                              setFilterWW('');
                            }}
                            className="w-full bg-slate-100 border border-slate-200 rounded-xl text-slate-600 text-[10px] font-black uppercase p-3 hover:bg-slate-200 transition-colors"
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
                        onClick={() => { setView('ipqc'); setEditingId(null); }}
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
                            onChange={(v: string) => setNewAudit({ ...newAudit, auditDate: v })}
                          />
                          <FormSelect
                            label="Work week (WW)"
                            required
                            value={newAudit.ww}
                            onChange={(v: string) => setNewAudit({ ...newAudit, ww: v })}
                            options={WWS}
                            helper="Auto-calculated from audit date"
                          />
                          <FormSelect
                            label="Shift"
                            value={newAudit.shift}
                            onChange={(v: string) => setNewAudit({ ...newAudit, shift: v })}
                            options={SHIFTS}
                          />
                          <FormSelect
                            label="Department"
                            required
                            value={newAudit.department}
                            onChange={(v: string) => setNewAudit({ ...newAudit, department: v })}
                            options={DEPARTMENTS}
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
                            value={newAudit.platform}
                            onChange={handlePlatformChange}
                            options={platformsList}
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
                            value={newAudit.category}
                            onChange={handleCategoryChange}
                            options={CATEGORIES}
                          />
                          <AutoField label="Group finding" value={newAudit.groupFinding} />
                          <FormSelect
                            label="Finding details"
                            required
                            value={newAudit.detailsFindings}
                            onChange={(v: string) => setNewAudit({ ...newAudit, detailsFindings: v })}
                            options={FINDING_DETAILS}
                          />
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormSelect
                            label="Finding status"
                            required
                            value={newAudit.status || ''}
                            onChange={(v: string) => setNewAudit({ ...newAudit, status: v })}
                            options={['Open', 'Closed']}
                            placeholder="Select finding status"
                            helper={editingId ? 'Set Closed only when the finding has been resolved.' : 'New findings default to Open.'}
                          />
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Lifecycle rule</p>
                            <p className="mt-1 text-[11px] leading-5 text-slate-500">
                              Finding status tracks resolution (<span className="font-semibold text-slate-700">Open / Closed</span>). ICAR status is managed separately from the ICAR number.
                            </p>
                          </div>
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
                              <h3 className="text-sm font-bold text-slate-900">People</h3>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">Record the auditor and the person responsible for the finding.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormSelect
                            label="IPQC auditor"
                            required
                            value={newAudit.auditors}
                            onChange={(v: string) => setNewAudit({ ...newAudit, auditors: v })}
                            options={auditorsList}
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
                              <div className="mb-1.5 flex items-center justify-between gap-3">
                                <label className="text-[11px] font-semibold text-slate-700">ICAR number</label>
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                                  <Info size={10} /> Keep N/A if not submitted
                                </span>
                              </div>
                              <input
                                type="text"
                                value={newAudit.icarNum || 'N/A'}
                                onChange={(e) => handleIcarNumChange(e.target.value)}
                                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
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
                                <span className="text-[9px] font-bold uppercase tracking-wide opacity-60">Auto</span>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
                              Entering a valid ICAR number automatically changes the ICAR status to <span className="font-semibold text-slate-700">Submitted</span>.
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
                            <p className="text-[10px] font-medium text-slate-400">Responsible MQE</p>
                            <p className="mt-1 text-xs font-semibold text-brand-orange">{newAudit.mqeEngineer || 'Unassigned'}</p>
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
                          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-orange px-4 text-xs font-bold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.99]"
                        >
                          <CheckCircle2 size={15} />
                          {editingId ? 'Update Finding' : 'Submit Finding'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setView('ipqc'); setEditingId(null); }}
                          className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                        >
                          Cancel
                        </button>
                        <p className="mt-3 border-t border-slate-100 pt-3 text-center text-[10px] leading-4 text-slate-400">
                          {editingId ? 'Changes will update the existing IPQC record.' : 'The finding will be added to the IPQC records table.'}
                        </p>
                      </div>
                    </aside>
                  </form>
                </div>
              </motion.div>
            )}


            {view === 'settings' && isAdmin && (
              <motion.div
                key="settings"
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
                      <Settings size={13} />
                      System configuration
                    </div>
                    <h2 className="text-xl md:text-2xl font-black tracking-tight text-slate-900">Admin Settings</h2>
                    <p className="mt-1.5 max-w-2xl text-xs md:text-sm leading-6 text-slate-500">
                      Manage the people and ownership rules used across IPQC records. Changes are saved to the shared database automatically.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
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
                  </div>
                </section>

                {/* Compact system overview */}
                <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Auditors</p>
                        <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{auditorsList.length}</p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
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
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Layers size={17} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Assigned</p>
                        <p className="mt-1 text-xl font-black tabular-nums text-slate-900">
                          {platformsList.filter(platform => Boolean(mqeMappings[platform]?.trim())).length}
                        </p>
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
                        <p className="mt-1 text-xl font-black tabular-nums text-slate-900">
                          {platformsList.filter(platform => !mqeMappings[platform]?.trim()).length}
                        </p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <AlertCircle size={17} />
                      </div>
                    </div>
                  </div>
                </section>

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
                              disabled={!newMqeName.trim() || savingSettings}
                              className="inline-flex h-10 w-full md:w-auto items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <CheckCircle2 size={14} />
                              Save assignment
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
                          <h3 className="text-sm font-black text-slate-900">MQE assignment synchronization</h3>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700">Maintenance</span>
                        </div>
                        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                          Re-apply the current Platform → MQE ownership rules to existing records. Use this after changing ownership for a platform that already has historical findings.
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
                      {recalculating ? 'Updating records...' : 'Recalculate assignments'}
                    </button>
                  </div>
                </section>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-white/20 p-8"
            >
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Lock size={32} />
                </div>
                <h3 className="text-2xl font-black tracking-tight text-slate-800">Admin Authentication</h3>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mt-2">Quality Management System</p>
              </div>

              {sessionExpired && (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-center mb-4">
                  Your session expired. Please sign in again.
                </p>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 block ml-1">Username / Admin ID</label>
                  <input 
                    type="text" 
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="e.g. admin"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 outline-none transition-all placeholder:text-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 block ml-1">Password</label>
                  <input 
                    type="password" 
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 outline-none transition-all placeholder:text-slate-300 font-bold"
                  />
                </div>
                {loginError && (
                  <p className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 text-center">
                    {loginError}
                  </p>
                )}

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    onClick={() => { setShowLoginModal(false); setLoginError(''); setSessionExpired(false); }}
                    className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={loggingIn}
                    className="flex-1 bg-brand-orange text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-brand-orange/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loggingIn ? 'Signing In...' : 'Sign In'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? 'Requires admin login' : undefined}
      className={`w-full flex items-center gap-3 px-5 py-3 transition-all duration-200 text-[11px] font-semibold border-l-2 ${
        disabled
          ? 'text-slate-600 opacity-40 cursor-not-allowed border-transparent'
          : active 
            ? 'bg-sidebar-active text-white border-brand-orange shadow-[inset_0_0_20px_rgba(241,93,34,0.1)]' 
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent'
      }`}
    >
      <div className={`shrink-0 transition-colors ${active && !disabled ? 'text-brand-orange' : ''}`}>{icon}</div>
      {!collapsed && <span className="tracking-wide uppercase whitespace-nowrap">{label}</span>}
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

function FilterInput({ label, value, onChange, type = 'text', options = [], placeholder }: any) {
  return (
    <div className="flex flex-col gap-1.5 overflow-hidden">
      <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 italic">{label}</label>
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
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-semibold text-slate-700">{label}</label>
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
          <Sparkles size={8} /> Auto
        </span>
      </div>
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

function FormSelect({ label, value, onChange, options, required, helper, placeholder }: any) {
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
          className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3.5 pr-9 text-sm font-medium text-slate-800 outline-none transition-all focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
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
