import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import { useOptions, values } from '../utils/options';
import { Clock, CalendarDays, Package, Filter, Globe, Crosshair, Timer, Layers, Scale } from 'lucide-react';
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
  const opts = useOptions();

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
          <h3><Filter className="ic-sm" /> Filter by how you tagged trades</h3>
          {anyFilter && <button className="bd-clear" onClick={() => setF({ session: '', test_type: '', timeframe: '', tf_align: '' })}>Clear all</button>}
        </div>
        <FilterRow label="Session" k="session" opts={values(opts, 'session')} />
        <FilterRow label="Entry type" k="test_type" opts={values(opts, 'test_type')} />
        <FilterRow label="Timeframe" k="timeframe" opts={values(opts, 'timeframe')} />
        <FilterRow label="TFs agreeing" k="tf_align" opts={['1', '2', '3', '4', '5']} />
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
              <h3><Clock className="ic-sm" /> By hour of day</h3>
              <p className="bd-hint">Hour the trade was entered, in the clock your trades were recorded in.</p>
              <PnlBars rows={d.hours} />
            </div>
            <div className="bd-section">
              <h3><CalendarDays className="ic-sm" /> By day of week</h3>
              <p className="bd-hint">Green bars made money, red bars lost it. Long red bars are the days to trade smaller.</p>
              <PnlBars rows={d.dows} />
            </div>
          </div>

          {(d.symbols || []).length > 1 && (
            <div className="bd-section">
              <h3><Package className="ic-sm" /> By instrument</h3>
              <p className="bd-hint">Which markets make or lose you money.</p>
              <PnlBars rows={d.symbols} />
            </div>
          )}

          <h3 className="bd-group-title">By how you tagged the trade</h3>
          <div className="bd-grid">
            <div className="bd-section">
              <h3><Globe className="ic-sm" /> By session</h3>
              <PnlBars rows={d.sessions} empty="No trades tagged with a session yet — set it in the trade popup." />
            </div>
            <div className="bd-section">
              <h3><Crosshair className="ic-sm" /> By entry type</h3>
              <PnlBars rows={d.testTypes} empty="No trades tagged with an entry type yet." />
            </div>
          </div>

          <div className="bd-grid">
            <div className="bd-section">
              <h3><Timer className="ic-sm" /> By timeframe</h3>
              <PnlBars rows={d.timeframes} empty="No trades tagged with a timeframe yet." />
            </div>
            <div className="bd-section">
              <h3><Layers className="ic-sm" /> By timeframes agreeing</h3>
              <PnlBars rows={d.tfAligns} empty="No trades tagged with timeframes agreeing yet." />
            </div>
          </div>

          {d.rrs && d.rrs.length > 0 && (
            <div className="bd-section">
              <h3><Scale className="ic-sm" /> By planned reward:risk</h3>
              <PnlBars rows={d.rrs} />
            </div>
          )}



          {d.taggedCount === 0 && (
            <p className="bd-hint bd-nudge">
              Tip: open any trade and set <b>Session / Entry type / Timeframe / Timeframes agreeing</b> — then these
              charts and filters come alive. Use the checkboxes on the trades list to tag many at once.
            </p>
          )}
        </>
      )}
    </div>
  );
}
