import SiteGuide from './components/SiteGuide';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Calendar from './components/Calendar';
import AccountSelector from './components/AccountSelector';
import AddAccountModal from './components/AddAccountModal';
import TradeList from './components/TradeList';
import Ideas from './components/Ideas';
import Analytics from './components/Analytics';
import Charts from './components/Charts';
import MarketChart from './components/MarketChart';
import StrategyBuilder from './components/StrategyBuilder';
import Insights from './components/Insights';
import RiskManagement from './components/RiskManagement';
import Social from './components/Social';
import Automation from './components/Automation';
import Advanced from './components/Advanced';
import LoginForm from './components/LoginForm';
import AddTradeModal from './components/AddTradeModal';
import ImportModal from './components/ImportModal';
import PropStatus from './components/PropStatus';
import Setups from './components/Setups';
import Overview from './components/Overview';
import DateRangeBar from './components/DateRangeBar';
import { setCurrency } from './utils/format';
import Breakdown from './components/Breakdown';
import Compare from './components/Compare';
import Checklist from './components/Checklist';
import PreMarket from './components/PreMarket';
import Discipline from './components/Discipline';
import Report from './components/Report';
import PropFirms from './components/PropFirms';
import Challenges from './components/Challenges';
import Coach from './components/Coach';
import Emotions from './components/Emotions';
import DataTable from './components/DataTable';
import AttemptBar, { AttemptLite } from './components/AttemptBar';
import UpgradeWall from './components/UpgradeWall';
import ErrorBoundary from './components/ErrorBoundary';
import BacktestLab from './components/BacktestLab';
import S1Practice from './components/S1Practice';
import PatternFinder from './components/PatternFinder';
import { setChartLinkEnabled, OPEN_CHART_EVENT } from './utils/chartLink';
import FocusPanel from './components/FocusPanel';
import { PageHeader, SubTabs } from './components/ui';
import {
  LayoutDashboard, Table2, NotebookPen, Trophy, Compass, BarChart3, Layers, Clock, Brain, Scale,
  CandlestickChart, FlaskConical, Workflow, ListChecks, ShieldCheck, Building2, Lock, Upload, Plus,
  RefreshCw, LogOut, Menu, X, BookOpen, ChevronLeft, ChevronRight, LineChart, AlertTriangle, Flame, RotateCcw,
  Lightbulb, Users, Bot, Settings2, CalendarDays, PlusCircle, Target, ScanSearch,
} from 'lucide-react';
import './App.css';

type NavItem = { key: string; label: string; icon: React.ComponentType<any>; match?: string[] };

