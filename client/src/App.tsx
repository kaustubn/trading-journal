import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Calendar from './components/Calendar';
import AccountSelector from './components/AccountSelector';
import AddAccountModal from './components/AddAccountModal';
import TradeList from './components/TradeList';
import Ideas from './components/Ideas';
import Analytics from './components/Analytics';
import Charts from './components/Charts';
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
import AttemptBar, { AttemptLite } from './components/AttemptBar';
import UpgradeWall from './components/UpgradeWall';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

interface Account {
  id: number;
  broker: string;
  account_number: string;
  account_name: string;
  account_type?: string;
  currency?: string;
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
  coach: 'AI Coach', emotions: 'Emotions', challenges: 'Challenges', setups: 'Setup Performance',
  breakdown: 'Breakdown', discipline: 'Discipline', report: 'Report', charts: 'Charts',
  compare: 'Paper vs Real', risk: 'Risk Management', strategy: 'Strategy Builder',
};

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userId, setUserId] = useState<number | null>(null);
  const [plan, setPlan] = useState<'free' | 'pro'>('pro'); // optimistic; corrected from /me
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
  const [range, setRange] = useState<{ from: string | null; to: string | null; label: string }>({ from: null, to: null, label: 'All time' });
  const [overtrading, setOvertrading] = useState<any>(null);
  const [attempts, setAttempts] = useState<AttemptLite[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null); // null = All attempts

  const NAV_SECTIONS = [
    {
      title: 'Journal', items: [
        { key: 'dashboard', label: 'Dashboard', icon: '📅' },
        { key: 'challenges', label: 'Challenges', icon: '🏆' },
        { key: 'premarket', label: 'Pre-Market', icon: '📝' },
      ]
    },
    {
      title: 'Analytics', items: [
        { key: 'coach', label: 'AI Coach', icon: '🧠' },
        { key: 'analytics', label: 'Performance', icon: '📊' },
        { key: 'setups', label: 'Setup Performance', icon: '📋' },
        { key: 'breakdown', label: 'Breakdown', icon: '📦' },
        { key: 'charts', label: 'Charts', icon: '📈' },
        { key: 'compare', label: 'Paper vs Real', icon: '⚖️' },
        { key: 'discipline', label: 'Discipline', icon: '🎯' },
        { key: 'emotions', label: 'Emotions', icon: '🎭' },
        { key: 'report', label: 'Report', icon: '🧾' },
      ]
    },
    {
      title: 'Planning', items: [
        { key: 'checklist', label: 'Checklist', icon: '✅' },
        { key: 'strategy', label: 'Strategy Builder', icon: '⚗️' },
        { key: 'risk', label: 'Risk Management', icon: '🛡️' },
      ]
    },
    {
      title: 'Prop Firms', items: [
        { key: 'propfirms', label: 'Compare & Buy', icon: '🏦' },
      ]
    },
  ];

  // Keep a global axios auth header in sync so every request (incl. TradeDetail) is authenticated
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      verifyToken();
    }
  }, []);

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
        <h1>Trading Journal</h1>
        <div className="header-actions">
          <button onClick={() => setShowImportModal(true)} className="import-btn">Import CSV</button>
          <button onClick={() => setShowAddTradeModal(true)} className="add-trade-btn">+ Add Trade</button>
          <button onClick={handleSync} className="sync-btn">Sync Now</button>
          {isPro
            ? <span className="plan-pill pro">PRO</span>
            : <button className="plan-pill free" onClick={() => setView('coach')}>Free · Upgrade</button>}
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

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

      <main className="main">
        <div className="sidebar">
          <AccountSelector
            accounts={accounts}
            selectedAccount={selectedAccount}
            onSelectAccount={setSelectedAccount}
            onAddClick={() => setShowAddModal(true)}
            onDeleteAccount={handleDeleteAccount}
            onRenameAccount={handleRenameAccount}
          />

          <nav className="nav-menu">
            {NAV_SECTIONS.map(section => (
              <div key={section.title} className="nav-section">
                <div className="nav-section-title">{section.title}</div>
                {section.items.map(item => (
                  <button
                    key={item.key}
                    className={`nav-item ${view === item.key ? 'active' : ''}`}
                    onClick={() => setView(item.key)}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                    {!isPro && PRO_VIEWS.has(item.key) && <span className="nav-lock">🔒</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="content">
          {!selectedAccount && (
            <div className="no-account">
              <h2>No account selected</h2>
              <p>Add or select a trading account to view your journal.</p>
              <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add Account</button>
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
                <ErrorBoundary name="Overview"><Overview token={token} account_id={selectedAccount} from={range.from} to={range.to} attempt={selectedAttempt} /></ErrorBoundary>
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
                        <h2>Trades for {selectedDate}</h2>
                        <button className="blow-btn" onClick={toggleBlown}>
                          {dailySummaries.find(d => d.trade_date === selectedDate)?.blown ? '↺ Unmark blown' : '💥 Mark account blown'}
                        </button>
                      </div>
                      {(() => {
                        const dayCount = dailySummaries.find(d => d.trade_date === selectedDate)?.trade_count || 0;
                        if (overtrading?.threshold && dayCount >= overtrading.threshold) {
                          return (
                            <div className="overtrade-warn">
                              🚨 <strong>Overtrading day</strong> — {dayCount} trades vs your usual ~{overtrading.medianPerDay}/day.
                              High-volume days are your biggest leak. Fewer, A-grade setups.
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
            <ErrorBoundary name="Analytics"><Analytics token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'setups' && (
            <ErrorBoundary name="Setup Performance"><Setups token={token} account_id={selectedAccount} from={range.from} to={range.to} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'breakdown' && (
            <ErrorBoundary name="Breakdown"><Breakdown token={token} account_id={selectedAccount} from={range.from} to={range.to} /></ErrorBoundary>
          )}
          {token && view === 'compare' && (
            <ErrorBoundary name="Paper vs Real"><Compare token={token} accounts={accounts} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'discipline' && (
            <ErrorBoundary name="Discipline"><Discipline token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'report' && (
            <ErrorBoundary name="Report"><Report token={token} account_id={selectedAccount} from={range.from} to={range.to} label={range.label} /></ErrorBoundary>
          )}
          {view === 'checklist' && (
            <ErrorBoundary name="Checklist"><Checklist /></ErrorBoundary>
          )}
          {view === 'propfirms' && (
            <ErrorBoundary name="Prop Firms"><PropFirms /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'emotions' && (
            <ErrorBoundary name="Emotions"><Emotions token={token} account_id={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'coach' && (
            <ErrorBoundary name="AI Coach"><Coach token={token} account_id={selectedAccount} attempt={selectedAttempt} /></ErrorBoundary>
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
          {token && view === 'premarket' && (
            <ErrorBoundary name="Pre-Market"><PreMarket token={token} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'charts' && (
            <ErrorBoundary name="Charts"><Charts token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'risk' && (
            <ErrorBoundary name="Risk Management"><RiskManagement token={token} account_id={selectedAccount} /></ErrorBoundary>
          )}
          {token && selectedAccount && view === 'insights' && (
            <ErrorBoundary name="Insights"><Insights token={token} account_id={selectedAccount} /></ErrorBoundary>
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
