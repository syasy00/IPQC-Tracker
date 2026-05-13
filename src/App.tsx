import { useState, useMemo, FormEvent, useRef, ChangeEvent, useEffect } from 'react';
import { 
  LayoutDashboard, 
  ClipboardCheck, 
  Settings, 
  Search, 
  Plus, 
  MoreVertical, 
  Bell, 
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Menu,
  FileText,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Filter,
  History,
  Lock,
  Unlock,
  Users,
  Layers,
  Eye,
  TrendingDown,
  TrendingUp,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import { AuditRecord, ViewState, Department, Category } from './types';

// Mock Data for Charts
const PRODUCTION_TREND = [
  { name: 'W1', production: 400, quality: 98 },
  { name: 'W2', production: 600, quality: 94 },
  { name: 'W3', production: 350, quality: 99 },
  { name: 'W4', production: 900, quality: 97 },
  { name: 'W5', production: 550, quality: 99 },
  { name: 'W6', production: 750, quality: 95 },
  { name: 'W7', production: 450, quality: 98 },
  { name: 'W8', production: 650, quality: 96 },
  { name: 'W9', production: 800, quality: 99 },
];

const QUALITY_SNAPSHOT = [
  { name: 'Litho', pass: 45, fail: 2 },
  { name: 'Etch', pass: 38, fail: 5 },
  { name: 'Depo', pass: 52, fail: 3 },
  { name: 'CMP', pass: 30, fail: 1 },
  { name: 'Diff', pass: 41, fail: 4 },
];

// Mock Data
const PLATFORM_MQE_MAPPING: Record<string, string> = {
  'Apex': 'Siti Naimah',
  'PDX': 'Larry',
  'Navigator': 'Farid'
};

const INITIAL_RECORDS: AuditRecord[] = [
  {
    id: '1',
    no: 1,
    auditDate: '2026-05-04',
    ww: '18',
    shift: 'D',
    auditors: 'Amalina',
    personOnJob: 'Alleya',
    department: 'Production Team',
    platform: 'Apex',
    areaStation: 'SMT 2',
    groupFinding: 'Quality',
    category: 'Tooling_Labeling',
    detailsFindings: 'Calibration Label damage. Turn on Tools / Equipment',
    picture: undefined,
    remark: 'Calibration Label damage',
    status: 'Open',
    icarNum: '',
    actionTaken: '',
    mqeEngineer: 'Siti Naimah'
  },
  {
    id: '2',
    no: 2,
    auditDate: '2026-05-04',
    ww: '18',
    shift: 'D',
    auditors: 'Zulfikri',
    personOnJob: 'mathanraj',
    department: 'IE Team',
    platform: 'Apex',
    areaStation: 'Workorder Trolley Area',
    groupFinding: 'Quality',
    category: 'ESD_Control',
    detailsFindings: 'No ESD grounding points',
    picture: undefined,
    remark: 'The trolley has no ESD grounding chain (S-CART003M)',
    status: 'Open',
    icarNum: '',
    actionTaken: '',
    mqeEngineer: 'Siti Naimah'
  },
  {
    id: '3',
    no: 3,
    auditDate: '2026-05-05',
    ww: '18',
    shift: 'N',
    auditors: 'Amalina',
    personOnJob: 'John Doe',
    department: 'Production Team',
    platform: 'Navigator',
    areaStation: 'Assembly Row 4',
    groupFinding: 'Quality',
    category: 'Tooling_Labeling',
    detailsFindings: 'Tool #45 calibration expired.',
    picture: 'https://picsum.photos/seed/tool45/200/150',
    remark: 'Sent to calibration lab',
    status: 'In Progress',
    icarNum: 'ICAR-2026-003',
    actionTaken: 'Tagging and isolation',
    mqeEngineer: 'Farid'
  },
  {
    id: '4',
    no: 4,
    auditDate: '2026-05-05',
    ww: '18',
    shift: 'D',
    auditors: 'Sarah Connor',
    personOnJob: 'Mike Ross',
    department: 'Etching',
    platform: 'PDX',
    areaStation: 'Etch A-1',
    groupFinding: 'Hardware',
    category: 'Safety',
    detailsFindings: 'Safety guard loose on platform.',
    picture: undefined,
    remark: 'Fixed by maintenance',
    status: 'Closed',
    icarNum: 'ICAR-2026-004',
    actionTaken: 'Bolt replacement and tightening',
    mqeEngineer: 'Larry'
  },
  {
    id: '5',
    no: 5,
    auditDate: '2026-05-06',
    ww: '18',
    shift: 'N',
    auditors: 'Zulfikri',
    personOnJob: 'Rachel Zane',
    department: 'Lithography',
    platform: 'PDX',
    areaStation: 'Scanner 5',
    groupFinding: 'Software',
    category: 'Process',
    detailsFindings: 'Login error on control software.',
    picture: 'https://picsum.photos/seed/software/200/150',
    remark: 'IT notified',
    status: 'Open',
    icarNum: '',
    actionTaken: 'System reboot performed',
    mqeEngineer: 'Larry'
  },
  {
    id: '6',
    no: 6,
    auditDate: '2026-05-06',
    ww: '18',
    shift: 'D',
    auditors: 'Ahmad',
    personOnJob: 'Sarah Lee',
    department: 'Production Team',
    platform: 'Apex',
    areaStation: 'SMT 2',
    groupFinding: 'Hardware',
    category: 'Quality',
    detailsFindings: 'Small scratch found on PCB surface before assembly.',
    picture: 'https://picsum.photos/seed/pcb1/200/150',
    remark: 'Minor quality issue',
    status: 'In Progress',
    icarNum: 'ICAR-2026-006',
    actionTaken: 'Sent for rework',
    mqeEngineer: 'Siti Naimah'
  },
  {
    id: '7',
    no: 7,
    auditDate: '2026-05-06',
    ww: '18',
    shift: 'N',
    auditors: 'Amalina',
    personOnJob: 'Kenny Tan',
    department: 'IE Team',
    platform: 'Navigator',
    areaStation: 'Workorder Trolley Area',
    groupFinding: 'Quality',
    category: 'ESD_Control',
    detailsFindings: 'Grounding strap showing wear and tear.',
    picture: undefined,
    remark: 'Replacement ordered',
    status: 'Open',
    icarNum: '',
    actionTaken: '',
    mqeEngineer: 'Farid'
  },
  {
    id: '8',
    no: 8,
    auditDate: '2026-05-06',
    ww: '18',
    shift: 'D',
    auditors: 'Zulfikri',
    personOnJob: 'Maria Garcia',
    department: 'Mfg Engineering',
    platform: 'PDX',
    areaStation: 'Main Assembly',
    groupFinding: 'Quality',
    category: 'Process',
    detailsFindings: 'Screw torque settings slightly out of bounds.',
    picture: 'https://picsum.photos/seed/torque/200/150',
    remark: 'Recalibrated torque driver',
    status: 'Closed',
    icarNum: 'ICAR-2026-008',
    actionTaken: 'Recalibrated and verified with master gauge',
    mqeEngineer: 'Larry'
  }
];

const INITIAL_AUDITORS = ['Amalina', 'Zulfikri', 'Ahmad', 'Sarah Connor'];
const DEPARTMENTS = ['Production Team', 'IE Team', 'Mfg Engineering', 'Etching', 'Lithography'];
const PLATFORMS = ['Apex', 'PDX', 'Navigator'];
const GROUP_FINDINGS = ['Hardware', 'Software', 'Quality'];
const CATEGORIES = ['Tooling_Labeling', 'ESD_Control', 'Quality', 'Process', 'Safety'];
const WWS = Array.from({length: 52}, (_, i) => (i + 1).toString());

export default function App() {
  const [view, setView] = useState<ViewState>('ipqc');
  const [powerBiUrl, setPowerBiUrl] = useState<string>(''); // User can paste their URL here
  const [dashboardMode, setDashboardMode] = useState<'system' | 'powerbi'>('system');
  const [historyTab, setHistoryTab] = useState<'details' | 'timeline'>('details');
  const [historyDate, setHistoryDate] = useState<string>('2026-05-06');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Settings Management State
  const [auditorsList, setAuditorsList] = useState(INITIAL_AUDITORS);
  const [platformsList, setPlatformsList] = useState(PLATFORMS);
  const [mqeMappings, setMqeMappings] = useState(PLATFORM_MQE_MAPPING);

  // URL View param support for Figma plugin
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') as ViewState;
    if (viewParam && ['dashboard', 'ipqc', 'add-audit', 'checklist', 'history'].includes(viewParam)) {
      setView(viewParam);
    }
  }, []);

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
  const [records, setRecords] = useState<AuditRecord[]>(INITIAL_RECORDS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  
  // Filter states
  const [filterAuditor, setFilterAuditor] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterFindings, setFilterFindings] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterWW, setFilterWW] = useState('18');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [newAudit, setNewAudit] = useState<Partial<AuditRecord>>({
    auditDate: new Date().toISOString().split('T')[0],
    ww: '18',
    shift: 'D',
    auditors: '',
    personOnJob: '',
    department: '',
    platform: '',
    areaStation: '',
    groupFinding: '',
    category: '',
    detailsFindings: '',
    remark: '',
    icarNum: '',
    actionTaken: '',
    status: 'Open'
  });

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchesSearch = 
        r.areaStation.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.platform.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.auditors.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesAuditor = !filterAuditor || r.auditors.toLowerCase().includes(filterAuditor.toLowerCase());
      const matchesDept = !filterDept || r.department.toLowerCase().includes(filterDept.toLowerCase());
      const matchesFindings = !filterFindings || r.groupFinding.toLowerCase().includes(filterFindings.toLowerCase());
      const matchesDate = !filterDate || r.auditDate === filterDate;
      const matchesWW = !filterWW || r.ww === filterWW;

      return matchesSearch && matchesAuditor && matchesDept && matchesFindings && matchesDate && matchesWW;
    });
  }, [records, searchQuery, filterAuditor, filterDept, filterFindings, filterDate, filterWW]);

  const [selectedAudit, setSelectedAudit] = useState<AuditRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewAudit({ ...newAudit, picture: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddAudit = (e: FormEvent) => {
    e.preventDefault();
    
    if (editingId) {
      setRecords(records.map(r => r.id === editingId ? { 
        ...r, 
        ...newAudit as AuditRecord,
        mqeEngineer: getMqeForPlatform(newAudit.platform || '')
      } : r));
      setEditingId(null);
    } else {
      const id = (records.length + 1).toString();
      const record: AuditRecord = {
        ...newAudit as AuditRecord,
        id,
        no: records.length + 1,
        status: newAudit.status || 'Open',
        mqeEngineer: getMqeForPlatform(newAudit.platform || '')
      };
      setRecords([record, ...records]);
    }

    setNewAudit({
      auditDate: new Date().toISOString().split('T')[0],
      ww: '18',
      shift: 'D',
      auditors: '',
      personOnJob: '',
      department: '',
      platform: '',
      areaStation: '',
      groupFinding: '',
      category: '',
      detailsFindings: '',
      remark: '',
      icarNum: '',
      actionTaken: '',
      status: 'Open',
      picture: undefined,
    });
    setView('ipqc');
  };

  const handleEditClick = (record: AuditRecord) => {
    setNewAudit({
      auditDate: record.auditDate,
      ww: record.ww,
      shift: record.shift,
      auditors: record.auditors,
      personOnJob: record.personOnJob,
      department: record.department,
      platform: record.platform,
      areaStation: record.areaStation,
      groupFinding: record.groupFinding,
      category: record.category,
      detailsFindings: record.detailsFindings,
      remark: record.remark,
      icarNum: record.icarNum,
      actionTaken: record.actionTaken,
      picture: record.picture,
    });
    setEditingId(record.id);
    setView('add-audit');
  };

  const handleDeleteRecord = (id: string) => {
    if (confirm('Are you sure you want to delete this audit record?')) {
      setRecords(records.filter(r => r.id !== id));
    }
  };

  return (
    <div className="flex h-screen bg-bg-main font-sans text-text-main">
      {/* Mobile Overlay */}
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

      {/* Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 z-50 bg-sidebar-bg transition-all duration-300 flex flex-col shrink-0 overflow-hidden ${sidebarOpen ? 'w-[220px] translate-x-0' : 'w-0 -translate-x-full md:w-20 md:translate-x-0'}`}>
        <div className="p-6 flex items-center gap-3 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/b/b1/Idea-logo.png" 
              alt="Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
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
            onClick={() => {
              setView('dashboard');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />

          <div className="px-3 mt-6 mb-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] italic opacity-50">Operations</span>
          </div>
          <NavItem 
            icon={<ClipboardCheck size={18} />} 
            label="Daily Log" 
            active={view === 'ipqc'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => {
              setView('ipqc');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />
          <NavItem 
            icon={<History size={18} />} 
            label="Audit History" 
            active={view === 'history'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => {
              setView('history');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
          />

          <div className="px-3 mt-6 mb-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] italic opacity-50">Standards</span>
          </div>
          <NavItem 
            icon={<FileText size={18} />} 
            label="Checklists" 
            active={view === 'checklist'} 
            collapsed={!sidebarOpen && window.innerWidth >= 768}
            onClick={() => {
              setView('checklist');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
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

        {isAdmin && (
          <div className="p-4 mt-auto border-t border-white/5">
             <button 
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-2 bg-rose-500/10 text-rose-500 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-rose-500 hover:text-white transition-all shadow-sm"
            >
              <Unlock size={14} />
              Logout
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
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
            {view === 'ipqc' && (
              <button 
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={`p-2 rounded-md transition-all flex items-center gap-2 text-xs font-bold uppercase ${filtersOpen ? 'bg-brand-orange/10 text-brand-orange' : 'text-text-muted hover:bg-bg-main border border-border-subtle'}`}
              >
                <Filter size={14} />
                <span className="hidden sm:inline">{filtersOpen ? 'Hide Filters' : 'Show Filters'}</span>
              </button>
            )}
            <button 
              onClick={() => setView('add-audit')}
              className="bg-brand-orange hover:brightness-110 text-white px-3 py-2 md:px-4 md:py-2 rounded-md text-[11px] md:text-xs font-semibold transition-all whitespace-nowrap"
            >
              <span className="hidden sm:inline">+ Add New Audit</span>
              <Plus className="sm:hidden" size={16} />
            </button>
          </div>
        </header>

        {/* Filter Bar */}
        <AnimatePresence>
          {filtersOpen && view === 'ipqc' && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-white border-b border-border-subtle shrink-0"
            >
              <div className="px-4 md:px-6 py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <FilterInput label="Work Week (WW)" type="select" options={WWS} value={filterWW} onChange={setFilterWW} />
                <FilterInput label="Date" type="date" value={filterDate} onChange={setFilterDate} />
                <FilterInput label="Auditor" placeholder="Search Auditor..." value={filterAuditor} onChange={setFilterAuditor} />
                <FilterInput label="Group Finding" placeholder="Search Finding..." value={filterFindings} onChange={setFilterFindings} />
                <FilterInput label="Department" placeholder="Department" value={filterDept} onChange={setFilterDept} />
                <FilterInput label="Category" type="select" options={CATEGORIES} value={filterCategory} onChange={setFilterCategory} />
                <div className="flex items-end">
                  <button 
                    onClick={() => {
                      setFilterDate('');
                      setFilterAuditor('');
                      setFilterFindings('');
                      setFilterDept('');
                      setFilterCategory('');
                      setSearchQuery('');
                      setFilterWW('18');
                    }}
                    className="w-full bg-slate-50 border border-border-subtle rounded-md text-text-muted text-[10px] font-bold uppercase p-2.5 hover:bg-slate-100 transition-colors"
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-y-auto p-6 min-h-0">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 pb-20"
              >
                {/* Dashboard Header/Toggle */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-lg border border-border-subtle">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-widest text-text-muted">Analytics Dashboard</h3>
                    <p className="text-[10px] text-text-muted/60 font-bold uppercase mt-0.5">Real-time Production Insights</p>
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
                        <StatCard label="Total Audits" value="1,284" trend="+12.4%" />
                        <StatCard label="Yield Loss (FA)" value="0.04%" trend="-0.01%" />
                        <StatCard label="Pending Actions" value="12" trend="stable" />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm min-h-[400px] flex flex-col">
                          <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
                            <LayoutDashboard size={14} className="text-brand-orange" />
                            Audit Volume Trend
                          </h3>
                          <div className="flex-1 w-full min-h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={PRODUCTION_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                                  cursor={{ fill: '#f1f5f9' }}
                                />
                                <Bar dataKey="production" radius={[4, 4, 0, 0]} barSize={32}>
                                  {PRODUCTION_TREND.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index === PRODUCTION_TREND.length - 1 ? '#F15D22' : '#F15D2220'} className="transition-all duration-300 hover:fill-[#F15D22]" />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                          <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] mb-8 shrink-0">Compliance Score</h3>
                          <div className="flex-1 w-full min-h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={PRODUCTION_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis 
                                  dataKey="name" 
                                  axisLine={false} 
                                  tickLine={false} 
                                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                                  dy={10}
                                />
                                <YAxis 
                                  domain={[90, 100]}
                                  axisLine={false} 
                                  tickLine={false} 
                                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                                />
                                <RechartsTooltip 
                                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 700 }}
                                />
                                <Line 
                                  type="monotone" 
                                  dataKey="quality" 
                                  stroke="#F15D22" 
                                  strokeWidth={3} 
                                  dot={{ fill: '#F15D22', strokeWidth: 2, r: 4, stroke: '#fff' }}
                                  activeDot={{ r: 6, strokeWidth: 0 }}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-8 space-y-4 shrink-0">
                            <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">Avg Quality</span>
                                <span className="text-sm font-black text-brand-orange">97.4%</span>
                            </div>
                            <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">Weekly Delta</span>
                                <span className="text-sm font-black text-emerald-500">+1.2%</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] mb-8">Departmental Performance</h3>
                        <div className="h-64 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={QUALITY_SNAPSHOT} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <defs>
                                <linearGradient id="colorPass" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
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
                                dataKey="pass" 
                                stroke="#10b981" 
                                fillOpacity={1} 
                                fill="url(#colorPass)" 
                                strokeWidth={2}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
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
                            <p className="text-[9px] text-text-muted/60 mt-2 italic uppercase">Example: https://app.powerbi.com/view?r=...</p>
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
                className="h-full flex flex-col min-h-0 pb-20"
              >
                {/* KPI Cards on Top of Table */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <KPICard 
                    icon={<TrendingUp size={16} className="text-emerald-500" />}
                    label="Compliance"
                    value="98.2%"
                    trend="+0.5%"
                    color="emerald"
                  />
                  <KPICard 
                    icon={<AlertTriangle size={16} className="text-brand-orange" />}
                    label="Open Findings"
                    value={records.filter(r => r.status === 'Open').length}
                    trend="Requires Attention"
                    color="orange"
                  />
                  <KPICard 
                    icon={<CheckCircle2 size={16} className="text-blue-500" />}
                    label="Closed this WW"
                    value={records.filter(r => r.status === 'Closed' && r.ww === filterWW).length}
                    trend="On Track"
                    color="blue"
                  />
                  <KPICard 
                    icon={<Clock size={16} className="text-slate-500" />}
                    label="In Progress"
                    value={records.filter(r => r.status === 'In Progress').length}
                    trend="Needs Follow-up"
                    color="slate"
                  />
                </div>

                <div className="bg-white rounded-lg border border-border-subtle overflow-hidden flex flex-col flex-1">
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto whitespace-nowrap">
                    <table className="w-full text-left border-collapse border border-slate-200">
                      <thead className="bg-[#f2f2f2] sticky top-0 z-10 font-bold border-b-2 border-slate-300">
                        <tr>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 text-center">No</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Date</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 text-center bg-[#fce4ec]">WW</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 text-center bg-[#fce4ec]">Shift</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">IPQC Auditor Name</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">PIC Finding</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Department</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Platform</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">MQE Engineer</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Area / Station</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Group Finding</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Category</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Finding Details</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Finding Image</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Remark</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Status</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">ICAR#</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">ACTION TAKEN</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredRecords.map((record) => (
                          <tr 
                            key={record.id} 
                            onClick={() => setSelectedAudit(record)}
                            className="hover:bg-brand-orange/[0.03] transition-all duration-150 text-[10px] text-slate-700 bg-white cursor-pointer group"
                          >
                            <td className="px-2 py-3 border border-slate-200 text-center font-bold text-slate-400 group-hover:text-brand-orange">{record.no}</td>
                            <td className="px-2 py-3 border border-slate-200 whitespace-nowrap font-medium">{record.auditDate}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center font-bold">{record.ww}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center font-bold">{record.shift}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center italic font-semibold text-slate-600">{record.auditors}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center italic font-semibold text-slate-600">{record.personOnJob}</td>
                            <td className="px-2 py-3 border border-slate-200 font-medium">{record.department}</td>
                            <td className="px-2 py-3 border border-slate-200 font-medium">{record.platform}</td>
                            <td className="px-2 py-3 border border-slate-200 font-black text-brand-orange/80 italic">{record.mqeEngineer}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center font-medium">{record.areaStation}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center">{record.groupFinding}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center">{record.category}</td>
                            <td className="px-2 py-3 border border-slate-200 max-w-[150px] truncate" title={record.detailsFindings}>{record.detailsFindings}</td>
                            <td className="px-2 py-3 border border-slate-200 text-center">
                              {record.picture ? (
                                <div 
                                  onClick={(e) => { e.stopPropagation(); setPreviewImage(record.picture!); }}
                                  className="w-10 h-10 rounded border border-slate-200 overflow-hidden mx-auto shadow-sm hover:scale-110 transition-transform cursor-zoom-in"
                                >
                                  <img src={record.picture} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                                </div>
                              ) : <ImageIcon size={12} className="mx-auto opacity-10" />}
                            </td>
                            <td className="px-2 py-3 border border-slate-200 max-w-[150px] truncate italic text-slate-500" title={record.remark}>{record.remark}</td>
                            <td className={`px-2 py-3 border border-slate-200 text-center font-black ${record.status === 'Open' ? 'bg-[#fce4ec] text-[#e91e63]' : ''}`}>
                              {record.status}
                            </td>
                            <td className="px-2 py-3 border border-slate-200 text-center font-mono text-[9px]">{record.icarNum || '-'}</td>
                            <td className="px-2 py-3 border border-slate-200 whitespace-pre-wrap leading-tight text-[9px]">{record.actionTaken || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden divide-y divide-slate-100 overflow-y-auto">
                    {filteredRecords.map((record) => (
                      <div key={record.id} className="p-5 space-y-4 hover:bg-slate-50 transition-colors group">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-4">
                             <div className="w-12 h-12 rounded-xl shrink-0 bg-white shadow-sm border border-slate-100 flex items-center justify-center text-[10px] text-text-muted overflow-hidden">
                              {record.picture ? (
                                <img src={record.picture} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                              ) : <ImageIcon size={20} className="opacity-10" />}
                            </div>
                            <div className="space-y-1">
                              <div className="text-[11px] font-black uppercase tracking-tight text-slate-800">{record.areaStation}</div>
                              <div className="text-[9px] text-slate-400 font-mono tracking-tighter bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                {record.auditDate} | {record.ww}
                              </div>
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase tracking-widest shadow-sm bg-slate-100 text-slate-600`}>
                            {record.groupFinding}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Platform</span>
                            <span className="text-[10px] font-bold text-slate-700">{record.platform}</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Shift</span>
                            <span className="text-[10px] font-bold text-slate-700">{record.shift}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <span className="text-[9px] font-black uppercase tracking-widest text-brand-orange bg-brand-orange/5 px-2 py-1 rounded">
                            {record.category}
                          </span>
                          <div className="flex items-center gap-2">
                             <button 
                                onClick={() => setSelectedAudit(record)}
                                className="h-8 px-4 rounded-lg bg-white border border-slate-200 text-brand-orange font-black text-[9px] uppercase tracking-widest shadow-sm active:scale-95 transition-all"
                              >
                                View
                              </button>
                              <button onClick={() => handleEditClick(record)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-orange transition-colors">
                                <Pencil size={14} />
                              </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredRecords.length === 0 && (
                    <div className="p-10 text-center text-text-muted text-xs uppercase font-bold">
                      No matching audit records found.
                    </div>
                  )}
                </div>

                {/* Details Modal */}
                <AnimatePresence>
                  {selectedAudit && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-lg w-full max-w-lg overflow-hidden shadow-2xl border border-border-subtle"
                      >
                        <div className="p-4 border-b border-border-subtle flex justify-between items-center bg-bg-main">
                          <div className="flex gap-4">
                            <button 
                              onClick={() => setHistoryTab('details')}
                              className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${historyTab === 'details' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-text-muted hover:text-text-main'}`}
                            >
                              Current Findings
                            </button>
                            <button 
                              onClick={() => setHistoryTab('timeline')}
                              className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${historyTab === 'timeline' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-text-muted hover:text-text-main'}`}
                            >
                              Item History
                            </button>
                          </div>
                          <button onClick={() => { setSelectedAudit(null); setHistoryTab('details'); }} className="text-text-muted hover:text-text-main">
                            <X size={20} />
                          </button>
                        </div>
                        <div className="p-6 space-y-6">
                          <AnimatePresence mode="wait">
                            {historyTab === 'details' ? (
                              <motion.div 
                                key="details-tab"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }}
                                className="space-y-6"
                              >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">IPQC Auditor Name</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.auditors}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">MQE Engineer</span>
                                    <span className="text-xs font-bold text-brand-orange">{selectedAudit.mqeEngineer}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">PIC Name (Finding)</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.personOnJob}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Platform / Station</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.platform} / {selectedAudit.areaStation}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Date / WW</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.auditDate} | {selectedAudit.ww}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Shift / Dept</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.shift} | {selectedAudit.department}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Group Finding / Category</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.groupFinding} / {selectedAudit.category}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">ICAR#</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.icarNum || 'N/A'}</span>
                                  </div>
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1 italic">Status</span>
                                    <span className="text-xs font-bold text-slate-700">{selectedAudit.status}</span>
                                  </div>
                                </div>
                                <div className="space-y-4">
                                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl relative overflow-hidden group">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-2 italic">Finding Details</span>
                                    <p className="text-xs text-slate-600 leading-relaxed font-medium">{selectedAudit.detailsFindings}</p>
                                  </div>
                                  <div className="p-4 bg-emerald-50/30 border border-emerald-100 rounded-xl">
                                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em] block mb-2 italic">Action Taken</span>
                                    <p className="text-xs text-slate-600 leading-relaxed font-medium">{selectedAudit.actionTaken || 'No action recorded.'}</p>
                                  </div>
                                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-2 italic">Remark</span>
                                    <p className="text-xs text-slate-600 leading-relaxed font-medium italic">{selectedAudit.remark || 'N/A'}</p>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div 
                                key="history-tab"
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                className="space-y-4 max-h-[300px] overflow-y-auto pr-2"
                              >
                                <h4 className="text-[10px] font-bold uppercase text-text-muted tracking-widest mb-2">Previous Audits for {selectedAudit.areaStation}</h4>
                                {records
                                  .filter(r => r.areaStation === selectedAudit.areaStation && r.id !== selectedAudit.id)
                                  .sort((a,b) => new Date(b.auditDate).getTime() - new Date(a.auditDate).getTime())
                                  .map((hist) => (
                                    <div key={hist.id} className="p-3 bg-bg-main border border-border-subtle rounded-md flex justify-between items-center">
                                      <div>
                                        <div className="text-xs font-bold">{hist.auditDate} | {hist.ww}</div>
                                        <div className="text-[10px] text-text-muted">{hist.auditors}</div>
                                      </div>
                                      <span className={`px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase bg-slate-100 text-slate-600`}>
                                        {hist.groupFinding}
                                      </span>
                                    </div>
                                  ))}
                                {records.filter(r => r.areaStation === selectedAudit.areaStation && r.id !== selectedAudit.id).length === 0 && (
                                  <div className="text-center py-6 text-xs text-text-muted italic">No prior history found for this area.</div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                          
                          <div className="flex justify-between items-center pt-4 border-t border-border-subtle">
                            <button 
                              onClick={() => {
                                handleEditClick(selectedAudit);
                                setSelectedAudit(null);
                                setHistoryTab('details');
                              }}
                              className="bg-slate-100 text-slate-600 px-6 py-2 rounded text-xs font-bold uppercase transition-all hover:bg-slate-200 flex items-center gap-2"
                            >
                              <Pencil size={12} />
                              Edit Record
                            </button>
                            <button 
                              onClick={() => { setSelectedAudit(null); setHistoryTab('details'); }}
                              className="bg-brand-orange text-white px-6 py-2 rounded text-xs font-bold uppercase transition-all hover:brightness-110"
                            >
                              Close
                            </button>
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
                className="w-full pb-20"
              >
                <div className="bg-white rounded-lg border border-border-subtle overflow-hidden">
                  <div className="bg-bg-main p-4 md:p-6 border-b border-border-subtle flex justify-between items-center">
                    <div>
                      <h2 className="text-lg md:text-xl font-bold">{editingId ? 'Edit Audit Entry' : 'New Audit Entry'}</h2>
                      <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-1">Semicore Quality Management System</p>
                    </div>
                    <button 
                      onClick={() => {
                        setView('ipqc');
                        setEditingId(null);
                        setNewAudit({
                          auditDate: new Date().toISOString().split('T')[0],
                          ww: '',
                          shift: 'Day',
                          auditors: '',
                          personOnJob: '',
                          department: '',
                          platform: '',
                          areaStation: '',
                          groupFinding: '',
                          category: '',
                          detailsFindings: '',
                          remark: '',
                          icarNum: '',
                          actionTaken: '',
                          picture: undefined,
                        });
                      }} 
                      className="text-text-muted hover:text-text-main flex items-center gap-2 text-[10px] font-bold uppercase"
                    >
                      <X size={16} />
                      <span className="hidden sm:inline">Exit</span>
                    </button>
                  </div>
                  
                  <form onSubmit={handleAddAudit} className="p-4 md:p-8 space-y-6 md:space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      <FormInput label="Audit Date" type="date" required value={newAudit.auditDate} onChange={(v: string) => setNewAudit({...newAudit, auditDate: v})} />
                      <FormSelect 
                        label="Work Week (WW)" 
                        required 
                        value={newAudit.ww} 
                        onChange={(v: string) => setNewAudit({...newAudit, ww: v})} 
                        options={WWS}
                      />
                      <FormSelect 
                        label="Shift" 
                        value={newAudit.shift} 
                        onChange={(v: string) => setNewAudit({...newAudit, shift: v as any})}
                        options={['D', 'N']} 
                      />
                      <FormSelect 
                        label="Department" 
                        required 
                        value={newAudit.department} 
                        onChange={(v: string) => setNewAudit({...newAudit, department: v})} 
                        options={DEPARTMENTS}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 font-semibold">
                      <FormSelect 
                        label="Platform" 
                        required 
                        value={newAudit.platform} 
                        onChange={(v: string) => setNewAudit({...newAudit, platform: v})} 
                        options={platformsList}
                      />
                      <FormInput label="Area / Station" required value={newAudit.areaStation} onChange={(v: string) => setNewAudit({...newAudit, areaStation: v})} />
                      <FormSelect 
                        label="Category" 
                        required 
                        value={newAudit.category} 
                        onChange={(v: string) => setNewAudit({...newAudit, category: v})} 
                        options={CATEGORIES}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                      <FormSelect 
                        label="IPQC Auditor Name" 
                        required 
                        value={newAudit.auditors} 
                        onChange={(v: string) => setNewAudit({...newAudit, auditors: v})} 
                        options={auditorsList}
                      />
                      <FormInput label="PIC Name (Finding)" required value={newAudit.personOnJob} onChange={(v: string) => setNewAudit({...newAudit, personOnJob: v})} />
                      <FormSelect 
                        label="ICAR#" 
                        value={newAudit.icarNum} 
                        onChange={(v: string) => setNewAudit({...newAudit, icarNum: v})} 
                        options={['N/A', 'ICAR-2026-001', 'ICAR-2026-002', 'NEW']}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <FormSelect 
                        label="Group Finding" 
                        required 
                        value={newAudit.groupFinding} 
                        onChange={(v: string) => setNewAudit({...newAudit, groupFinding: v})} 
                        options={GROUP_FINDINGS}
                      />
                      <FormSelect 
                        label="Status" 
                        value={newAudit.status} 
                        onChange={(v: string) => setNewAudit({...newAudit, status: v as any})}
                        options={['Open', 'Closed', 'In Progress']} 
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div>
                          <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 block italic">Finding Details</label>
                          <textarea 
                            className="w-full bg-slate-50 border border-border-subtle rounded-xl p-4 text-sm focus:border-brand-orange outline-none transition-all placeholder:text-text-muted/40 min-h-[100px]"
                            placeholder="Detailed description of the issue..."
                            value={newAudit.detailsFindings}
                            onChange={(e) => setNewAudit({...newAudit, detailsFindings: e.target.value})}
                          />
                        </div>
                        <div>
                          <FormSelect 
                            label="Action Taken" 
                            value={newAudit.actionTaken || ''} 
                            onChange={(v: string) => setNewAudit({...newAudit, actionTaken: v})} 
                            options={['N/A', 'Corrected on spot', 'Parts replacement', 'Pending maintenance']}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 block italic">Remark</label>
                          <textarea 
                            className="w-full bg-slate-50 border border-border-subtle rounded-xl p-4 text-sm focus:border-brand-orange outline-none transition-all placeholder:text-text-muted/40 min-h-[100px]"
                            placeholder="Additional remarks..."
                            value={newAudit.remark}
                            onChange={(e) => setNewAudit({...newAudit, remark: e.target.value})}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 block">Audit Evidence Picture</label>
                        <div 
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full bg-slate-50 border-2 border-dashed border-border-subtle rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all h-[120px] md:h-[160px] overflow-hidden"
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
                                src={newAudit.picture} 
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
                              <ImageIcon size={32} className="mx-auto mb-2 opacity-30" />
                              <p className="text-[10px] font-bold uppercase tracking-wider">Drag & drop or click to upload</p>
                              <p className="text-[9px] opacity-60 mt-1 uppercase">Supports: JPG, PNG, WEBP</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-end gap-3 pt-6 md:pt-8 border-t border-border-subtle">
                      <button 
                        type="button" 
                        onClick={() => {
                          setView('ipqc');
                          setEditingId(null);
                          setNewAudit({
                            auditDate: new Date().toISOString().split('T')[0],
                            ww: '',
                            shift: 'Day',
                            auditors: '',
                            personOnJob: '',
                            department: '',
                            platform: '',
                            areaStation: '',
                            groupFinding: '',
                            category: '',
                            detailsFindings: '',
                            remark: '',
                            icarNum: '',
                            actionTaken: '',
                            picture: undefined,
                          });
                        }}
                        className="px-6 py-2.5 text-xs font-bold uppercase text-text-muted hover:text-text-main transition-colors order-2 sm:order-1"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="bg-brand-orange text-white px-10 py-2.5 rounded text-xs font-bold uppercase shadow-lg shadow-brand-orange/20 hover:brightness-110 active:scale-95 transition-all order-1 sm:order-2"
                      >
                        {editingId ? 'Update Record' : 'Submit Audit'}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {view === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                className="space-y-6 pb-20"
              >
                {/* History Header & Date Selector */}
                <div className="bg-white p-6 rounded-lg border border-border-subtle flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-xl flex items-center justify-center">
                      <History size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Audit History Explorer</h3>
                      <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-0.5">Select a date to view full daily logs</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2 w-full md:w-auto">
                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest pl-1">Target Date</label>
                    <div className="relative">
                      <input 
                        type="date" 
                        value={historyDate}
                        onChange={(e) => setHistoryDate(e.target.value)}
                        className="w-full md:w-64 bg-slate-50 border border-border-subtle rounded-lg p-3 text-sm font-bold text-brand-orange outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Daily Report View */}
                <div className="bg-white rounded-lg border border-border-subtle overflow-hidden shadow-sm flex flex-col">
                  <div className="bg-bg-main p-4 border-b border-border-subtle flex justify-between items-center">
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-brand-orange animate-pulse"></div>
                       <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Archives for {historyDate}</span>
                    </div>
                    <span className="text-[10px] font-bold bg-white px-2 py-1 rounded border border-border-subtle text-text-muted">
                      {records.filter(r => r.auditDate === historyDate).length} Records Found
                    </span>
                  </div>

                  <div className="overflow-x-auto whitespace-nowrap">
                    <table className="w-full text-left border-collapse border border-slate-200">
                      <thead className="bg-[#f2f2f2] sticky top-0 z-10 font-bold border-b-2 border-slate-300">
                        <tr>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 text-center">No</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Date</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 text-center bg-[#fce4ec]">WW</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 text-center bg-[#fce4ec]">Shift</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">IPQC Auditor Name</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">PIC Finding</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Department</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Platform</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">MQE Engineer</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Area / Station</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Group Finding</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Category</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Finding Details</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Finding Image</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">Remark</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300 bg-[#fce4ec]">Status</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">ICAR#</th>
                          <th className="px-2 py-3 text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-300">ACTION TAKEN</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {records
                          .filter(r => r.auditDate === historyDate)
                          .sort((a, b) => b.no - a.no)
                          .map((record) => (
                            <tr 
                              key={record.id} 
                              onClick={() => setSelectedAudit(record)}
                              className="hover:bg-brand-orange/[0.03] transition-all duration-150 text-[10px] text-slate-700 bg-white cursor-pointer group"
                            >
                              <td className="px-2 py-3 border border-slate-200 text-center font-bold text-slate-400 group-hover:text-brand-orange">{record.no}</td>
                              <td className="px-2 py-3 border border-slate-200 whitespace-nowrap font-medium">{record.auditDate}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center font-bold">{record.ww}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center font-bold">{record.shift}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center italic font-semibold text-slate-600">{record.auditors}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center italic font-semibold text-slate-600">{record.personOnJob}</td>
                              <td className="px-2 py-3 border border-slate-200 font-medium">{record.department}</td>
                              <td className="px-2 py-3 border border-slate-200 font-medium">{record.platform}</td>
                              <td className="px-2 py-3 border border-slate-200 font-black text-brand-orange/80 italic">{record.mqeEngineer}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center font-medium">{record.areaStation}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center">{record.groupFinding}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center">{record.category}</td>
                              <td className="px-2 py-3 border border-slate-200 max-w-[150px] truncate" title={record.detailsFindings}>{record.detailsFindings}</td>
                              <td className="px-2 py-3 border border-slate-200 text-center">
                                {record.picture ? (
                                  <div className="w-6 h-6 rounded border border-slate-200 overflow-hidden mx-auto">
                                    <img src={record.picture} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                                  </div>
                                ) : <ImageIcon size={12} className="mx-auto opacity-10" />}
                              </td>
                              <td className="px-2 py-3 border border-slate-200 max-w-[150px] truncate italic text-slate-500" title={record.remark}>{record.remark}</td>
                              <td className={`px-2 py-3 border border-slate-200 text-center font-black ${record.status === 'Open' ? 'bg-[#fce4ec] text-[#e91e63]' : ''}`}>
                                {record.status}
                              </td>
                              <td className="px-2 py-3 border border-slate-200 text-center font-mono text-[9px]">{record.icarNum || '-'}</td>
                              <td className="px-2 py-3 border border-slate-200 whitespace-pre-wrap leading-tight text-[9px]">{record.actionTaken || '-'}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>

                    {records.filter(r => r.auditDate === historyDate).length === 0 && (
                      <div className="p-20 text-center bg-white">
                        <div className="w-16 h-16 bg-bg-main rounded-full flex items-center justify-center mx-auto mb-4 text-text-muted/30">
                          <History size={32} />
                        </div>
                        <h4 className="font-bold text-text-muted uppercase tracking-widest text-sm">No Records for this Date</h4>
                        <p className="text-xs text-text-muted/60 mt-2">Try selecting a different date from the selector above.</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'checklist' && (
              <motion.div 
                key="checklist"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white p-10 rounded-lg border border-border-subtle text-center"
              >
                <div className="w-16 h-16 bg-bg-main text-brand-orange rounded mx-auto mb-4 flex items-center justify-center">
                  <FileText size={32} />
                </div>
                <h2 className="text-xl font-bold mb-2 uppercase tracking-wide">Quality Guidelines</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl mx-auto text-left mt-8">
                  {['Lithography Safety SOP', 'Etch Gas Handling SOP', 'Wafer Cleaning Protocol', 'Packaging Inspection Guide'].map(sop => (
                    <div key={sop} className="p-3 border border-border-subtle rounded flex items-center justify-between text-xs font-bold uppercase text-text-muted hover:bg-bg-main transition-colors cursor-pointer">
                      <span>{sop}</span>
                      <FileText size={14} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {view === 'settings' && isAdmin && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 pb-20"
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

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
                    {/* Auditors Management */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                          <Users size={14} className="text-brand-orange" />
                          IPQC Auditors
                        </h3>
                        <button className="text-[10px] font-black text-brand-orange uppercase">+ Add New</button>
                      </div>
                      <div className="space-y-1">
                        {auditorsList.map((auditor, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl group hover:bg-white hover:border-brand-orange/20 transition-all">
                            <span className="text-xs font-bold text-slate-700">{auditor}</span>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400"><Pencil size={12}/></button>
                              <button className="p-1.5 hover:bg-rose-50 rounded-md text-rose-400"><Trash2 size={12}/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Platform Management */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                          <Layers size={14} className="text-brand-orange" />
                          Platforms
                        </h3>
                        <button className="text-[10px] font-black text-brand-orange uppercase">+ Add New</button>
                      </div>
                      <div className="space-y-1">
                        {platformsList.map((platform, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl group hover:bg-white hover:border-brand-orange/20 transition-all">
                            <span className="text-xs font-bold text-slate-700">{platform}</span>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400"><Pencil size={12}/></button>
                              <button className="p-1.5 hover:bg-rose-50 rounded-md text-rose-400"><Trash2 size={12}/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* MQE Mapping Management */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                        <ClipboardCheck size={14} className="text-brand-orange" />
                        Platform - MQE Mapping
                      </h3>
                      <div className="overflow-hidden border border-slate-100 rounded-2xl">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                            <tr>
                              <th className="px-4 py-3">Platform</th>
                              <th className="px-4 py-3">Responsible MQE</th>
                              <th className="px-4 py-3"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {platformsList.map((platform) => (
                              <tr key={platform} className="hover:bg-slate-50/50 transition-all text-xs font-bold text-slate-700">
                                <td className="px-4 py-3 font-black text-slate-400">{platform}</td>
                                <td className="px-4 py-3 text-brand-orange uppercase tracking-tight">
                                  {mqeMappings[platform] || 'Unassigned'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button className="p-1.5 hover:bg-white rounded border border-transparent hover:border-brand-orange/10 text-slate-300 hover:text-brand-orange transition-all">
                                    <Pencil size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-slate-400 italic">Only administrators can modify these system-wide constants.</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Login Modal */}
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

      {/* Image Preview Modal (Lightbox) */}
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
                className="max-w-full max-h-[80vh] rounded-2xl shadow-2xl border-4 border-white/10 object-contain shadow-brand-orange/20"
                referrerPolicy="no-referrer"
              />
              <div className="absolute -bottom-16 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white/60 text-[10px] font-black uppercase tracking-[0.3em]">IPQC Tracker Detail View</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper Components
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

function StatCard({ label, value, trend }: { label: string, value: string | number, trend?: string }) {
  return (
    <div className="flex-1 bg-white p-5 rounded-xl border border-border-subtle shadow-sm hover:shadow-md transition-all group">
      <div className="flex justify-between items-start">
        <div className="text-[10px] text-text-muted font-bold uppercase tracking-[0.1em]">{label}</div>
        {trend && (
          <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${trend.startsWith('+') ? 'text-green-600 bg-green-50' : trend.includes('%') ? 'text-red-600 bg-red-50' : 'text-slate-500 bg-slate-50'}`}>
            {trend}
          </div>
        )}
      </div>
      <div className="text-3xl font-black text-slate-900 mt-2 tracking-tight group-hover:text-brand-orange transition-colors">{value}</div>
    </div>
  );
}

function KPICard({ label, value, trend, icon, color }: { label: string, value: string | number, trend: string, icon: any, color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-emerald-500/5',
    orange: 'bg-orange-50 text-orange-600 border-orange-100 shadow-orange-500/5',
    blue: 'bg-blue-50 text-blue-600 border-blue-100 shadow-blue-500/5',
    slate: 'bg-slate-50 text-slate-600 border-slate-100 shadow-slate-500/5'
  };

  return (
    <div className={`p-4 rounded-2xl border bg-white shadow-lg transition-all hover:scale-[1.02] ${colors[color]}`}>
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

function DistributionRow({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
        <div className={`${color} h-full rounded-full transition-all duration-1000`} style={{ width: `${value}%` }}></div>
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

function DetailItem({ label, value }: { label: string, value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{label}</span>
      <span className="text-text-main font-bold text-sm tracking-tight">{value}</span>
    </div>
  );
}

function getFindingStyle(finding: string) {
  switch(finding) {
    case 'Completed': 
    case 'Closed': return 'bg-[#dcfce7] text-[#15803d]';
    case 'Fail': return 'bg-[#fee2e2] text-[#b91c1c]';
    case 'Open': return 'bg-[#fce7f3] text-[#be185d]'; // Pink background as in image
    case 'Observation': 
    case 'Pending': 
    case 'In Progress': return 'bg-[#fef3c7] text-[#92400e]';
    default: return 'bg-slate-100 text-slate-700';
  }
}