// One-line plain-English purpose for every page (shown under the title)
const PAGE_META: Record<string, { title: string; sub: string; icon: React.ComponentType<any> }> = {
  dashboard: { title: 'Dashboard', icon: LayoutDashboard, sub: 'Your results at a glance, what to work on this week, and every trading day on the calendar.' },
  data: { title: 'Trade Log', icon: Table2, sub: 'Every trade in one table. Search, filter, tag many trades at once, or export to CSV.' },
  premarket: { title: 'Daily Plan', icon: NotebookPen, sub: 'Before the open: call the day type, bias and live setups. After the close: note whether you followed it.' },
  challenges: { title: 'Challenges', icon: Trophy, sub: 'Each prop-firm attempt or backtest run as one row. Mark it passed or blown, and compare any two runs.' },
  coach: { title: 'Coach', icon: Compass, sub: 'Plain-English coaching from your own trades: what is costing you, what is working, and what to do next.' },
  analytics: { title: 'Performance', icon: BarChart3, sub: 'Your headline numbers, daily and monthly P&L charts, and a printable report for any period.' },
  setups: { title: 'Setups', icon: Layers, sub: 'Which setups make money and which cost you. Tag and grade trades to make this sharper.' },
  breakdown: { title: 'Time & Sessions', icon: Clock, sub: 'When you trade best and worst: by hour, weekday, session and instrument.' },
  discipline: { title: 'Mindset', icon: Brain, sub: 'Did you follow your plan, and what did your emotions cost you?' },
  compare: { title: 'Paper vs Real', icon: Scale, sub: 'Put a practice account next to a live one to see what changes when real money is on the line.' },
  s1practice: { title: 'S1 Practice', icon: Target, sub: '25 replay days for S1. Every replay trade is checked against the S1 bot rules and compared with what the bot did that day.' },
  patterns: { title: 'Pattern Finder', icon: ScanSearch, sub: 'Test your exact trade (target $ / stop $) at every time of day and weekday over 5 years of NQ, with a train / test split so luck is not mistaken for an edge.' },
  backtestlab: { title: 'Backtest Lab', icon: FlaskConical, sub: 'Stress-test a run before risking money: equity, drawdown, prop-challenge pass rate and reshuffled-order risk.' },
  strategy: { title: 'Strategy Rules', icon: Workflow, sub: 'Write down each strategy’s entry, exit and risk rules so you trade it the same way every time.' },
  checklist: { title: 'Entry Checklist', icon: ListChecks, sub: 'Run this before every entry. If any gate fails, there is no trade. The score decides A, B or C.' },
  risk: { title: 'Risk & Sizing', icon: ShieldCheck, sub: 'How much to risk per trade, how many contracts to trade, and when to stop for the day.' },
  propfirms: { title: 'Prop Firms', icon: Building2, sub: 'Compare 25K and 50K evaluations side by side — rules, real cost and traps — before you buy.' },
  insights: { title: 'Insights', icon: Lightbulb, sub: 'Patterns and recommendations found in your trades.' },
  automation: { title: 'Automation', icon: Bot, sub: 'Bots and automated positions.' },
  advanced: { title: 'Advanced', icon: Settings2, sub: 'Portfolio, tax records and webhooks.' },
  social: { title: 'Social', icon: Users, sub: 'Leaderboard and shared trades.' },
};
// Pages that share one nav entry, shown as tabs
const SUBTABS: Record<string, { key: string; label: string }[]> = {
  analytics: [{ key: 'analytics', label: 'Stats' }, { key: 'charts', label: 'P&L charts' }, { key: 'report', label: 'Report' }],
  discipline: [{ key: 'discipline', label: 'Discipline' }, { key: 'emotions', label: 'Emotions' }],
};
const PARENT: Record<string, string> = { charts: 'analytics', report: 'analytics', emotions: 'discipline' };

interface Account {
  id: number;
  broker: string;
  account_number: string;
  account_name: string;
  account_type?: string;
  currency?: string;
  timezone?: string | null;
}

interface DailySummary {
  account_id: number;
  trade_date: string;
  daily_pnl?: number;
  trade_count: number;
  blown?: boolean;
}

interface Trade {
  id: number;
  account_id: number;
  symbol: string;
  entry_time: string;
  exit_time?: string;
  entry_price: number;
  exit_price?: number;
  quantity: number;
  pnl?: number;
  setup_tag?: string;
  notes?: string;
}

