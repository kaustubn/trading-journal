import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import { Layers, Lightbulb } from 'lucide-react';
import { InfoTip, EmptyState } from './ui';
import { RULES } from '../utils/coaching';
import '../styles/Setups.css';

interface SetupRow {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  avgR: number | null;
}

interface SetupsProps {
  token: string;
  account_id: number;
  from?: string | null;
  to?: string | null;
}

/** Plain verdict per row (thresholds match utils/coaching RULES). */
function verdict(r: any): { label: string; cls: string } {
  if (r.key === 'Untagged' || r.key === 'Ungraded') return { label: 'Tag these', cls: 'info' };
  if (num(r.trades) < RULES.SETUP_MIN_TRADES) return { label: 'Too few trades', cls: 'muted' };
  if (num(r.profitFactor) >= RULES.SETUP_EDGE_PF && num(r.expectancy) > 0) return { label: 'Keep', cls: 'good' };
  if (num(r.profitFactor) < RULES.SETUP_LEAK_PF && num(r.totalPnl) < 0) return { label: 'Cut or fix', cls: 'bad' };
  if (num(r.totalPnl) < 0) return { label: 'Losing', cls: 'warn' };
  return { label: 'Thin edge', cls: 'warn' };
}

export default function Setups({ token, account_id, from, to, attempt }: SetupsProps & { attempt?: number | null }) {
  const [rows, setRows] = useState<SetupRow[]>([]);
  const [groupBy, setGroupBy] = useState<'setup' | 'tag' | 'grade'>('setup');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ groupBy });
      if (attempt) params.set('attempt', String(attempt));
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await axios.get(`/api/setups/${account_id}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(res.data.data || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [account_id, groupBy, from, to, attempt]);

  return (
    <div className="setups">
      <div className="setups-header">
        <span className="scope-note">{attempt ? 'The run selected on the Dashboard' : 'All runs in this account'} · uses the dates above</span>
        <div className="view-toggle">
          <button className={`view-btn ${groupBy === 'setup' ? 'active' : ''}`} onClick={() => setGroupBy('setup')}>By Setup</button>
          <button className={`view-btn ${groupBy === 'grade' ? 'active' : ''}`} onClick={() => setGroupBy('grade')}>By Grade</button>
          <button className={`view-btn ${groupBy === 'tag' ? 'active' : ''}`} onClick={() => setGroupBy('tag')}>By Tag</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Layers} title="Nothing to compare yet">Open a trade (Dashboard → click a day, or Trade Log) and pick its setup. Once a setup has about 10 trades, you will see whether it makes or loses money.</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{groupBy === 'tag' ? 'Tag' : groupBy === 'grade' ? 'Grade' : 'Setup'}</th>
                <th>Verdict<InfoTip text="Keep = profit factor 1.3+ and positive expectancy. Thin edge = profitable but under 1.3. Losing = net negative. Cut or fix = profit factor under 0.9 and losing. Needs 10+ trades to judge." align="left" /></th>
                <th className="num">Trades</th>
                <th>Win %<InfoTip term="winRate" /></th>
                <th className="num">Net P&L</th>
                <th className="num">Profit factor<InfoTip term="profitFactor" /></th>
                <th className="num">Expectancy<InfoTip term="setupExpectancy" /></th>
                <th className="num">Avg R<InfoTip term="avgR" align="right" /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><span className="setup-name">{r.key}</span></td>
                  <td>{(() => { const v = verdict(r); return <span className={`verdict v-${v.cls}`}>{v.label}</span>; })()}</td>
                  <td className="num">{r.trades} <span className="wl">({r.wins}W/{r.losses}L)</span></td>
                  <td>
                    <div className="wr-cell">
                      <div className="wr-bar"><div className="wr-fill" style={{ width: `${r.winRate}%` }} /></div>
                      <span>{num(r.winRate).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className={`num ${r.totalPnl >= 0 ? 'positive' : 'negative'}`}>{money(r.totalPnl, 0)}</td>
                  <td className={`num ${r.profitFactor >= 1 ? 'positive' : 'negative'}`}>{num(r.profitFactor).toFixed(2)}</td>
                  <td className={`num ${r.expectancy >= 0 ? 'positive' : 'negative'}`}>{money(r.expectancy, 0)}/trade</td>
                  <td className={`num ${r.avgR !== null ? (r.avgR >= 0 ? 'positive' : 'negative') : ''}`}>
                    {r.avgR !== null ? `${num(r.avgR).toFixed(2)}R` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="setups-hint">
            <Lightbulb className="ic-sm" /> Expectancy = the average you make on one trade of this type. Avg R needs a stop loss saved on the trade (open a trade to add one).
          </div>
        </div>
      )}
    </div>
  );
}
