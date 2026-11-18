import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import { Printer, Target } from 'lucide-react';
import { buildInsights } from '../utils/coaching';
import '../styles/Report.css';

interface ReportProps {
  token: string;
  account_id: number;
  from?: string | null;
  to?: string | null;
  label?: string;
}

export default function Report({ token, account_id, from, to, label }: ReportProps) {
  const [ov, setOv] = useState<any>(null);
  const [setups, setSetups] = useState<any[]>([]);
  const [bd, setBd] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const H = { headers: { Authorization: `Bearer ${token}` } };
    Promise.all([
      axios.get(`/api/overview/${account_id}?${q}`, H).then(r => r.data.data).catch(() => null),
      axios.get(`/api/setups/${account_id}?groupBy=setup&${q}`, H).then(r => r.data.data).catch(() => []),
      axios.get(`/api/breakdown/${account_id}?${q}`, H).then(r => r.data.data).catch(() => null),
    ]).then(([o, s, b]) => { setOv(o); setSetups(s || []); setBd(b); }).finally(() => setLoading(false));
  }, [account_id, from, to]);

  if (loading) return <div className="report loading">Building report…</div>;
  if (!ov || !ov.hasData) return <div className="report"><p className="empty">No trades in this period. Pick a wider range above (for example <b>All time</b>).</p></div>;

  const topSetups = [...setups].sort((a, b) => b.totalPnl - a.totalPnl).slice(0, 3);
  const symbols = bd?.symbols || [];
  const bestSym = symbols[0];
  const worstSym = symbols[symbols.length - 1];

  // Focus takeaway: the top rule-based insight for this period
  const coach = buildInsights({ overview: ov, setups, breakdown: bd });
  const top = coach.insights[0];
  const focus = top ? top.title + '. ' + top.action : 'Keep taking A-grade setups and journaling every trade.';
  const symCls = (v: any) => (num(v) >= 0 ? 'positive' : 'negative');

  return (
    <div className="report">
      <div className="rep-head">
        <h2>Report · {label || 'Selected period'}</h2>
        <button className="rep-print" onClick={() => window.print()}><Printer className="ic-sm" /> Print / save PDF</button>
      </div>

      <div className="rep-kpis">
        <div className="rep-kpi"><div className="rk-l">Net P&L</div><div className={`rk-v ${num(ov.netAfterCharges) >= 0 ? 'positive' : 'negative'}`}>{money(ov.netAfterCharges, 0)}</div></div>
        <div className="rep-kpi"><div className="rk-l">Trades</div><div className="rk-v">{num(ov.totalTrades).toLocaleString()}</div></div>
        <div className="rep-kpi"><div className="rk-l">Win rate</div><div className="rk-v">{num(ov.winRate).toFixed(0)}%</div></div>
        <div className="rep-kpi"><div className="rk-l">Profit factor</div><div className="rk-v">{num(ov.profitFactor).toFixed(2)}</div></div>
        <div className="rep-kpi"><div className="rk-l">Expectancy</div><div className={`rk-v ${num(ov.expectancy) >= 0 ? 'positive' : 'negative'}`}>{money(ov.expectancy, 0)}</div></div>
      </div>

      <div className="rep-grid">
        <div className="rep-card">
          <h3>Best & worst</h3>
          <div className="rep-row"><span>Best day</span><span className="positive">{money(ov.bestDay?.pnl, 0)} · {ov.bestDay?.date}</span></div>
          <div className="rep-row"><span>Worst day</span><span className="negative">{money(ov.worstDay?.pnl, 0)} · {ov.worstDay?.date}</span></div>
          <div className="rep-row"><span>Largest win</span><span className="positive">{money(ov.largestWin, 0)}</span></div>
          <div className="rep-row"><span>Largest loss</span><span className="negative">{money(ov.largestLoss, 0)}</span></div>
          <div className="rep-row"><span>Max drawdown</span><span className="negative">{money(ov.maxDrawdown, 0)}</span></div>
          {bestSym && <div className="rep-row"><span>{symbols.length > 1 ? 'Best instrument' : 'Instrument'}</span><span className={symCls(bestSym.pnl)}>{bestSym.key} {money(bestSym.pnl, 0)}</span></div>}
          {worstSym && worstSym !== bestSym && <div className="rep-row"><span>Worst instrument</span><span className={symCls(worstSym.pnl)}>{worstSym.key} {money(worstSym.pnl, 0)}</span></div>}
        </div>

        <div className="rep-card">
          <h3>Top setups</h3>
          {topSetups.length === 0 ? <p className="empty">Tag trades with setups to see this.</p> :
            topSetups.map(s => (
              <div key={s.key} className="rep-row">
                <span>{s.key} <span className="rep-sub">({s.trades}t · {num(s.winRate).toFixed(0)}%)</span></span>
                <span className={num(s.totalPnl) >= 0 ? 'positive' : 'negative'}>{money(s.totalPnl, 0)}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="rep-focus">
        <span className="rf-label"><Target className="ic-sm" /> Focus for next period</span>
        <span className="rf-text">{focus}</span>
        {coach.insights.length > 1 && <ul className="rf-more">{coach.insights.slice(1, 3).map(i => <li key={i.id}>{i.title}</li>)}</ul>}
      </div>
    </div>
  );
}