const PRO_VIEWS = new Set(['coach', 'emotions', 'challenges', 'setups', 'breakdown', 'discipline', 'report', 'charts', 'compare', 'risk', 'strategy']);
const FEATURE_LABEL: Record<string, string> = {
  coach: 'Coach', emotions: 'Emotions', challenges: 'Challenges', setups: 'Setups',
  breakdown: 'Time & Sessions', discipline: 'Discipline', report: 'Report', charts: 'P&L charts',
  compare: 'Paper vs Real', risk: 'Risk & Sizing', strategy: 'Strategy Rules',
};

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userId, setUserId] = useState<number | null>(null);
  const [plan, setPlan] = useState<'free' | 'pro'>('pro'); // optimistic; corrected from /me
  const [isAdmin, setIsAdmin] = useState(false); // owner-only pages (market chart)
  const [chartFocus, setChartFocus] = useState<{ tradeId: number; replayDay?: string; nonce: number } | null>(null);
  // 'Open on chart' from any trade view, or 'Replay this day' from S1 Practice
  useEffect(() => {
    const open = (e: Event) => {
      const det = (e as CustomEvent).detail || {};
      const id = Number(det.tradeId) || 0;
      const day = typeof det.replayDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(det.replayDay) ? det.replayDay : undefined;
      if (!id && !day) return;
      setChartFocus({ tradeId: id, replayDay: day, nonce: Date.now() });
      setView('marketchart');
    };
    window.addEventListener(OPEN_CHART_EVENT, open);
    return () => window.removeEventListener(OPEN_CHART_EVENT, open);
  }, []);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddTradeModal, setShowAddTradeModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [view, setView] = useState<string>('dashboard');
  // Left sidebar: full, or a slim icon strip (remembered in this browser)
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('jc.navCollapsed') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed(c => {
    try { localStorage.setItem('jc.navCollapsed', c ? '0' : '1'); } catch { /* storage unavailable */ }
    return !c;
  });
  const [range, setRange] = useState<{ from: string | null; to: string | null; label: string }>({ from: null, to: null, label: 'All time' });
  const [overtrading, setOvertrading] = useState<any>(null);
  const [attempts, setAttempts] = useState<AttemptLite[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null); // null = All attempts

  // Mobile: the sidebar is a slide-in drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // Grouped by the daily flow: log it -> review it -> practise -> plan the next session
  const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
    {
      title: 'Journal', items: [
        { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { key: 'data', label: 'Trade Log', icon: Table2 },
        { key: 'premarket', label: 'Daily Plan', icon: NotebookPen },
        { key: 'challenges', label: 'Challenges', icon: Trophy },
      ]
    },
    {
      title: 'Review', items: [
        { key: 'coach', label: 'Coach', icon: Compass },
        { key: 'analytics', label: 'Performance', icon: BarChart3, match: ['analytics', 'charts', 'report'] },
        { key: 'setups', label: 'Setups', icon: Layers },
        { key: 'breakdown', label: 'Time & Sessions', icon: Clock },
        { key: 'discipline', label: 'Mindset', icon: Brain, match: ['discipline', 'emotions'] },
        { key: 'compare', label: 'Paper vs Real', icon: Scale },
      ]
    },
    {
      title: 'Practice', items: [
        ...(isAdmin ? [{ key: 'marketchart', label: 'Market Chart', icon: CandlestickChart }, { key: 's1practice', label: 'S1 Practice', icon: Target }, { key: 'patterns', label: 'Pattern Finder', icon: ScanSearch }] : []),
        { key: 'backtestlab', label: 'Backtest Lab', icon: FlaskConical },
        { key: 'strategy', label: 'Strategy Rules', icon: Workflow },
      ]
    },
    {
      title: 'Plan', items: [
        { key: 'checklist', label: 'Entry Checklist', icon: ListChecks },
        { key: 'risk', label: 'Risk & Sizing', icon: ShieldCheck },
        { key: 'propfirms', label: 'Prop Firms', icon: Building2 },
      ]
    },
  ];
  const go = (key: string) => {
    setView(key);
    if (key === 'marketchart') setChartFocus(null);
    setMobileNavOpen(false);
    window.scrollTo(0, 0);
  };

  // Keep a global axios auth header in sync so every request (incl. TradeDetail) is authenticated
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // On load AND after a fresh login: /me says whether this is the owner (market chart, S1 Practice)
  useEffect(() => {
    if (token) {
      verifyToken();
    } else {
      setIsAdmin(false); setChartLinkEnabled(false);
    }
  }, [token]);

  useEffect(() => {
    if (userId) {
      fetchAccounts();
    }
  }, [userId, token]);

  useEffect(() => {
    if (userId && month && year) {
      fetchDailySummaries();
    }
  }, [month, year, userId, token, selectedAccount, selectedAttempt]);

  // When the account changes, load its attempts and default to the latest run
  useEffect(() => {
    if (selectedAccount) fetchAttempts(true);
    else { setAttempts([]); setSelectedAttempt(null); }
  }, [selectedAccount]);

  useEffect(() => {
    if (token && selectedAccount) {
      axios.get(`/api/overtrading/${selectedAccount}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => setOvertrading(r.data.data)).catch(() => setOvertrading(null));
    }
  }, [selectedAccount, token]);

  useEffect(() => {
    if (selectedDate && userId) {
      fetchTrades();
    }
  }, [selectedDate, selectedAccount, userId, token, selectedAttempt]);

  const verifyToken = async () => {
    try {
      const response = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUserId(response.data.user.id);
      setPlan(response.data.user.plan === 'pro' ? 'pro' : 'free');
      setChartLinkEnabled(!!response.data.user.is_admin);
      setIsAdmin(!!response.data.user.is_admin);
    } catch (error) {
      console.error('Token invalid:', error);
      setToken(null);
      localStorage.removeItem('token');
    }
  };

  const handleLogin = (newToken: string, newUserId: number) => {
    setToken(newToken);
    setUserId(newUserId);
    localStorage.setItem('token', newToken);
  };

  const handleLogout = () => {
    setToken(null);
    setUserId(null);
    localStorage.removeItem('token');
  };

  const fetchAccounts = async () => {
    try {
      const response = await axios.get('/api/accounts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const accts = Array.isArray(response.data.data) ? response.data.data : [];
      setAccounts(accts);
      if (accts.length > 0 && !selectedAccount) {
        setSelectedAccount(accts[0].id);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
      setAccounts([]);
    }
  };

  const fetchAttempts = async (autoSelectLatest = false) => {
    if (!selectedAccount) { setAttempts([]); return; }
    try {
      const r = await axios.get(`/api/accounts/${selectedAccount}/attempts`);
      const list: AttemptLite[] = (r.data.data || []).map((a: any) => ({ id: a.id, seq: a.seq, label: a.label, status: a.status }));
      setAttempts(list);
      // On account switch, default to viewing the latest (live) run
      if (autoSelectLatest && list.length > 0) setSelectedAttempt(list[list.length - 1].id);
    } catch (e) { console.error('Error fetching attempts:', e); setAttempts([]); }
  };

  const fetchDailySummaries = async () => {
    try {
      const response = await axios.get('/api/daily-summary', {
        headers: { Authorization: `Bearer ${token}` },
        params: { month, year, account_id: selectedAccount || undefined, attempt: selectedAttempt || undefined }
      });
      setDailySummaries(response.data.data || []);
    } catch (error) {
      console.error('Error fetching daily summaries:', error);
    }
  };

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/trades', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          date: selectedDate,
          account_id: selectedAccount,
          attempt: selectedAttempt || undefined
        }
      });
      setTrades(response.data.data || []);
    } catch (error) {
      console.error('Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRenameAccount = async (id: number, current: string) => {
    if (!token) return;
    const name = window.prompt('Rename account:', current);
    if (name == null || !name.trim() || name.trim() === current) return;
    try {
      await axios.put(`/api/accounts/${id}/name`, { account_name: name.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      await fetchAccounts();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not rename account');
    }
  };

  const handleSetTimezone = async (id: number, timezone: string | null) => {
    if (!token) return;
    try {
      await axios.put(`/api/accounts/${id}/timezone`, { timezone }, { headers: { Authorization: `Bearer ${token}` } });
      await fetchAccounts();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not change the time zone');
    }
  };

  const handleDeleteAccount = async (id: number, name: string) => {
    if (!token) return;
    if (!window.confirm(`Delete "${name}" and ALL its trades, attempts, and notes? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/accounts/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (selectedAccount === id) { setSelectedAccount(null); setSelectedAttempt(null); }
      await fetchAccounts();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not delete account');
    }
  };

  const toggleBlown = async () => {
    if (!selectedAccount || !selectedDate || !token) return;
    const summary = dailySummaries.find(d => d.trade_date === selectedDate);
    const isBlown = summary?.blown;
    try {
      if (isBlown) {
        await axios.delete(`/api/accounts/${selectedAccount}/events?date=${selectedDate}&type=blown`, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        await axios.post(`/api/accounts/${selectedAccount}/events`, { date: selectedDate, type: 'blown' }, { headers: { Authorization: `Bearer ${token}` } });
      }
      fetchDailySummaries();
    } catch (e) { console.error(e); }
  };

  const handleSync = async () => {
    if (!selectedAccount || !token) return;
    try {
      await axios.post(
        `/api/accounts/${selectedAccount}/sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDailySummaries();
      if (selectedDate) {
        await fetchTrades();
      }
    } catch (error) {
      console.error('Error syncing:', error);
    }
  };

  if (!token || !userId) {
    return <LoginForm onLogin={handleLogin} />;
  }

  // Set the active currency symbol from the selected account (₹ default, $ for USD)
  setCurrency(accounts.find(a => a.id === selectedAccount)?.currency);

  const isPro = plan === 'pro';
  const showWall = PRO_VIEWS.has(view) && !isPro;
  const handleUpgrade = () => {
    // Stripe checkout is wired in the final step. For now, guide the user.
    alert('Pro checkout is being finalized. You will be able to upgrade right here shortly.');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button className="hdr-icon mobile-only" onClick={() => setMobileNavOpen(o => !o)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'} title="Menu">
            {mobileNavOpen ? <X className="ic-lg" /> : <Menu className="ic-lg" />}
          </button>
          <button className="brand" onClick={() => go('dashboard')} title="Go to the dashboard">
            <span className="brand-mark"><LineChart className="ic-sm" /></span>
            <span className="brand-name">Trading Journal</span>
          </button>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowImportModal(true)} className="hdr-btn ghost" title="Import trades from a broker CSV file">
            <Upload /><span className="hdr-label">Import</span>
          </button>
          <button onClick={() => setShowAddTradeModal(true)} className="hdr-btn primary" title="Log a trade by hand">
            <Plus /><span className="hdr-label">Add trade</span>
          </button>
          <button onClick={() => setGuideOpen(true)} className="hdr-btn ghost" title="Guide: what every page does and how to use it" aria-label="Open the guide">
            <BookOpen /><span className="hdr-label">Guide</span>
          </button>
          <button onClick={handleSync} className="hdr-icon" title="Sync now — pull the latest trades from the connected broker" aria-label="Sync now">
            <RefreshCw />
          </button>
          {isPro
            ? <span className="plan-pill pro" title="Pro plan">Pro</span>
            : <button className="plan-pill free" onClick={() => go('coach')}>Free · Upgrade</button>}
          <button onClick={handleLogout} className="hdr-icon" title="Log out" aria-label="Log out"><LogOut /></button>
        </div>
      </header>
      {mobileNavOpen && <div className="nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <SiteGuide open={guideOpen} onClose={() => setGuideOpen(false)} onGo={go} isAdmin={isAdmin}
        onTourMenu={o => { if (window.matchMedia('(max-width: 860px), (max-height: 500px) and (pointer: coarse)').matches) setMobileNavOpen(o); }} />

      <AddAccountModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAccountAdded={fetchAccounts}
        token={token || ''}
      />

      <AddTradeModal
        isOpen={showAddTradeModal}
        onClose={() => setShowAddTradeModal(false)}
        onTradeAdded={() => {
          fetchTrades();
          fetchDailySummaries();
          fetchAttempts();
        }}
        token={token || ''}
        accountId={selectedAccount || undefined}
      />

      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => {
          fetchDailySummaries();
          fetchAttempts();
          if (selectedDate) fetchTrades();
        }}
        token={token || ''}
        accountId={selectedAccount || undefined}
        accountName={accounts.find(a => a.id === selectedAccount)?.account_name}
      />

      <main className={`main${view === 'marketchart' ? ' main-wide' : ''}`}>
        <div className={`sidebar${navCollapsed ? ' collapsed' : ''}${mobileNavOpen ? ' mobile-open' : ''}`}>
          <div className="sidebar-rail">
            <button className="sidebar-toggle" onClick={toggleNav}
              title={navCollapsed ? 'Show the sidebar' : 'Hide the sidebar'} aria-label={navCollapsed ? 'Show the sidebar' : 'Hide the sidebar'}>
              {navCollapsed ? <ChevronRight className="ic-sm" /> : <ChevronLeft className="ic-sm" />}
            </button>
          </div>
          {navCollapsed && (() => {
            const a = accounts.find(x => x.id === selectedAccount);
            const name = a?.account_name || a?.account_number || '';
            return a ? (
              <button className="sidebar-acct" onClick={toggleNav} title={`${name} — click to change account`}>
                {name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'}
              </button>
            ) : null;
          })()}
          <AccountSelector
            accounts={accounts}
            selectedAccount={selectedAccount}
            onSelectAccount={setSelectedAccount}
            onAddClick={() => setShowAddModal(true)}
            onDeleteAccount={handleDeleteAccount}
            onRenameAccount={handleRenameAccount}
            onSetTimezone={handleSetTimezone}
          />

          <nav className="nav-menu">
            {NAV_SECTIONS.map(section => (
              <div key={section.title} className="nav-section">
                <div className="nav-section-title">{section.title}</div>
                {section.items.map(item => {
                  const active = (item.match || [item.key]).includes(view);
                  return (
                    <button
                      key={item.key}
                      data-nav={item.key}
                      className={`nav-item ${active ? 'active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      title={navCollapsed ? item.label : undefined}
                      onClick={() => go(item.key)}
                    >
                      <span className="nav-icon"><item.icon /></span>
                      <span className="nav-label">{item.label}</span>
                      {!isPro && PRO_VIEWS.has(item.key) && <span className="nav-lock" title="Pro feature"><Lock className="ic-sm" /></span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        <div className="content">
          {view !== 'marketchart' && (() => {
            const parent = PARENT[view] || view;
            const meta = PAGE_META[parent];
            if (!meta) return null;
            return (
              <>
                <PageHeader icon={meta.icon} title={meta.title} sub={meta.sub} />
                {SUBTABS[parent] && <SubTabs tabs={SUBTABS[parent]} value={view} onChange={setView} />}
              </>
            );
          })()}

          {!selectedAccount && (
            <div className="no-account">
              <h2>No account selected</h2>
              <p>Add a trading account (or pick one at the top of the sidebar) to start your journal.</p>
              <button className="btn-solid" onClick={() => setShowAddModal(true)}><PlusCircle /> Add account</button>
            </div>
          )}

          {selectedAccount && showWall && (
            <UpgradeWall feature={FEATURE_LABEL[view] || 'This'} onUpgrade={handleUpgrade} />
          )}

          {!showWall && <>
          {/* ---- DASHBOARD ---- */}
          {/* Date-range bar (filters Overview + Setup Performance + Breakdown + Report) */}
          {token && selectedAccount && ['dashboard', 'setups', 'breakdown', 'report'].includes(view) && (
            <DateRangeBar range={range} onChange={setRange} />
          )}

          {view === 'dashboard' && (
            <>
              {token && selectedAccount && attempts.length > 0 && (
                <AttemptBar
                  account_id={selectedAccount}
                  attempts={attempts}
                  selectedAttempt={selectedAttempt}
                  onSelect={setSelectedAttempt}
                  onChanged={() => { fetchAttempts(); fetchDailySummaries(); if (selectedDate) fetchTrades(); }}
                  onOpenChallenges={() => setView('challenges')}
                />
              )}
              {token && selectedAccount && (
                <div className="flow" aria-label="Daily routine">
                  {[
                    { n: 1, t: 'Plan the session', d: 'Day type, bias, live setups', on: () => go('premarket') },
                    { n: 2, t: 'Log your trades', d: 'Import a CSV or add by hand', on: () => setShowImportModal(true) },
                    { n: 3, t: 'Review the day', d: 'Pick a day on the calendar below', on: () => document.querySelector('.calendar')?.scrollIntoView({ behavior: 'smooth' }) },
                    { n: 4, t: 'Fix one thing', d: 'Your focus this week', on: () => document.querySelector('.focus-panel')?.scrollIntoView({ behavior: 'smooth' }) },
                  ].map(s => (
                    <button key={s.n} className="flow-step" onClick={s.on}>
                      <span className="flow-num">{s.n}</span>
                      <span className="flow-text"><span className="flow-title">{s.t}</span><span className="flow-desc">{s.d}</span></span>
                    </button>
                  ))}
                </div>
              )}
              {token && selectedAccount && (
                <ErrorBoundary name="Overview"><Overview token={token} account_id={selectedAccount} from={range.from} to={range.to} attempt={selectedAttempt} /></ErrorBoundary>
              )}
              {token && selectedAccount && (
                <ErrorBoundary name="Focus">
                  <FocusPanel token={token} account_id={selectedAccount} from={range.from} to={range.to}
                    attempt={selectedAttempt} rangeLabel={range.label} isAdmin={isAdmin} onNavigate={go} />
                </ErrorBoundary>
              )}
              {token && selectedAccount && (
                <ErrorBoundary name="Prop Status"><PropStatus token={token} accountId={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
              )}
              <Calendar
                month={month}
                year={year}
                onMonthChange={setMonth}
                onYearChange={setYear}
                dailySummaries={dailySummaries}
                selectedDate={selectedDate}
                onDateClick={(date) => setSelectedDate(date)}
              />
              {selectedDate && (
                <>
                  <ErrorBoundary name="Trades">
                    <div className="trades-panel">
                      <div className="trades-panel-head">
                        <h2><CalendarDays className="ic-lg" /> Trades on {new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</h2>
                        <button className="blow-btn" onClick={toggleBlown}
                          title="Marks this day as the day the account (challenge) was blown">
                          {dailySummaries.find(d => d.trade_date === selectedDate)?.blown
                            ? <><RotateCcw className="ic-sm" /> Unmark blown</>
                            : <><Flame className="ic-sm" /> Mark account blown</>}
                        </button>
                      </div>
                      <p className="review-hint">Click a trade to review it: tag the setup, grade it A/B/C, note how you felt and add the stop. That is what the coach learns from.</p>
                      {(() => {
                        const dayCount = dailySummaries.find(d => d.trade_date === selectedDate)?.trade_count || 0;
                        if (overtrading?.threshold && dayCount >= overtrading.threshold) {
                          return (
                            <div className="overtrade-warn">
                              <AlertTriangle className="ic-sm" />
                              <span><strong>Overtrading day</strong> — {dayCount} trades vs your usual ~{overtrading.medianPerDay}/day.
                              High-volume days are usually where the money leaks. Next session: fewer trades, A-grade setups only.</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <TradeList
                        trades={trades}
                        loading={loading}
                        token={token || ''}
                        onTradeSaved={() => { fetchTrades(); fetchDailySummaries(); }}
                      />
                    </div>
                  </ErrorBoundary>
                  {token && (
                    <ErrorBoundary name="Ideas">
                      <Ideas token={token} selectedDate={selectedDate} selectedAccount={selectedAccount || undefined} />
                    </ErrorBoundary>
                  )}
                </>
              )}
            </>
          )}

          {/* ---- SINGLE-VIEW SECTIONS ---- */}
          {token && selectedAccount && view === 'analytics' && (
            <ErrorBoundary name="Analytics"><Analytics token={token} account_id={selectedAccount} isAdmin={isAdmin} onNavigate={go} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'setups' && (
            <ErrorBoundary name="Setup Performance"><Setups token={token} account_id={selectedAccount} from={range.from} to={range.to} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'breakdown' && (
            <ErrorBoundary name="Breakdown"><Breakdown token={token} account_id={selectedAccount} from={range.from} to={range.to} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && view === 'compare' && (
            <ErrorBoundary name="Paper vs Real"><Compare token={token} accounts={accounts} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'discipline' && (
            <ErrorBoundary name="Discipline"><Discipline token={token} account_id={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'report' && (
            <ErrorBoundary name="Report"><Report token={token} account_id={selectedAccount} from={range.from} to={range.to} label={range.label} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {view === 'checklist' && (
            <ErrorBoundary name="Checklist"><Checklist /></ErrorBoundary>
          )}
          {view === 'propfirms' && (
            <ErrorBoundary name="Prop Firms"><PropFirms /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'data' && (
            <ErrorBoundary name="All Trades">
              <DataTable token={token} account_id={selectedAccount} attempt={selectedAttempt}
                accountName={accounts.find(a => a.id === selectedAccount)?.account_name} />
            </ErrorBoundary>
          )}
          {token && selectedAccount && view === 'emotions' && (
            <ErrorBoundary name="Emotions"><Emotions token={token} account_id={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'coach' && (
            <ErrorBoundary name="Coach"><Coach token={token} account_id={selectedAccount} attempt={selectedAttempt} isAdmin={isAdmin} onNavigate={go} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'challenges' && (
            <ErrorBoundary name="Challenges">
              <Challenges
                token={token}
                account_id={selectedAccount}
                accountName={accounts.find(a => a.id === selectedAccount)?.account_name}
                onChanged={() => { fetchAttempts(); fetchDailySummaries(); }}
              />
            </ErrorBoundary>
          )}
          {token && isAdmin && view === 'patterns' && (
            <ErrorBoundary name="Pattern Finder"><PatternFinder token={token} /></ErrorBoundary>
          )}
          {token && isAdmin && view === 's1practice' && (
            <ErrorBoundary name="S1 Practice"><S1Practice token={token} /></ErrorBoundary>
          )}
          {token && isAdmin && view === 'marketchart' && (
            <ErrorBoundary name="Market Chart"><MarketChart token={token} focus={chartFocus} /></ErrorBoundary>
          )}
          {token && view === 'premarket' && (
            <ErrorBoundary name="Pre-Market"><PreMarket token={token} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'charts' && (
            <ErrorBoundary name="Charts"><Charts token={token} account_id={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'risk' && (
            <ErrorBoundary name="Risk Management"><RiskManagement token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'insights' && (
            <ErrorBoundary name="Insights"><Insights token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'backtestlab' && (
            <ErrorBoundary name="Backtest Lab"><BacktestLab token={token} account_id={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'strategy' && (
            <ErrorBoundary name="Strategy Builder"><StrategyBuilder token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'automation' && (
            <ErrorBoundary name="Automation"><Automation token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'advanced' && (
            <ErrorBoundary name="Advanced"><Advanced token={token} user_id={userId || 0} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'social' && (
            <ErrorBoundary name="Social"><Social token={token} user_id={userId || 0} /></ErrorBoundary>
          )}
          </>}
        </div>
      </main>
    </div>
  );
}
