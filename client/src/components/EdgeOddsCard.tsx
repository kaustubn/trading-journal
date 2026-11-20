// Dashboard card: "Is my edge real?" + prop pass odds + costly habits, for the selected account / run.
// Everything is computed from your own trades with the same engines as Backtest Lab and the Coach.
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { FlaskConical } from 'lucide-react';
import { TradeLite, propSim, PropRules } from '../utils/backtestStats';
import { bootstrapMean, tradesNeeded } from '../utils/robustness';
import { tStat, splitByDate } from '../../../shared/edgeCheck';
import { money } from '../utils/format';
import '../styles/EdgeOddsCard.css';

interface Props { token: string; accountId: number; attempt: number | null; onNavigate?: (view: string) => void }
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

export default function EdgeOddsCard({ token, accountId, attempt, onNavigate }: Props) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [rows, setRows] = useState<any[] | null>(null);
  const [prop, setProp] = useState<any>(null);
  const [habits, setHabits] = useState<{ currency?: string; findings: { key: string; title: string; n: number; pnl: number }[] } | null>(null);

  useEffect(() => {
    setRows(null);
    axios.get('/api/trades', { ...auth, params: { account_id: accountId, attempt: attempt || undefined } }).then(r => setRows(r.data?.data || [])).catch(() => setRows([]));
    axios.get(`/api/accounts/${accountId}/prop-status`, { ...auth, params: { attempt: attempt || undefined } }).then(r => setProp(r.data?.data)).catch(() => setProp(null));
    axios.get('/api/coach/findings', { ...auth, params: { account_id: accountId } }).then(r => setHabits(r.data)).catch(() => setHabits(null));
  }, [accountId, attempt, token]);

  const trades = useMemo((): TradeLite[] => (rows || []).filter(r => r.pnl != null && r.entry_time).map(r => {
    const wall = String(r.entry_time).replace(' ', 'T');
    let day = wall.slice(0, 10);
    if (Number(wall.slice(11, 13)) >= 18) day = nextDay(day); // futures day starts 6 pm New York
    return { t: Date.parse(`${wall.slice(0, 19)}Z`), day, pnl: Number(r.pnl) };
  }).sort((a, b) => a.t - b.t), [rows]);

  const pnls = trades.map(t => t.pnl);
  const boot = useMemo(() => bootstrapMean(pnls), [trades]);
  const need = useMemo(() => tradesNeeded(pnls), [trades]);
  const t = useMemo(() => tStat(pnls), [trades]);
  const parts = useMemo(() => splitByDate(trades.map(x => ({ day: x.day, pnl: x.pnl }))), [trades]);
  const sim = useMemo(() => {
    if (!prop?.configured || !prop.maxDrawdown || !prop.target || trades.length < 10) return null;
    const rules: PropRules = {
      start: Number(prop.startingBalance), target: Number(prop.target), maxDrawdown: Number(prop.maxDrawdown),
      trailing: (prop.ddType as PropRules['trailing']) || 'intraday', lockAtStart: !!prop.lockAtStart,
      dailyLoss: prop.dailyLossLimit ?? null, consistencyPct: prop.consistency?.rulePct ?? null, minDays: prop.minDays?.required ?? 0,
    };
    return propSim(trades, rules).summary;
  }, [trades, prop]);

  if (rows === null) return null;
  if (trades.length < 5) return null;
  const sym = habits?.currency === 'INR' ? '₹' : '$';
  const cur = (x: number) => `${x < 0 ? '−' : '+'}${sym}${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const verdict = !boot ? null : boot.lo > 0 ? { k: 'real', text: 'Likely real: the 95% range of your average trade is above zero.' }
    : boot.hi < 0 ? { k: 'losing', text: 'Losing: the 95% range of your average trade is below zero.' }
    : { k: 'unproven', text: 'Not proven yet: the range still includes zero — it could be luck.' };
  const halves = parts.length === 3 ? parts : null;
  const topReason = sim ? Object.entries(sim.reasons).sort((a, b) => b[1] - a[1])[0] : null;
  const costly = (habits?.findings || []).filter(f => f.pnl < 0).slice(0, 2);

  return (
    <section className="eo-card">
      <h3><FlaskConical className="ic-sm" /> Is my edge real? <span className="eo-dim">{trades.length} trades{attempt ? ' in this run' : ''} · after the costs in the journal</span></h3>
      <div className="eo-grid">
        <div className="eo-block">
          <div className={`eo-verdict eo-${verdict?.k}`}>{verdict?.text}</div>
          {boot && <div className="eo-dim">Average trade {cur(boot.mean)} (95% range {cur(boot.lo)} to {cur(boot.hi)}) · chance it is above zero {Math.round(boot.pPositive * 100)}% · t-stat {t == null ? '—' : t.toFixed(2)}</div>}
          {need != null && verdict?.k !== 'real' && <div className="eo-dim">About {need.toLocaleString()} trades would be needed to tell this edge from luck (you have {trades.length}).</div>}
          {halves && <div className="eo-dim">By date: oldest half {cur(halves[0].avg)}/trade · next quarter {cur(halves[1].avg)} · newest quarter {cur(halves[2].avg)}</div>}
        </div>
        <div className="eo-block">
          <div className="eo-label">Prop pass odds</div>
          {!prop?.configured ? <div className="eo-dim">Set the prop rules on this account (card above) to see pass odds.</div>
            : !sim ? <div className="eo-dim">Needs a profit target, a max drawdown and 10+ trades.</div>
            : <>
              <div className="eo-big">{Math.round(sim.passRate * 100)}%</div>
              <div className="eo-dim">of {sim.runs} replays of your trades (starting on each trading day) reached the target first{sim.medianDaysToPass != null ? ` · median ${sim.medianDaysToPass} days` : ''}.{topReason && sim.failRate > 0 ? ` Most common failure: ${topReason[0]}.` : ''} Past trades only, not a forecast.</div>
            </>}
        </div>
        <div className="eo-block">
          <div className="eo-label">Costly habits</div>
          {costly.length === 0 ? <div className="eo-dim">None of the checked habits cost money here.</div> : costly.map(f => (
            <div key={f.key} className="eo-habit"><span>{f.title} ({f.n})</span><b className="eo-neg">{cur(f.pnl)}</b></div>
          ))}
          <div className="eo-links">
            {onNavigate && <button onClick={() => onNavigate('coach')}>All habits</button>}
            {onNavigate && <button onClick={() => onNavigate('compare')}>Paper vs Real</button>}
            {onNavigate && <button onClick={() => onNavigate('backtestlab')}>Full analysis</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
