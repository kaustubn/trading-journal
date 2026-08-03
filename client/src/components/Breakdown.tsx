import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import '../styles/Breakdown.css';

interface Row { key: string; trades: number; wins: number; winRate: number; pnl: number; }
interface BreakdownProps {
  token: string;
  account_id: number;
  from?: string | null;
  to?: string | null;
}

function PnlBars({ rows, showWinRate }: { rows: Row[]; showWinRate?: boolean }) {
  if (!rows || rows.length === 0) return <p className="empty">No data.</p>;
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);
  return (
    <div className="bd-bars">
      {rows.map(r => {
        const pct = (Math.abs(r.pnl) / maxAbs) * 100;
        const pos = r.pnl >= 0;
        return (
          <div key={r.key} className="bd-row">
            <div className="bd-key">{r.key}</div>
            <div className="bd-track">
              <div className={`bd-fill ${pos ? 'pos' : 'neg'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className={`bd-pnl ${pos ? 'positive' : 'negative'}`}>{money(r.pnl, 0)}</div>
            <div className="bd-meta">{r.trades}t · {num(r.winRate).toFixed(0)}%</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Breakdown({ token, account_id, from, to }: BreakdownProps) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await axios.get(`/api/breakdown/${account_id}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      setD(res.data.data);
    } catch { setD(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [account_id, from, to]);

  if (loading) return <div className="breakdown loading">Loading breakdown…</div>;
  if (!d || d.totalTrades === 0) return <div className="breakdown"><p className="empty">No closed trades in this range.</p></div>;

  return (
    <div className="breakdown">
      <div className="bd-section">
        <h2>📦 By Instrument</h2>
        <p className="bd-hint">Which underlyings make or lose you money.</p>
        <PnlBars rows={d.symbols} />
      </div>

      <div className="bd-grid">
        <div className="bd-section">
          <h3>📅 By Day of Week</h3>
          <PnlBars rows={d.dows} />
        </div>
        <div className="bd-section">
          <h3>🕐 By Hour of Day (IST)</h3>
          <PnlBars rows={d.hours} />
        </div>
      </div>
    </div>
  );
}
