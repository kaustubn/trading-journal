import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
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

export default function Setups({ token, account_id, from, to }: SetupsProps) {
  const [rows, setRows] = useState<SetupRow[]>([]);
  const [groupBy, setGroupBy] = useState<'setup' | 'tag' | 'grade'>('setup');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ groupBy });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await axios.get(`/api/setups/${account_id}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(res.data.data || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [account_id, groupBy, from, to]);

  return (
    <div className="setups">
      <div className="setups-header">
        <h2>📋 Setup Performance</h2>
        <div className="view-toggle">
          <button className={`view-btn ${groupBy === 'setup' ? 'active' : ''}`} onClick={() => setGroupBy('setup')}>By Setup</button>
          <button className={`view-btn ${groupBy === 'grade' ? 'active' : ''}`} onClick={() => setGroupBy('grade')}>By Grade</button>
          <button className={`view-btn ${groupBy === 'tag' ? 'active' : ''}`} onClick={() => setGroupBy('tag')}>By Tag</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : rows.length === 0 ? (
        <p className="empty">No closed trades yet. Tag your trades to see per-setup edge.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{groupBy === 'tag' ? 'Tag' : groupBy === 'grade' ? 'Grade' : 'Setup'}</th>
                <th>Trades</th>
                <th>Win %</th>
                <th>Net P&L</th>
                <th>Profit Factor</th>
                <th>Expectancy</th>
                <th>Avg R</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><span className="setup-name">{r.key}</span></td>
                  <td>{r.trades} <span className="wl">({r.wins}W/{r.losses}L)</span></td>
                  <td>
                    <div className="wr-cell">
                      <div className="wr-bar"><div className="wr-fill" style={{ width: `${r.winRate}%` }} /></div>
                      <span>{num(r.winRate).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className={r.totalPnl >= 0 ? 'positive' : 'negative'}>{money(r.totalPnl, 0)}</td>
                  <td className={r.profitFactor >= 1 ? 'positive' : 'negative'}>{num(r.profitFactor).toFixed(2)}</td>
                  <td className={r.expectancy >= 0 ? 'positive' : 'negative'}>{money(r.expectancy, 0)}/trade</td>
                  <td className={r.avgR !== null ? (r.avgR >= 0 ? 'positive' : 'negative') : ''}>
                    {r.avgR !== null ? `${num(r.avgR).toFixed(2)}R` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="setups-hint">
            💡 Expectancy = avg $ you make per trade of this type. Avg R needs a stop on the trade (edit a trade to add one).
          </div>
        </div>
      )}
    </div>
  );
}
