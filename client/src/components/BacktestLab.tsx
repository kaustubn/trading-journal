import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import axios from 'axios';
import { TradeLite, metrics, dailySeries, propSim, monteCarlo, PropRules, Metrics } from '../utils/backtestStats';
import '../styles/BacktestLab.css';

// Backtest Lab: deep stats, a prop-firm challenge simulator that replays your trades
// from every possible start day, and a Monte Carlo shuffle of the trade order.

interface Props { token: string; account_id: number; attempt: number | null; }
interface Acct {
  id: number; account_name: string; timezone?: string | null;
  prop_starting_balance?: number | null; prop_profit_target?: number | null; prop_max_drawdown?: number | null;
  prop_daily_loss_limit?: number | null; prop_trailing?: boolean | null; prop_consistency_pct?: number | null;
  prop_min_trading_days?: number | null;
}
interface Attempt { id: number; seq: number; label: string | null; trades: number; }
interface Row {
  id: number; symbol: string; entry_time: string; entry_price: number | null; stop_loss: number | null;
  quantity: number | null; pnl: number | null; setup_tag: string | null; session: string | null;
}

const PV: Record<string, number> = { NQ: 20, MNQ: 2, ES: 50, MES: 5 };
const usd = (v: number | null | undefined, sign = false) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}$${s}`;
};
const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const fx = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

/** Journal times are the account's wall clock. Futures days roll at 6pm New York. */
function toLite(r: Row, tz: string | null | undefined, size: number): TradeLite | null {
  if (r.pnl === null || !Number.isFinite(Number(r.pnl)) || !r.entry_time) return null;
  const wall = String(r.entry_time).replace(' ', 'T');
  const nyClock = !tz || tz === 'America/New_York';
  let day = wall.slice(0, 10);
  if (nyClock && Number(wall.slice(11, 13)) >= 18) day = nextDay(day);
  const pv = PV[(r.symbol || '').toUpperCase()];
  const risk = pv && r.entry_price && r.stop_loss && r.quantity ? Math.abs(r.entry_price - r.stop_loss) * pv * r.quantity : 0;
  const pnl = Number(r.pnl) * size;
  return { t: Date.parse(`${wall.slice(0, 19)}Z`), day, pnl, r: risk > 0 ? Number(r.pnl) / risk : null };
}

function rulesFrom(a: Acct | undefined): PropRules {
  const n = (v: any, d: number | null) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    start: n(a?.prop_starting_balance, 50000)!,
    target: n(a?.prop_profit_target, 3000)!,
    maxDrawdown: n(a?.prop_max_drawdown, 2000)!,
    trailing: a?.prop_trailing === false ? 'static' : 'eod',
    lockAtStart: true,
    dailyLoss: n(a?.prop_daily_loss_limit, null),
    consistencyPct: n(a?.prop_consistency_pct, null),
    minDays: n(a?.prop_min_trading_days, 0)!,
  };
}

export default function BacktestLab({ token, account_id, attempt }: Props) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [accts, setAccts] = useState<Acct[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [att, setAtt] = useState<number | null>(attempt);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [setup, setSetup] = useState('');
  const [session, setSession] = useState('');
  const [size, setSize] = useState(1);
  const [rules, setRules] = useState<PropRules | null>(null);
  const [mcRuns, setMcRuns] = useState(1000);

  useEffect(() => { setAtt(attempt); }, [attempt, account_id]);
  useEffect(() => {
    axios.get('/api/accounts', auth).then(r => setAccts(r.data?.data || [])).catch(() => setAccts([]));
  }, [token]);
  useEffect(() => {
    setAttempts([]);
    axios.get(`/api/accounts/${account_id}/attempts`, auth)
      .then(r => setAttempts((r.data?.data || r.data?.attempts || []) as Attempt[])).catch(() => setAttempts([]));
  }, [account_id]);
  useEffect(() => {
    let dead = false;
    setRows(null); setErr('');
    axios.get('/api/trades', { ...auth, params: { account_id, attempt: att || undefined } })
      .then(r => { if (!dead) setRows(r.data?.data || []); })
      .catch(e => { if (!dead) { setRows([]); setErr(e?.response?.data?.error || 'Could not load trades.'); } });
    return () => { dead = true; };
  }, [account_id, att]);

  const acct = accts.find(a => a.id === account_id);
  useEffect(() => { if (acct) setRules(rulesFrom(acct)); }, [acct?.id]);
  const R = rules ?? rulesFrom(acct);

  const setups = useMemo(() => [...new Set((rows || []).map(r => r.setup_tag).filter(Boolean) as string[])].sort(), [rows]);
  const sessions = useMemo(() => [...new Set((rows || []).map(r => r.session).filter(Boolean) as string[])].sort(), [rows]);
  const trades = useMemo(() => (rows || [])
    .filter(r => (!setup || r.setup_tag === setup) && (!session || r.session === session))
    .map(r => toLite(r, acct?.timezone, size)).filter(Boolean) as TradeLite[], [rows, setup, session, size, acct?.timezone]);

  const m = useMemo(() => metrics(trades, R.start), [trades, R.start]);
  const daily = useMemo(() => dailySeries(trades), [trades]);
  const sim = useMemo(() => (trades.length ? propSim(trades, R) : null), [trades, R]);
  const mc = useMemo(() => (trades.length >= 5 ? monteCarlo(trades.map(t => t.pnl), { runs: mcRuns, ruinDrawdown: R.maxDrawdown }) : null), [trades, mcRuns, R.maxDrawdown]);
  const bySetup = useMemo(() => {
    const g = new Map<string, TradeLite[]>();
    (rows || []).filter(r => !session || r.session === session).forEach(r => {
      const t = toLite(r, acct?.timezone, size);
      if (!t) return;
      const k = r.setup_tag || '(no setup)';
      g.set(k, [...(g.get(k) || []), t]);
    });
    return [...g.entries()].map(([k, list]) => ({ k, m: metrics(list) })).sort((a, b) => b.m.net - a.m.net);
  }, [rows, session, size, acct?.timezone]);

  const setRule = (patch: Partial<PropRules>) => setRules({ ...R, ...patch });
  const numIn = (k: keyof PropRules, label: string, nullable = false, step = 100) => (
    <label className="bl-field">{label}
      <input type="number" step={step} min={0} value={(R[k] as number | null) ?? ''} placeholder={nullable ? 'none' : ''}
        onChange={e => {
          const v = e.target.value.trim();
          if (v === '' && nullable) setRule({ [k]: null } as Partial<PropRules>);
          else if (Number.isFinite(Number(v)) && Number(v) >= 0) setRule({ [k]: Number(v) } as Partial<PropRules>);
        }} />
    </label>
  );

  if (rows === null) return <div className="bl"><p className="bl-dim">Loading trades…</p></div>;

  return (
    <div className="bl">
      <div className="bl-head">
        <div>
          <p className="bl-dim">{acct?.account_name ?? 'Account'} · {trades.length} trades · {m.tradingDays} days</p>
        </div>
        <div className="bl-filters">
          <label className="bl-field">Attempt
            <select value={att ?? ''} onChange={e => setAtt(e.target.value ? Number(e.target.value) : null)}>
              <option value="">All attempts</option>
              {attempts.map(a => <option key={a.id} value={a.id}>{a.label || `Attempt ${a.seq}`} ({a.trades})</option>)}
            </select>
          </label>
          <label className="bl-field">Setup
            <select value={setup} onChange={e => setSetup(e.target.value)}>
              <option value="">All setups</option>
              {setups.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="bl-field">Session
            <select value={session} onChange={e => setSession(e.target.value)}>
              <option value="">All sessions</option>
              {sessions.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="bl-field" title="Scale every trade's P&L, e.g. 0.5 = half size, 2 = double size">Size ×
            <select value={size} onChange={e => setSize(Number(e.target.value))}>
              {[0.25, 0.5, 1, 1.5, 2, 3].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
      </div>
      {err && <p className="bl-bad">{err}</p>}
      {!trades.length ? <p className="bl-dim">No trades with P&L for this selection.</p> : (
        <>
          <Tiles m={m} />
          <section className="bl-card">
            <h3>Equity curve</h3>
            <LineChart data={daily.map(d => ({ label: d.day, y: d.cum, sub: `${usd(d.pnl, true)} on the day · ${d.trades} trade${d.trades === 1 ? '' : 's'}` }))}
              tone="equity" fmt={v => usd(v, true)} />
            <h3>Drawdown from peak</h3>
            <LineChart data={daily.map(d => ({ label: d.day, y: -d.dd, sub: `peak ${usd(d.peak, true)}` }))} tone="dd" fmt={v => usd(v)} height={110} />
          </section>

          <section className="bl-card">
            <h3>Prop-firm challenge simulator</h3>
            <p className="bl-dim">Replays these trades as a challenge starting on every trading day in the data, using the rules below
              (pre-filled from the account's prop settings; change them to test another firm). Not a guarantee — past trades only.</p>
            <div className="bl-rules">
              {numIn('start', 'Start balance', false, 1000)}
              {numIn('target', 'Profit target')}
              {numIn('maxDrawdown', 'Max drawdown')}
              <label className="bl-field">Drawdown type
                <select value={R.trailing} onChange={e => setRule({ trailing: e.target.value as PropRules['trailing'] })}>
                  <option value="eod">Trailing (end of day)</option>
                  <option value="intraday">Trailing (intraday*)</option>
                  <option value="static">Static</option>
                </select>
              </label>
              {numIn('dailyLoss', 'Daily loss limit', true)}
              {numIn('consistencyPct', 'Consistency %', true, 5)}
              {numIn('minDays', 'Min days', false, 1)}
              <label className="bl-check"><input type="checkbox" checked={R.lockAtStart} onChange={e => setRule({ lockAtStart: e.target.checked })} />
                Trailing stops at start balance</label>
            </div>
            {R.trailing === 'intraday' && <p className="bl-dim">*Intraday trailing uses each trade's closing P&L (open-trade peaks are not in the journal), so it is a little kinder than the firm.</p>}
            {sim && <SimResult sim={sim} />}
          </section>

          <section className="bl-card">
            <h3>Monte Carlo — reshuffled trade order</h3>
            <p className="bl-dim">Same trades, random order, {mcRuns.toLocaleString()} times. Shows how bad the drawdown and losing streaks
              can get by luck of the order alone.</p>
            <div className="bl-filters">
              <label className="bl-field">Runs
                <select value={mcRuns} onChange={e => setMcRuns(Number(e.target.value))}>
                  {[500, 1000, 5000].map(x => <option key={x} value={x}>{x.toLocaleString()}</option>)}
                </select>
              </label>
            </div>
            {mc ? (
              <>
                <div className="bl-tiles">
                  <Tile label="Max drawdown (median)" v={usd(mc.maxDrawdown.p50)} />
                  <Tile label="Max drawdown (bad 5%)" v={usd(mc.maxDrawdown.p95)} bad />
                  <Tile label={`Hit $${R.maxDrawdown.toLocaleString()} drawdown`} v={pct(mc.ruinProb, 1)} bad={(mc.ruinProb ?? 0) > 0.2}
                    hint="Share of shuffles whose peak-to-trough drawdown reached the challenge's max drawdown" />
                  <Tile label="Losing streak (median / bad 5%)" v={`${mc.longestLossStreak.p50} / ${mc.longestLossStreak.p95}`} />
                </div>
                <FanChart curves={mc.sampleCurves} fmt={v => usd(v, true)} />
              </>
            ) : <p className="bl-dim">Needs at least 5 trades.</p>}
          </section>

          <section className="bl-card">
            <h3>By setup</h3>
            <table className="bl-table">
              <thead><tr><th>Setup</th><th>Trades</th><th>Win %</th><th>Net</th><th>Profit factor</th><th>Expectancy</th><th>Avg R</th></tr></thead>
              <tbody>
                {bySetup.map(({ k, m: x }) => (
                  <tr key={k}>
                    <td>{k}</td><td>{x.count}</td><td>{pct(x.winRate)}</td>
                    <td className={x.net >= 0 ? 'bl-up' : 'bl-down'}>{usd(x.net, true)}</td>
                    <td>{fx(x.profitFactor)}</td><td>{usd(x.expectancy, true)}</td><td>{fx(x.expectancyR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, v, bad, good, hint }: { label: string; v: string; bad?: boolean; good?: boolean; hint?: string }) {
  return (
    <div className="bl-tile" title={hint}>
      <div className="bl-tile-label">{label}</div>
      <div className={`bl-tile-v${bad ? ' bl-down' : good ? ' bl-up' : ''}`}>{v}</div>
    </div>
  );
}

function Tiles({ m }: { m: Metrics }) {
  return (
    <div className="bl-tiles">
      <Tile label="Net P&L" v={usd(m.net, true)} good={m.net > 0} bad={m.net < 0} />
      <Tile label="Win rate" v={`${pct(m.winRate)} (${m.wins}W / ${m.losses}L)`} />
      <Tile label="Profit factor" v={fx(m.profitFactor)} good={(m.profitFactor ?? 0) >= 1.5} bad={m.profitFactor !== null && m.profitFactor < 1} />
      <Tile label="Expectancy / trade" v={`${usd(m.expectancy, true)}${m.expectancyR !== null ? ` · ${fx(m.expectancyR)}R` : ''}`} />
      <Tile label="Avg win / avg loss" v={`${usd(m.avgWin)} / ${usd(m.avgLoss)}`} hint={`Payoff ratio ${fx(m.payoff)}`} />
      <Tile label="Max drawdown" v={`${usd(m.maxDrawdown)}${m.maxDrawdownPct !== null ? ` (${pct(m.maxDrawdownPct, 1)})` : ''}`} bad={m.maxDrawdown > 0}
        hint={`Longest time under water: ${m.maxDrawdownDays} trading days`} />
      <Tile label="Recovery factor" v={fx(m.recoveryFactor)} hint="Net profit ÷ max drawdown" />
      <Tile label="Sharpe / Sortino (daily, yearly)" v={`${fx(m.sharpe)} / ${fx(m.sortino)}`} />
      <Tile label="Green days" v={`${pct(m.greenDayRate)} (${m.greenDays}/${m.tradingDays})`} />
      <Tile label="Best / worst day" v={`${usd(m.bestDay?.pnl, true)} / ${usd(m.worstDay?.pnl, true)}`}
        hint={`${m.bestDay?.day ?? ''} / ${m.worstDay?.day ?? ''}`} />
      <Tile label="Streaks (win / loss)" v={`${m.longestWinStreak} / ${m.longestLossStreak}`} />
      <Tile label="Trades per day" v={fx(m.avgTradesPerDay, 1)} />
    </div>
  );
}

function SimResult({ sim }: { sim: ReturnType<typeof propSim> }) {
  const s = sim.summary;
  const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
  const w = (n: number) => `${s.runs ? (n / s.runs) * 100 : 0}%`;
  return (
    <div className="bl-sim">
      <div className="bl-tiles">
        <Tile label="Pass rate" v={pct(s.passRate)} good={s.passRate >= 0.5} bad={s.passRate < 0.3} />
        <Tile label="Fail rate" v={pct(s.failRate)} bad={s.failRate > 0} />
        <Tile label="Still open (ran out of data)" v={String(s.open)} />
        <Tile label="Days to pass (median / avg)" v={`${fx(s.medianDaysToPass, 0)} / ${fx(s.avgDaysToPass, 1)}`} />
        <Tile label="Starts tested" v={String(s.runs)} />
      </div>
      <div className="bl-bar" role="img" aria-label={`${s.pass} passed, ${s.fail} failed, ${s.open} still open`}>
        {s.pass > 0 && <div className="bl-bar-pass" style={{ width: w(s.pass) }} title={`Passed: ${s.pass}`}><Check className="ic-sm" /> {s.pass}</div>}
        {s.fail > 0 && <div className="bl-bar-fail" style={{ width: w(s.fail) }} title={`Failed: ${s.fail}`}><X className="ic-sm" /> {s.fail}</div>}
        {s.open > 0 && <div className="bl-bar-open" style={{ width: w(s.open) }} title={`Still open: ${s.open}`}>… {s.open}</div>}
      </div>
      <table className="bl-table">
        <thead><tr><th>Why it ended</th><th>Starts</th><th>Share</th></tr></thead>
        <tbody>{reasons.map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td><td>{pct(n / s.runs)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// ---------- tiny SVG charts (one series, one axis, hover crosshair) ----------
interface Pt { label: string; y: number; sub?: string; }
const W = 900;

function niceTicks(lo: number, hi: number, n = 4) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function LineChart({ data, tone, fmt, height = 200 }: { data: Pt[]; tone: 'equity' | 'dd'; fmt: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!data.length) return null;
  const H = height, L = 64, Rm = 12, T = 10, B = 22;
  const ys = data.map(d => d.y);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
  const ticks = niceTicks(lo, hi);
  const y0 = Math.min(lo, ticks[0]), y1 = Math.max(hi, ticks[ticks.length - 1]);
  const X = (i: number) => L + (data.length === 1 ? (W - L - Rm) / 2 : (i * (W - L - Rm)) / (data.length - 1));
  const Y = (v: number) => T + ((y1 - v) / (y1 - y0 || 1)) * (H - T - B);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.y).toFixed(1)}`).join('');
  const area = `${path}L${X(data.length - 1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((x - L) / (W - L - Rm)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover !== null ? data[hover] : null;
  const xLabels = [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="bl-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => setHover(null)}
        role="img" aria-label={tone === 'equity' ? 'Cumulative P&L by day' : 'Drawdown from the running peak by day'}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - Rm} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'bl-axis0' : 'bl-grid'} />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end" className="bl-tick">{fmt(t)}</text>
          </g>
        ))}
        {xLabels.map(i => <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="bl-tick">{data[i].label}</text>)}
        <path d={area} className={`bl-area bl-${tone}`} />
        <path d={path} className={`bl-line bl-${tone}`} vectorEffect="non-scaling-stroke" />
        {h && hover !== null && (
          <>
            <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} className="bl-cross" vectorEffect="non-scaling-stroke" />
            <circle cx={X(hover)} cy={Y(h.y)} r={4} className={`bl-dot bl-${tone}`} />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <div className="bl-tip" style={{ left: `${(X(hover) / W) * 100}%` }}>
          <b>{h.label}</b><div>{fmt(h.y)}</div>{h.sub && <div className="bl-dim">{h.sub}</div>}
        </div>
      )}
    </div>
  );
}

function FanChart({ curves, fmt }: { curves: number[][]; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const n = Math.max(0, ...curves.map(c => c.length));
  if (!n) return null;
  const H = 220, L = 64, Rm = 12, T = 10, B = 22;
  const all = curves.flat();
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const ticks = niceTicks(lo, hi);
  const y0 = Math.min(lo, ticks[0]), y1 = Math.max(hi, ticks[ticks.length - 1]);
  const X = (i: number, len: number) => L + (len <= 1 ? 0 : (i * (W - L - Rm)) / (len - 1));
  const Y = (v: number) => T + ((y1 - v) / (y1 - y0 || 1)) * (H - T - B);
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((x - L) / (W - L - Rm)) * (n - 1)))));
  };
  const at = hover !== null ? curves.map(c => c[Math.min(c.length - 1, Math.round((hover * (c.length - 1)) / Math.max(1, n - 1)))]).sort((a, b) => a - b) : null;
  return (
    <div className="bl-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => setHover(null)}
        role="img" aria-label={`${curves.length} reshuffled equity curves`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - Rm} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'bl-axis0' : 'bl-grid'} />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end" className="bl-tick">{fmt(t)}</text>
          </g>
        ))}
        <text x={L} y={H - 6} className="bl-tick">first trade</text>
        <text x={W - Rm} y={H - 6} textAnchor="end" className="bl-tick">last trade</text>
        {curves.map((c, k) => (
          <path key={k} className="bl-fan" vectorEffect="non-scaling-stroke"
            d={c.map((v, i) => `${i ? 'L' : 'M'}${X(i, c.length).toFixed(1)},${Y(v).toFixed(1)}`).join('')} />
        ))}
        {hover !== null && <line x1={X(hover, n)} x2={X(hover, n)} y1={T} y2={H - B} className="bl-cross" vectorEffect="non-scaling-stroke" />}
      </svg>
      {at && hover !== null && (
        <div className="bl-tip" style={{ left: `${(X(hover, n) / W) * 100}%` }}>
          <b>{Math.round((hover / Math.max(1, n - 1)) * 100)}% through</b>
          <div>worst {fmt(at[0])}</div><div>median {fmt(at[Math.floor(at.length / 2)])}</div><div>best {fmt(at[at.length - 1])}</div>
        </div>
      )}
      <p className="bl-dim">{curves.length} of the shuffles drawn. Each line is the same trades in a different order.</p>
    </div>
  );
}
