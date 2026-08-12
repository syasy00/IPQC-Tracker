import { useState, useMemo, FormEvent, useRef, ChangeEvent, useEffect } from 'react';
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
  UserCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ResponsiveContainer,
  AreaChart,
  Area,
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
  const [records, setRecords] = useState<AuditRecord[]>([]); 
  const [powerBiUrl, setPowerBiUrl] = useState<string>(''); 
  const [dashboardMode, setDashboardMode] = useState<'system' | 'powerbi'>('system');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);

  // Settings State for CRUD Operations
  const [auditorsList, setAuditorsList] = useState(INITIAL_AUDITORS);
  const [newAuditorName, setNewAuditorName] = useState('');
  
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
          setRecords(data);
        }
      } catch (error) {
        console.error('Error fetching data from database:', error);
      }
    };
    fetchAudits();
  }, []);

  const analyticsData = useMemo(() => {
    const submittedRecords = records.filter(r => r.icarStatus === 'Submitted');
    const categories: Record<string, number> = {};
    const platforms: Record<string, number> = {};
    const statuses: Record<string, number> = { 'Locked': 0, 'Submitted': 0 };
    const mqes: Record<string, number> = {};
    const auditors: Record<string, number> = {};
    const weeklyTrends: Record<string, number> = {};

    records.forEach(record => {
      if (record.icarStatus && statuses.hasOwnProperty(record.icarStatus)) statuses[record.icarStatus]++;
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
      statuses: Object.entries(statuses).map(([name, value]) => ({ name, value })),
      mqes: Object.entries(mqes).map(([name, value]) => ({ name, value })),
      auditors: Object.entries(auditors).map(([name, value]) => ({ name, value })),
      weeklyTrends: Object.entries(weeklyTrends)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, value]) => ({ name, value }))
    };
  }, [records]);

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    if (loginPassword === 'admin123') {
      setIsAdmin(true);
      setShowLoginModal(false);
      setLoginPassword('');
    } else {
      alert('Invalid admin password');
    }
  };

  const logout = () => {
    setIsAdmin(false);
    if (view === 'settings') setView('ipqc');
  };

  const getMqeForPlatform = (platform: string) => {
    return mqeMappings[platform as keyof typeof mqeMappings] || 'Unassigned';
  };

  const handleAddAuditor = (e: FormEvent) => {
    e.preventDefault();
    if (newAuditorName.trim() && !auditorsList.includes(newAuditorName.trim())) {
      setAuditorsList([...auditorsList, newAuditorName.trim()]);
      setNewAuditorName('');
    }
  };

  const handleDeleteAuditor = (auditorToDelete: string) => {
    setAuditorsList(auditorsList.filter(a => a !== auditorToDelete));
  };

  const handleAddOrUpdateMqeMapping = (e: FormEvent) => {
    e.preventDefault();
    if (newMqeName.trim()) {
      setMqeMappings({
        ...mqeMappings,
        [selectedPlatformForMapping]: newMqeName.trim()
      });
      setNewMqeName('');
    }
  };

  const handleClearMqeMapping = (platform: string) => {
    const newMappings = { ...mqeMappings };
    delete newMappings[platform];
    setMqeMappings(newMappings);
  };

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  
  const [filterAuditor, setFilterAuditor] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterFindings, setFilterFindings] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterShift, setFilterShift] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterWW, setFilterWW] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newAudit, setNewAudit] = useState<Partial<AuditRecord>>({
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
      const matchesStatus = !filterStatus || String(r.icarStatus) === String(filterStatus);
      const matchesShift = !filterShift || String(r.shift) === String(filterShift);
      const matchesPlatform = !filterPlatform || String(r.platform) === String(filterPlatform);

      return matchesSearch && matchesAuditor && matchesDept && matchesFindings && 
             matchesDate && matchesWW && matchesCategory && matchesStatus && 
             matchesShift && matchesPlatform;
    });
  }, [records, searchQuery, filterAuditor, filterDept, filterFindings, filterDate, filterWW, filterCategory, filterStatus, filterShift, filterPlatform]);

  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
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
          const updated = await response.json();
          setRecords(records.map(r => String(r.id) === String(editingId) ? updated : r));
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
          const created = await response.json();
          setRecords([...records, created]);
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

  const handleEditClick = (record: AuditRecord) => {
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

  const handleExcelImportProcess = async () => {
    const fileInput = document.getElementById('excelImportModalInput') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) {
      alert('Please select an Excel file first.');
      return;
    }

    setImporting(true);
    try {
      const importedRows = await importFromExcel(file);
      let successCount = 0;

      for (const row of importedRows) {
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

        if (response.ok) {
          successCount++;
        }
      }

      const refreshResponse = await fetch(`${API_BASE_URL}/api/records`);
      if (refreshResponse.ok) {
        const latestData = await refreshResponse.json();
        setRecords(latestData);
      }

      alert(`Successfully imported and saved ${successCount} out of ${importedRows.length} records to the database!`);
      setShowImportModal(false);
    } catch (err) {
      console.error('Import error:', err);
      alert('Error parsing or saving Excel file to database.');
    } finally {
      setImporting(false);
    }
  };

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
            onClick={() => { setView('ipqc'); if (window.innerWidth < 768) setSidebarOpen(false); }}
          />

          <div className="px-3 mt-6 mb-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] italic opacity-50">System</span>
          </div>
          <NavItem 
            icon={isAdmin ? <Settings size={18} /> : <Lock size={18} />} 
            label={isAdmin ? "Settings" : "Admin Login"} 
            active={view === 'settings'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => {
              if (isAdmin) {
                setView('settings');
              } else {
                setShowLoginModal(true);
              }
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
            <h2 className="text-sm md:text-lg font-black text-slate-800 uppercase tracking-tight truncate">IPQC TRACKER</h2>
          </div>

          <div className="flex items-center gap-4">
            {isAdmin ? (
              <button 
                onClick={logout}
                className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition-colors group border border-rose-100"
                title="Sign Out"
              >
                <div className="w-6 h-6 rounded-full bg-rose-200 flex items-center justify-center text-rose-700">
                  <UserCircle size={14} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline group-hover:text-rose-700">Admin</span>
              </button>
            ) : (
              <button 
                onClick={() => setShowLoginModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-slate-500 rounded-xl hover:bg-slate-100 transition-colors group border border-slate-200"
                title="Admin Login"
              >
                <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-600">
                  <UserCircle size={14} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline group-hover:text-slate-800">Login</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 min-h-0 bg-slate-50/30 flex flex-col">
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
                    <p className="text-[10px] text-text-muted/60 font-bold uppercase mt-0.5">Real-time Production Insights (Calculated from Submitted ICARs)</p>
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
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <KPICard 
                          icon={<ClipboardCheck size={16} className="text-blue-500" />}
                          label="Total Records"
                          value={records.length}
                          trend="Lifetime"
                          color="blue"
                        />
                        <KPICard 
                          icon={<Clock size={16} className="text-amber-500" />}
                          label="Locked ICARs"
                          value={records.filter(r => r.icarStatus === 'Locked').length}
                          trend="Pending Serial"
                          color="orange"
                        />
                        <KPICard 
                          icon={<CheckCircle2 size={16} className="text-emerald-500" />}
                          label="Submitted ICARs"
                          value={records.filter(r => r.icarStatus === 'Submitted').length}
                          trend="Active Analytics"
                          color="emerald"
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

                        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm h-[500px] flex flex-col items-center">
                          <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] mb-4 w-full text-left">ICAR Status Breakdown</h3>
                          <div className="flex-1 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={analyticsData.statuses}
                                  innerRadius={70}
                                  outerRadius={100}
                                  paddingAngle={8}
                                  dataKey="value"
                                  stroke="none"
                                >
                                  {analyticsData.statuses.map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={entry.name === 'Submitted' ? '#10b981' : '#f59e0b'} 
                                    />
                                  ))}
                                </Pie>
                                <RechartsTooltip 
                                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend 
                                  verticalAlign="bottom" 
                                  height={36} 
                                  iconType="circle"
                                  formatter={(value) => <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{value}</span>}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
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
                className="flex-1 flex flex-col min-h-0 bg-transparent space-y-4"
              >
                {/* Top Action Bar: Import Excel, Export All, and Add Finding on Top Right */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <div>
                    <h2 className="text-base font-black uppercase tracking-tight text-slate-800">IPQC Records Management</h2>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Overview & Audit Tracking</p>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end flex-wrap">
                    <button 
                      onClick={() => setShowImportModal(true)}
                      className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-blue-600 border border-blue-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all whitespace-nowrap shadow-sm"
                    >
                      <Upload size={14} />
                      Import Excel
                    </button>

                    <button 
                      onClick={() => exportToExcel(records)}
                      className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-emerald-600 border border-emerald-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-50 transition-all whitespace-nowrap shadow-sm"
                    >
                      <Download size={14} />
                      Export All
                    </button>

                    <button 
                      onClick={() => { setEditingId(null); setView('add-audit'); }}
                      className="flex items-center justify-center gap-2 px-6 py-2.5 bg-brand-orange text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-brand-orange/20 hover:brightness-110 transition-all whitespace-nowrap"
                    >
                      <Plus size={16} />
                      Add Finding
                    </button>
                  </div>
                </div>

                {/* Filter & Search Bar Band */}
                <div className="bg-[#fffbeb]/50 p-4 rounded-2xl border border-amber-200/60 flex flex-col md:flex-row items-center gap-4 shadow-sm">
                  <div className="relative flex-1 w-full">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search records by keyword, platform, station..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl text-xs font-bold pl-10 pr-4 py-3 outline-none focus:border-brand-orange shadow-inner transition-all"
                    />
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                    <button 
                      onClick={() => setFiltersOpen(!filtersOpen)}
                      className={`w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                        filtersOpen ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Filter size={14} />
                      {filtersOpen ? 'Hide Filter' : 'Advanced Filter'}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {filtersOpen && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                      animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
                      exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        <FilterInput label="Work Week (WW)" type="select" options={WWS} value={filterWW} onChange={setFilterWW} />
                        <FilterInput label="Date" type="date" value={filterDate} onChange={setFilterDate} />
                        <FilterInput label="Shift" type="select" options={SHIFTS} value={filterShift} onChange={setFilterShift} />
                        <FilterInput label="Auditor" type="select" options={auditorsList} value={filterAuditor} onChange={setFilterAuditor} />
                        <FilterInput label="Department" type="select" options={DEPARTMENTS} value={filterDept} onChange={setFilterDept} />
                        <FilterInput label="Platform" type="select" options={platformsList} value={filterPlatform} onChange={setFilterPlatform} />
                        <FilterInput label="Category" type="select" options={CATEGORIES} value={filterCategory} onChange={setFilterCategory} />
                        <FilterInput label="ICAR Status" type="select" options={['Locked', 'Submitted']} value={filterStatus} onChange={setFilterStatus} />
                        
                        <div className="flex items-end">
                          <button 
                            onClick={() => {
                              setFilterDate('');
                              setFilterAuditor('');
                              setFilterFindings('');
                              setFilterDept('');
                              setFilterCategory('');
                              setFilterStatus('');
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
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col flex-1 shadow-sm min-h-0">
                  <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1650px]">
                      <thead className="bg-slate-100 sticky top-0 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
                        <tr>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200 text-center sticky left-0 bg-slate-100 z-30 shadow-[2px_0_5px_rgba(0,0,0,0.03)] w-16">No</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Date</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200 text-center">WW</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200 text-center">Shift</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Auditor Name</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">PIC Finding</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Department</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Platform</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">MQE Engineer</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200 bg-slate-200/50">Station / Area</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Group Finding</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Category</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Finding Details</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200 text-center">Image</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">Remark</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200 text-center">ICAR Status</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-r border-slate-200">ICAR#</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-600 uppercase tracking-widest border-b border-slate-200 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredRecords.map((record, index) => (
                          <tr 
                            key={record.id} 
                            onClick={() => setSelectedRecord(record)}
                            className={`transition-all duration-150 text-[11px] text-slate-700 cursor-pointer group hover:bg-orange-50/60 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'
                            }`}
                          >
                            <td className="px-4 py-4 text-center font-bold text-slate-500 border-r border-slate-200 sticky left-0 bg-inherit z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)] group-hover:text-brand-orange">
                              {record.no || index + 1}
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
                              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm ${
                                record.icarStatus === 'Submitted' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold' : 'bg-amber-100 text-amber-800 border border-amber-300 font-bold'
                              }`}>
                                {record.icarStatus || 'Locked'}
                              </span>
                            </td>
                            <td className="px-4 py-4 font-mono text-[10px] font-bold text-slate-600 border-r border-slate-100">{record.icarNum || 'N/A'}</td>
                            <td className="px-4 py-4 text-right" onClick={e => e.stopPropagation()}>
                              <div className="flex justify-end items-center gap-2">
                                <button 
                                  onClick={() => handleEditClick(record)}
                                  className="p-2 hover:bg-white rounded-lg text-slate-500 hover:text-brand-orange shadow-sm transition-all border border-slate-200"
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteRecord(record.id)}
                                  className="p-2 hover:bg-rose-50 rounded-lg text-slate-500 hover:text-rose-600 shadow-sm transition-all border border-slate-200"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
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
                </div>

                {/* Details Modal */}
                <AnimatePresence>
                  {selectedRecord && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-200 flex flex-col"
                      >
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                          <h3 className="text-xs font-black uppercase tracking-widest text-slate-800">Finding Details & Audit Trail</h3>
                          <button onClick={() => setSelectedRecord(null)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-50 transition-colors text-slate-400">
                            <X size={20} />
                          </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar grid grid-cols-1 lg:grid-cols-12 gap-8">
                          <div className="lg:col-span-7 space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <DetailField label="IPQC Auditor" value={selectedRecord.auditors} />
                              <DetailField label="MQE Engineer" value={selectedRecord.mqeEngineer || '-'} highlight />
                              <DetailField label="Platform" value={selectedRecord.platform} />
                              <DetailField label="Station/Area" value={selectedRecord.areaStation} />
                              <DetailField label="PIC Finding" value={selectedRecord.personOnJob} />
                              <DetailField label="Category" value={selectedRecord.category} />
                              <DetailField label="Shift / Dept" value={`${selectedRecord.shift} | ${selectedRecord.department}`} />
                              <DetailField label="ICAR Status" value={selectedRecord.icarStatus || 'Locked'} status={selectedRecord.icarStatus} />
                            </div>

                            <div className="space-y-4">
                              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 italic">Finding Details</h4>
                                <p className="text-xs font-semibold text-slate-700 leading-relaxed">{selectedRecord.detailsFindings}</p>
                              </div>
                              {selectedRecord.remark && (
                                <div className="bg-blue-50 border border-blue-100 p-5 rounded-2xl">
                                  <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2 italic">Remarks</h4>
                                  <p className="text-xs font-semibold text-slate-700 leading-relaxed italic">"{selectedRecord.remark}"</p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="lg:col-span-5 flex flex-col justify-between">
                            <div>
                              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 italic">Visual Evidence</h4>
                              {selectedRecord.picture ? (
                                <div 
                                  onClick={() => setPreviewImage(getImageUrl(selectedRecord.picture!)!)}
                                  className="w-full aspect-[4/3] rounded-2xl overflow-hidden border border-slate-200 bg-white relative group cursor-zoom-in shadow-sm"
                                >
                                  <img src={getImageUrl(selectedRecord.picture)} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                                </div>
                              ) : (
                                <div className="w-full aspect-[4/3] rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center bg-slate-50">
                                  <ImageIcon size={32} className="text-slate-300 mb-2" />
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Image Provided</span>
                                </div>
                              )}
                            </div>

                            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                              <button 
                                onClick={() => { handleEditClick(selectedRecord); setSelectedRecord(null); }}
                                className="bg-white border border-slate-200 text-slate-600 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm hover:border-brand-orange hover:text-brand-orange transition-all"
                              >
                                Modify Record
                              </button>
                              <button 
                                onClick={() => setSelectedRecord(null)}
                                className="bg-brand-orange text-white px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md shadow-brand-orange/20"
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {view === 'add-audit' && (
              <motion.div 
                key="add-audit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 overflow-y-auto pb-20 custom-scrollbar"
              >
                <div className="bg-white rounded-2xl border border-border-subtle overflow-hidden max-w-5xl mx-auto shadow-sm">
                  <div className="bg-slate-50 p-6 border-b border-border-subtle flex justify-between items-center">
                    <div>
                      <h2 className="text-lg font-black uppercase tracking-tight text-slate-800">{editingId ? 'Edit Audit Entry' : 'New Audit Entry'}</h2>
                      <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-1">IPQC Quality Management System</p>
                    </div>
                    <button 
                      onClick={() => { setView('ipqc'); setEditingId(null); }} 
                      className="text-text-muted hover:text-text-main flex items-center gap-2 text-[10px] font-bold uppercase"
                    >
                      <X size={16} /> Exit
                    </button>
                  </div>
                  
                  <form onSubmit={handleAddAudit} className="p-6 md:p-8 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      <FormInput label="Audit Date" type="date" required value={newAudit.auditDate} onChange={(v: string) => setNewAudit({...newAudit, auditDate: v})} />
                      <FormSelect label="Work Week (WW)" required value={newAudit.ww} onChange={(v: string) => setNewAudit({...newAudit, ww: v})} options={WWS} />
                      <FormSelect label="Shift" value={newAudit.shift} onChange={(v: string) => setNewAudit({...newAudit, shift: v})} options={SHIFTS} />
                      <FormSelect label="Department" required value={newAudit.department} onChange={(v: string) => setNewAudit({...newAudit, department: v})} options={DEPARTMENTS} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 font-semibold">
                      <FormSelect label="Platform" required value={newAudit.platform} onChange={handlePlatformChange} options={platformsList} />
                      <FormInput label="Area / Station" required value={newAudit.areaStation} onChange={(v: string) => setNewAudit({...newAudit, areaStation: v})} />
                      <FormSelect label="Category" required value={newAudit.category} onChange={handleCategoryChange} options={CATEGORIES} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] px-1">Group Finding (Auto)</label>
                        <input 
                          type="text" 
                          disabled 
                          value={newAudit.groupFinding || ''} 
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl py-3 px-4 text-sm font-semibold text-slate-600 outline-none cursor-not-allowed" 
                        />
                      </div>
                      <FormSelect label="Finding Details" required value={newAudit.detailsFindings} onChange={(v: string) => setNewAudit({...newAudit, detailsFindings: v})} options={FINDING_DETAILS} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      <FormSelect label="IPQC Auditor Name" required value={newAudit.auditors} onChange={(v: string) => setNewAudit({...newAudit, auditors: v})} options={auditorsList} />
                      
                      <FormInput label="PIC Name (Finding)" required value={newAudit.personOnJob} onChange={(v: string) => setNewAudit({...newAudit, personOnJob: v})} />

                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] px-1">MQE Engineer (Auto Assigned)</label>
                        <input 
                          type="text" 
                          disabled 
                          value={newAudit.mqeEngineer || ''} 
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl py-3 px-4 text-sm font-semibold text-brand-orange uppercase outline-none cursor-not-allowed" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em]">ICAR#</label>
                          <span className="text-[9px] text-slate-400 italic">Leave as N/A if locked</span>
                        </div>
                        <input 
                          type="text" 
                          value={newAudit.icarNum || 'N/A'} 
                          onChange={(e) => handleIcarNumChange(e.target.value)} 
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-semibold text-slate-800 focus:bg-white focus:border-brand-orange outline-none" 
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] px-1">ICAR Status (Auto)</label>
                        <input 
                          type="text" 
                          disabled 
                          value={newAudit.icarStatus || 'Locked'} 
                          className={`w-full border rounded-xl py-3 px-4 text-sm font-black uppercase outline-none cursor-not-allowed ${
                            newAudit.icarStatus === 'Submitted' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'
                          }`} 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div>
                        <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 block italic">Remark</label>
                        <textarea 
                          className="w-full bg-slate-50 border border-border-subtle rounded-xl p-4 text-sm focus:border-brand-orange outline-none transition-all placeholder:text-text-muted/40 min-h-[120px]"
                          placeholder="Additional remarks..."
                          value={newAudit.remark || ''}
                          onChange={(e) => setNewAudit({...newAudit, remark: e.target.value})}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 block">Audit Evidence Picture</label>
                        <div 
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full bg-slate-50 border-2 border-dashed border-border-subtle rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all h-[150px] overflow-hidden"
                        >
                          <input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            accept="image/*"
                            onChange={handleImageChange}
                          />
                          {newAudit.picture ? (
                            <div className="relative w-full h-full">
                              <img 
                                src={getImageUrl(newAudit.picture)} 
                                alt="Audit Evidence" 
                                className="w-full h-full object-contain"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded">
                                <span className="text-white text-[10px] font-bold bg-black/50 px-3 py-1.5 rounded uppercase tracking-wider">Change Image</span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-center text-text-muted">
                              <ImageIcon size={28} className="mx-auto mb-2 opacity-30" />
                              <p className="text-[10px] font-bold uppercase tracking-wider">Drag & drop or click to upload</p>
                              <p className="text-[9px] opacity-60 mt-1 uppercase">Supports: JPG, PNG, WEBP</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-6 border-t border-border-subtle">
                      <button 
                        type="button" 
                        onClick={() => { setView('ipqc'); setEditingId(null); }}
                        className="px-6 py-2.5 text-xs font-bold uppercase text-text-muted hover:text-text-main transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="bg-brand-orange text-white px-10 py-2.5 rounded text-xs font-bold uppercase shadow-lg shadow-brand-orange/20 hover:brightness-110 active:scale-95 transition-all"
                      >
                        {editingId ? 'Update Record' : 'Submit Audit'}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {view === 'settings' && isAdmin && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 pb-20 max-w-4xl mx-auto"
              >
                <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
                      <Settings size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">System Settings</h2>
                      <p className="text-xs text-text-muted italic uppercase font-bold tracking-widest mt-1">Manage auditors and MQE assignments</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                          <Users size={14} className="text-brand-orange" />
                          IPQC Auditors
                        </h3>
                      </div>
                      
                      <form onSubmit={handleAddAuditor} className="flex gap-2">
                        <input 
                          type="text"
                          value={newAuditorName}
                          onChange={(e) => setNewAuditorName(e.target.value)}
                          placeholder="New Auditor Name..."
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:border-brand-orange transition-all"
                        />
                        <button type="submit" disabled={!newAuditorName.trim()} className="bg-brand-orange text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase disabled:opacity-50 hover:brightness-110 transition-all">
                          Add
                        </button>
                      </form>

                      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                        {auditorsList.map((auditor, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl group hover:border-slate-200 transition-all">
                            <span className="text-xs font-bold text-slate-700">{auditor}</span>
                            <button 
                              onClick={() => handleDeleteAuditor(auditor)}
                              className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                              title="Remove Auditor"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                          <Layers size={14} className="text-brand-orange" />
                          Platform - MQE Mapping
                        </h3>
                      </div>

                      <form onSubmit={handleAddOrUpdateMqeMapping} className="flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="grid grid-cols-2 gap-2">
                          <select 
                            value={selectedPlatformForMapping} 
                            onChange={(e) => setSelectedPlatformForMapping(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                          >
                            {platformsList.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <input 
                            type="text"
                            value={newMqeName}
                            onChange={(e) => setNewMqeName(e.target.value)}
                            placeholder="MQE Name..."
                            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-brand-orange transition-all"
                          />
                        </div>
                        <button type="submit" disabled={!newMqeName.trim()} className="w-full bg-slate-800 text-white py-2 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 hover:bg-slate-700 transition-all">
                          Update Mapping
                        </button>
                      </form>

                      <div className="overflow-hidden border border-slate-200 rounded-2xl">
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                          <table className="w-full text-left">
                            <thead className="bg-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500 sticky top-0">
                              <tr>
                                <th className="px-4 py-3 border-b border-slate-200">Platform</th>
                                <th className="px-4 py-3 border-b border-slate-200">Responsible MQE</th>
                                <th className="px-4 py-3 border-b border-slate-200 w-10 text-center"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {platformsList.map((platform) => {
                                const assignedMqe = mqeMappings[platform];
                                return (
                                  <tr key={platform} className="hover:bg-slate-50/50 transition-all group">
                                    <td className="px-4 py-3 text-xs font-black text-slate-600">{platform}</td>
                                    <td className={`px-4 py-3 text-xs font-bold tracking-tight uppercase ${assignedMqe ? 'text-brand-orange' : 'text-slate-400 italic'}`}>
                                      {assignedMqe || 'Unassigned'}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                      {assignedMqe && (
                                        <button 
                                          onClick={() => handleClearMqeMapping(platform)}
                                          className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                                          title="Clear Assignment"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Excel Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 p-8 space-y-6"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">Import Historical Records</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Sync Excel tracker directly into MySQL database</p>
                </div>
                <button onClick={() => setShowImportModal(false)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400">
                  <X size={20} />
                </button>
              </div>

              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-slate-50 hover:bg-slate-100/50 transition-colors">
                <input 
                  id="excelImportModalInput"
                  type="file"
                  accept=".xlsx, .xls"
                  className="text-xs font-bold text-slate-600 file:mr-4 file:py-2.5 file:px-5 file:rounded-xl file:border-0 file:text-xs file:font-black file:uppercase file:bg-brand-orange file:text-white hover:file:brightness-110 file:cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  onClick={() => setShowImportModal(false)}
                  className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  disabled={importing}
                  onClick={handleExcelImportProcess}
                  className="bg-brand-orange text-white px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-brand-orange/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                >
                  {importing ? 'Processing & Saving...' : 'Process & Save to DB'}
                </button>
              </div>
            </motion.div>
          </div>
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
                <h3 className="text-2xl font-black tracking-tight text-slate-800">Admin Login</h3>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mt-2">Restricted Access only</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 block ml-1">Master Password</label>
                  <input 
                    type="password" 
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 outline-none transition-all placeholder:text-slate-300 font-bold"
                  />
                </div>
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowLoginModal(false)}
                    className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-brand-orange text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-brand-orange/20 hover:brightness-110 active:scale-95 transition-all"
                  >
                    Authorize
                  </button>
                </div>
              </form>
              <p className="text-[9px] text-center text-slate-400 mt-8 font-bold italic uppercase tracking-tighter">Tip: Try admin123</p>
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

function NavItem({ icon, label, active, collapsed, onClick }: { icon: any, label: string, active: boolean, collapsed: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-5 py-3 transition-all duration-200 text-[11px] font-semibold border-l-2 ${
        active 
          ? 'bg-sidebar-active text-white border-brand-orange shadow-[inset_0_0_20px_rgba(241,93,34,0.1)]' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent'
      }`}
    >
      <div className={`shrink-0 transition-colors ${active ? 'text-brand-orange' : ''}`}>{icon}</div>
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
            <MoreVertical size={12} />
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

function FormInput({ label, required, value, onChange, type = 'text' }: any) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em]">{label}</label>
        {required && <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest bg-rose-50 px-1.5 py-0.5 rounded">Required</span>}
      </div>
      <input 
        type={type} 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-semibold text-slate-800 focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 outline-none transition-all"
      />
    </div>
  );
}

function DetailField({ label, value, highlight, status }: { label: string, value: string, highlight?: boolean, status?: string }) {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Locked': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'Submitted': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      default: return 'bg-slate-50 text-slate-600 border-slate-100';
    }
  };

  return (
    <div className={`p-3 border rounded-xl flex flex-col gap-1 transition-all ${highlight ? 'bg-brand-orange/[0.03] border-brand-orange/20 shadow-sm shadow-brand-orange/5' : 'bg-slate-50 border-slate-100 hover:bg-white hover:border-slate-200'}`}>
      <span className={`text-[9px] font-black uppercase tracking-[0.2em] italic ${highlight ? 'text-brand-orange' : 'text-slate-400'}`}>
        {label}
      </span>
      {status ? (
        <div className={`w-fit px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${getStatusColor(status)}`}>
          {value}
        </div>
      ) : (
        <span className="text-xs font-black text-slate-700 leading-tight">
          {value || '—'}
        </span>
      )}
    </div>
  );
}

function FormSelect({ label, value, onChange, options }: any) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] px-1">{label}</label>
      <div className="relative group">
        <select 
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-semibold text-slate-800 focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/5 outline-none transition-all appearance-none cursor-pointer"
        >
          {options.map((opt: any) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300 group-hover:text-brand-orange transition-colors">
          <MoreVertical size={16} />
        </div>
      </div>
    </div>
  );
}