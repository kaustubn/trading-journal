import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import { SESSIONS, TEST_TYPES, TIMEFRAMES } from './TradeDetail';
import '../styles/Breakdown.css';

interface Row { key: string; trades: number; wins: number; winRate: number; pnl: number; }
interface BreakdownProps {
  token: string;
  account_id: number;
  from?: string | null;
  to?: string | null;
}

function PnlBars({ rows, empty }: { rows: Row[]; empty?: string }) {
  if (!rows || rows.length === 0) return <p className="empty">{empty || 'No data.'}</p>;
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
  const [f, setF] = useState<{ session: string; test_type: string; timeframe: string; tf_align: string }>({
    session: '', test_type: '', timeframe: '', tf_align: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await axios.get(`/api/breakdown/${account_id}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      setD(res.data.data);
    } catch { setD(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [account_id, from, to, f.session, f.test_type, f.timeframe, f.tf_align]);

  const set = (k: keyof typeof f, v: string) => setF(prev => ({ ...prev, [k]: prev[k] === v ? '' : v }));
  const anyFilter = Object.values(f).some(Boolean);
  const s = d?.summary;

  const FilterRow = ({ label, k, opts }: { label: string; k: keyof typeof f; opts: string[] }) => (
    <div className="bd-frow">
      <span className="bd-flabel">{label}</span>
      <div className="bd-fchips">
        {opts.map(o => (
          <button key={o} className={`bd-chip ${f[k] === o ? 'on' : ''}`} onClick={() => set(k, o)}>{o}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="breakdown">
      {/* Filters — narrow every chart below */}
      <div className="bd-filters">
        <div className="bd-filters-head">
          <h3>🔎 Filter</h3>
          {anyFilter && <button className="bd-clear" onClick={() => setF({ session: '', test_type: '', timeframe: '', tf_align: '' })}>Clear all</button>}
        </div>
        <FilterRow label="Session" k="session" opts={SESSIONS} />
        <FilterRow label="Testing type" k="test_type" opts={TEST_TYPES} />
        <FilterRow label="Timeframe" k="timeframe" opts={TIMEFRAMES} />
        <FilterRow label="TF Align" k="tf_align" opts={['1', '2', '3', '4', '5']} />
      </div>

      {loading ? (
        <p className="empty">Loading breakdown…</p>
      ) : !d || d.totalTrades === 0 ? (
        <p className="empty">
          {anyFilter ? 'No trades match these filters.' : 'No closed trades in this range.'}
        </p>
      ) : (
        <>
          {/* Headline for current selection */}
          <div className="bd-summary">
            <div className="bd-sum-item">
              <span className="bd-sum-label">{anyFilter ? 'Filtered' : 'All'} trades</span>
              <span className="bd-sum-val">{s.trades}</span>
            </div>
            <div className="bd-sum-item">
              <span className="bd-sum-label">Net P&L</span>
              <span className={`bd-sum-val ${s.pnl >= 0 ? 'positive' : 'negative'}`}>{money(s.pnl, 0)}</span>
            </div>
            <div className="bd-sum-item">
              <span className="bd-sum-label">Win rate</span>
              <span className="bd-sum-val">{num(s.winRate).toFixed(0)}%</span>
            </div>
          </div>

          <div className="bd-grid">
            <div className="bd-section">
              <h3>🌏 By Session</h3>
              <PnlBars rows={d.sessions} empty="No trades tagged with a session yet — set it in the trade popup." />
            </div>
            <div className="bd-section">
              <h3>🎯 By Testing Type</h3>
              <PnlBars rows={d.testTypes} empty="No trades tagged with a testing type yet." />
            </div>
          </div>

          <div className="bd-grid">
            <div className="bd-section">
              <h3>⏱ By Timeframe</h3>
              <PnlBars rows={d.timeframes} empty="No trades tagged with a timeframe yet." />
            </div>
            <div className="bd-section">
              <h3>🧭 By TF Align</h3>
              <PnlBars rows={d.tfAligns} empty="No trades tagged with TF align yet." />
            </div>
          </div>

          {d.rrs && d.rrs.length > 0 && (
            <div className="bd-section">
              <h3>⚖️ By Planned R:R</h3>
              <PnlBars rows={d.rrs} />
            </div>
          )}

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
              <h3>🕐 By Hour of Day</h3>
              <PnlBars rows={d.hours} />
            </div>
          </div>

          {d.taggedCount === 0 && (
            <p className="bd-hint bd-nudge">
              Tip: open any trade and set <b>Session / Testing type / Timeframe / TF Align</b> — then these
              charts and filters come alive. Use the checkboxes on the trades list to tag many at once.
            </p>
          )}
        </>
      )}
    </div>
  );
}
