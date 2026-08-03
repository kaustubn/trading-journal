import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { money } from '../utils/format';
import './Challenges.css';

interface Attempt {
  id: number;
  seq: number;
  label: string;
  status: 'active' | 'passed' | 'blown';
  note?: string;
  startedAt?: string;
  endedAt?: string;
  firstTrade?: string;
  lastTrade?: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  best: number | null;
  worst: number | null;
  days: number;
  tradesPerDay: number;
  grades: Record<string, number>;
}

interface Props {
  token: string;
  account_id: number;
  accountName?: string;
  onChanged?: () => void;
}

const STATUS_META: Record<string, { label: string; cls: string; icon: string }> = {
  active: { label: 'ACTIVE', cls: 'st-active', icon: '🔵' },
  passed: { label: 'PASSED', cls: 'st-passed', icon: '✅' },
  blown: { label: 'BLOWN', cls: 'st-blown', icon: '💥' },
};

export default function Challenges({ token, account_id, accountName, onChanged }: Props) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [cmpA, setCmpA] = useState<number | null>(null);
  const [cmpB, setCmpB] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`/api/accounts/${account_id}/attempts`);
      const list: Attempt[] = r.data.data || [];
      setAttempts(list);
      // Default compare = last two attempts (usually "the one I passed" vs "the one I blew")
      if (list.length >= 2) {
        setCmpA(prev => prev ?? list[list.length - 2].id);
        setCmpB(prev => prev ?? list[list.length - 1].id);
      } else if (list.length === 1) {
        setCmpA(list[0].id); setCmpB(list[0].id);
      }
    } catch (e) { console.error('Load attempts', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [account_id]);

  const setStatus = async (id: number, status: string) => {
    await axios.put(`/api/attempts/${id}`, { status });
    await load(); onChanged?.();
  };

  const newAttempt = async () => {
    const label = window.prompt('Name this new challenge run (optional):', '');
    await axios.post(`/api/accounts/${account_id}/attempts`, { label: label || undefined });
    await load(); onChanged?.();
  };

  const rename = async (a: Attempt) => {
    const label = window.prompt('Rename attempt:', a.label);
    if (label == null) return;
    await axios.put(`/api/attempts/${a.id}`, { label });
    await load(); onChanged?.();
  };

  const del = async (a: Attempt) => {
    if (!window.confirm(`Delete "${a.label}"? Its ${a.trades} trades will stay in the account but lose their attempt tag.`)) return;
    try { await axios.delete(`/api/attempts/${a.id}`); await load(); onChanged?.(); }
    catch (e: any) { alert(e?.response?.data?.error || 'Could not delete'); }
  };

  if (loading) return <div className="ch-wrap"><div className="ch-loading">Loading challenges…</div></div>;

  const passed = attempts.filter(a => a.status === 'passed').length;
  const blown = attempts.filter(a => a.status === 'blown').length;
  const decided = passed + blown;
  const passRate = decided > 0 ? (passed / decided) * 100 : null;

  const A = attempts.find(a => a.id === cmpA) || null;
  const B = attempts.find(a => a.id === cmpB) || null;

  return (
    <div className="ch-wrap">
      <div className="ch-head">
        <div>
          <h2>Challenges {accountName ? <span className="ch-sub">· {accountName}</span> : null}</h2>
          <p className="ch-tag">Each run is one attempt. Import lands in the newest attempt. Pass it, blow it, or reset for a fresh one — your record stays.</p>
        </div>
        <button className="ch-new" onClick={newAttempt}>+ New Attempt / Reset</button>
      </div>

      {/* Scoreboard */}
      <div className="ch-score">
        <div className="ch-score-card"><div className="ch-score-n">{attempts.length}</div><div className="ch-score-l">Attempts</div></div>
        <div className="ch-score-card"><div className="ch-score-n st-passed-t">{passed}</div><div className="ch-score-l">Passed</div></div>
        <div className="ch-score-card"><div className="ch-score-n st-blown-t">{blown}</div><div className="ch-score-l">Blown</div></div>
        <div className="ch-score-card"><div className="ch-score-n">{passRate != null ? `${passRate.toFixed(0)}%` : '—'}</div><div className="ch-score-l">Pass Rate</div></div>
      </div>

      {/* Attempts table */}
      <div className="ch-tablewrap">
        <table className="ch-table">
          <thead>
            <tr>
              <th>#</th><th>Attempt</th><th>Status</th><th className="r">Net P&L</th>
              <th className="r">Trades</th><th className="r">Win%</th><th className="r">PF</th>
              <th className="r">Days</th><th>When</th><th>Set status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {attempts.map(a => {
              const st = STATUS_META[a.status] || STATUS_META.active;
              return (
                <tr key={a.id} className={a.status === 'blown' ? 'row-blown' : a.status === 'passed' ? 'row-passed' : ''}>
                  <td className="dim">{a.seq}</td>
                  <td className="ch-name" onClick={() => rename(a)} title="Click to rename">{a.label}</td>
                  <td><span className={`ch-badge ${st.cls}`}>{st.icon} {st.label}</span></td>
                  <td className={`r ${a.netPnl >= 0 ? 'pos' : 'neg'}`}>{money(a.netPnl)}</td>
                  <td className="r">{a.trades}</td>
                  <td className="r">{a.trades > 0 ? `${a.winRate.toFixed(0)}%` : '—'}</td>
                  <td className="r">{a.profitFactor != null ? a.profitFactor.toFixed(2) : (a.trades > 0 ? '∞' : '—')}</td>
                  <td className="r">{a.days}</td>
                  <td className="dim ch-when">{a.firstTrade || a.startedAt || '—'}{a.endedAt ? ` → ${a.endedAt}` : ''}</td>
                  <td>
                    <div className="ch-statusbtns">
                      <button className={`sb sb-pass ${a.status === 'passed' ? 'on' : ''}`} onClick={() => setStatus(a.id, 'passed')} title="Mark passed">✅</button>
                      <button className={`sb sb-blow ${a.status === 'blown' ? 'on' : ''}`} onClick={() => setStatus(a.id, 'blown')} title="Mark blown">💥</button>
                      <button className={`sb sb-active ${a.status === 'active' ? 'on' : ''}`} onClick={() => setStatus(a.id, 'active')} title="Mark active/in-progress">🔵</button>
                    </div>
                  </td>
                  <td><button className="ch-del" onClick={() => del(a)} title="Delete attempt">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Compare two attempts */}
      {attempts.length >= 2 && (
        <div className="ch-compare">
          <div className="ch-compare-head">
            <h3>Compare — what went right vs wrong</h3>
            <div className="ch-compare-pick">
              <select value={cmpA ?? ''} onChange={e => setCmpA(Number(e.target.value))}>
                {attempts.map(a => <option key={a.id} value={a.id}>{a.label} ({STATUS_META[a.status]?.label})</option>)}
              </select>
              <span className="vs">vs</span>
              <select value={cmpB ?? ''} onChange={e => setCmpB(Number(e.target.value))}>
                {attempts.map(a => <option key={a.id} value={a.id}>{a.label} ({STATUS_META[a.status]?.label})</option>)}
              </select>
            </div>
          </div>
          {A && B && <CompareGrid a={A} b={B} />}
        </div>
      )}
    </div>
  );
}

// ---- side-by-side metric compare + auto insights ----
function CompareGrid({ a, b }: { a: Attempt; b: Attempt }) {
  type Row = { label: string; av: number | null; bv: number | null; fmt: (n: number) => string; higherBetter: boolean };
  const rows: Row[] = [
    { label: 'Net P&L', av: a.netPnl, bv: b.netPnl, fmt: money, higherBetter: true },
    { label: 'Win rate', av: a.trades ? a.winRate : null, bv: b.trades ? b.winRate : null, fmt: n => `${n.toFixed(0)}%`, higherBetter: true },
    { label: 'Profit factor', av: a.profitFactor, bv: b.profitFactor, fmt: n => n.toFixed(2), higherBetter: true },
    { label: 'Expectancy / trade', av: a.trades ? a.expectancy : null, bv: b.trades ? b.expectancy : null, fmt: money, higherBetter: true },
    { label: 'Avg win', av: a.wins ? a.avgWin : null, bv: b.wins ? b.avgWin : null, fmt: money, higherBetter: true },
    { label: 'Avg loss', av: a.losses ? Math.abs(a.avgLoss) : null, bv: b.losses ? Math.abs(b.avgLoss) : null, fmt: n => money(-n), higherBetter: false },
    { label: 'Trades / day', av: a.days ? a.tradesPerDay : null, bv: b.days ? b.tradesPerDay : null, fmt: n => n.toFixed(1), higherBetter: false },
    { label: 'Total trades', av: a.trades, bv: b.trades, fmt: n => String(Math.round(n)), higherBetter: false },
    { label: 'Best trade', av: a.best, bv: b.best, fmt: money, higherBetter: true },
    { label: 'Worst trade', av: a.worst, bv: b.worst, fmt: money, higherBetter: true },
  ];

  const winner = (r: Row): 'a' | 'b' | null => {
    if (r.av == null || r.bv == null || r.av === r.bv) return null;
    const aBetter = r.higherBetter ? r.av > r.bv : r.av < r.bv;
    return aBetter ? 'a' : 'b';
  };

  // Auto insights: describe B relative to A (A = left, B = right)
  const insights: { txt: string; good: boolean }[] = [];
  const pushDelta = (label: string, av: number | null, bv: number | null, higherBetter: boolean, fmt: (n: number) => string) => {
    if (av == null || bv == null) return;
    if (Math.abs(av - bv) < 1e-9) return;
    const better = higherBetter ? bv > av : bv < av;
    insights.push({ txt: `${label}: ${fmt(av)} → ${fmt(bv)}`, good: better });
  };
  pushDelta('Win rate', a.trades ? a.winRate : null, b.trades ? b.winRate : null, true, n => `${n.toFixed(0)}%`);
  pushDelta('Profit factor', a.profitFactor, b.profitFactor, true, n => n.toFixed(2));
  pushDelta('Trades/day', a.days ? a.tradesPerDay : null, b.days ? b.tradesPerDay : null, false, n => n.toFixed(1));
  pushDelta('Avg loss', a.losses ? a.avgLoss : null, b.losses ? b.avgLoss : null, true, money);
  pushDelta('Expectancy', a.trades ? a.expectancy : null, b.trades ? b.expectancy : null, true, money);
  // Overtrading flag
  if (a.days && b.days && b.tradesPerDay > a.tradesPerDay * 1.3) {
    insights.push({ txt: `⚠ Overtrading: ${b.label} took ${b.tradesPerDay.toFixed(1)}/day vs ${a.tradesPerDay.toFixed(1)}/day`, good: false });
  }

  return (
    <>
      <div className="cmp-grid">
        <div className="cmp-row cmp-header">
          <div className="cmp-metric"></div>
          <div className="cmp-val cmp-a-head">{a.label}</div>
          <div className="cmp-val cmp-b-head">{b.label}</div>
        </div>
        {rows.map(r => {
          const w = winner(r);
          return (
            <div className="cmp-row" key={r.label}>
              <div className="cmp-metric">{r.label}</div>
              <div className={`cmp-val ${w === 'a' ? 'cmp-better' : w === 'b' ? 'cmp-worse' : ''}`}>{r.av != null ? r.fmt(r.av) : '—'}</div>
              <div className={`cmp-val ${w === 'b' ? 'cmp-better' : w === 'a' ? 'cmp-worse' : ''}`}>{r.bv != null ? r.fmt(r.bv) : '—'}</div>
            </div>
          );
        })}
      </div>
      {insights.length > 0 && (
        <div className="cmp-insights">
          <div className="cmp-insights-title">Change from <b>{a.label}</b> → <b>{b.label}</b></div>
          {insights.map((it, i) => (
            <div key={i} className={`cmp-ins ${it.good ? 'ins-good' : 'ins-bad'}`}>{it.good ? '▲' : '▼'} {it.txt}</div>
          ))}
        </div>
      )}
    </>
  );
}
