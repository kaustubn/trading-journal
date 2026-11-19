import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import axios from 'axios';
import { TradeLite, metrics, dailySeries, propSim, monteCarlo, PropRules, Metrics } from '../utils/backtestStats';
import { withSlippage, bootstrapMean, tradesNeeded, walkForward, verdictOf } from '../utils/robustness';
import EdgeDecay from './EdgeDecay';
import { parseBacktestCsv, ParseResult } from '../../../shared/backtestParse';
import { goLiveGate, splitByDate, byYear, bestDayShare, deflatedSharpe } from '../../../shared/edgeCheck';
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
  return {
    t: Date.parse(`${wall.slice(0, 19)}Z`), day, pnl, r: risk > 0 ? Number(r.pnl) / risk : null,
    ppt: pv && r.quantity ? pv * Number(r.quantity) * size : undefined, riskUsd: risk > 0 ? risk * size : undefined,
  };
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
  const [slip, setSlip] = useState(0);   // extra points of cost per round trip (robustness test)
  // Source: the selected journal account, or an uploaded backtest file (TradingView / NinjaTrader / CSV)
  const [source, setSource] = useState<'journal' | 'file'>('journal');
  const [file, setFile] = useState<{ name: string; res: ParseResult } | null>(null);
  const [fileCost, setFileCost] = useState(0);      // $ per contract round trip to subtract (0 = file already has costs)
  const [filePv, setFilePv] = useState(20);         // $ per point per contract (NQ 20, MNQ 2, ES 50, MES 5)
  const [nyRoll, setNyRoll] = useState(true);       // times are New York: trades after 18:00 belong to the next day
  const [variants, setVariants] = useState(1);      // how many versions of the idea were tried (for the deflated Sharpe)
  const readFile = (f: File) => {
    if (f.size > 20 * 1024 * 1024) { alert('That file is over 20 MB.'); return; }
    f.text().then(text => setFile({ name: f.name, res: parseBacktestCsv(text) })).catch(() => alert('Could not read the file.'));
  };

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
  const fileTrades = useMemo((): TradeLite[] => (file?.res.trades || []).map(t => {
    const wall = new Date(t.entry).toISOString();
    let day = wall.slice(0, 10);
    if (nyRoll && Number(wall.slice(11, 13)) >= 18) day = nextDay(day);
    const qty = t.qty ?? 1;
    return { t: t.entry, day, pnl: (t.pnl - fileCost * qty) * size, r: null, ppt: filePv > 0 ? filePv * qty * size : undefined };
  }), [file, fileCost, filePv, nyRoll, size]);
  const trades = useMemo(() => (source === 'file' ? fileTrades : (rows || [])
    .filter(r => (!setup || r.setup_tag === setup) && (!session || r.session === session))
    .map(r => toLite(r, acct?.timezone, size)).filter(Boolean) as TradeLite[]), [source, fileTrades, rows, setup, session, size, acct?.timezone]);

  const m = useMemo(() => metrics(trades, R.start), [trades, R.start]);
  const daily = useMemo(() => dailySeries(trades), [trades]);
  const sim = useMemo(() => (trades.length ? propSim(trades, R) : null), [trades, R]);
  const mc = useMemo(() => (trades.length >= 5 ? monteCarlo(trades.map(t => t.pnl), { runs: mcRuns, ruinDrawdown: R.maxDrawdown }) : null), [trades, mcRuns, R.maxDrawdown]);
  const bySetup = useMemo(() => {
    if (source === 'file') return [{ k: file?.name ?? 'file', m: metrics(fileTrades) }];
    const g = new Map<string, TradeLite[]>();
    (rows || []).filter(r => !session || r.session === session).forEach(r => {
      const t = toLite(r, acct?.timezone, size);
      if (!t) return;
      const k = r.setup_tag || '(no setup)';
      g.set(k, [...(g.get(k) || []), t]);
    });
    return [...g.entries()].map(([k, list]) => ({ k, m: metrics(list) })).sort((a, b) => b.m.net - a.m.net);
  }, [rows, session, size, acct?.timezone, source, file, fileTrades]);

  // ---- robustness: slippage stress, bootstrap ranges, walk-forward ----
  const stressed = useMemo(() => withSlippage(trades, slip), [trades, slip]);
  const sm = useMemo(() => metrics(stressed), [stressed]);
  const bootUsd = useMemo(() => bootstrapMean(stressed.map(t => t.pnl)), [stressed]);
  const rVals = useMemo(() => stressed.map(t => t.r).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)), [stressed]);
  const bootR = useMemo(() => (rVals.length >= 5 ? bootstrapMean(rVals) : null), [rVals]);
  const need = useMemo(() => tradesNeeded(stressed.map(t => t.pnl)), [stressed]);
  const wf = useMemo(() => walkForward(stressed, 4), [stressed]);
  const verdict = verdictOf(bootUsd);
  const decayGroups = useMemo(() => {
    if (source === 'file') return [{ k: file?.name ?? 'file', trades: withSlippage(fileTrades, slip) }];
    const g = new Map<string, TradeLite[]>();
    (rows || []).filter(r => !session || r.session === session).forEach(r => {
      const t = toLite(r, acct?.timezone, size);
      if (!t) return;
      const k = r.setup_tag || '(no setup)';
      g.set(k, [...(g.get(k) || []), t]);
    });
    return [...g.entries()].map(([k, list]) => ({ k, trades: withSlippage(list, slip) }));
  }, [rows, session, size, slip, acct?.timezone, source, file, fileTrades]);
  // ---- overfitting / go-live check (after the slippage stress) ----
  const ecTrades = useMemo(() => stressed.map(t => ({ day: t.day, pnl: t.pnl })), [stressed]);
  const gate = useMemo(() => (ecTrades.length ? goLiveGate(ecTrades, { variants, maxDrawdownLimit: R.maxDrawdown }) : null), [ecTrades, variants, R.maxDrawdown]);
  const parts = useMemo(() => splitByDate(ecTrades), [ecTrades]);
  const years = useMemo(() => byYear(ecTrades), [ecTrades]);
  const bestShare = useMemo(() => bestDayShare(ecTrades), [ecTrades]);
  const dsr = useMemo(() => deflatedSharpe(ecTrades.map(t => t.pnl), variants), [ecTrades, variants]);
  const noPpt = trades.length > 0 && trades.every(t => !t.ppt);

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

  if (rows === null && source === 'journal') return <div className="bl"><p className="bl-dim">Loading trades…</p></div>;

  return (
    <div className="bl">
      <div className="bl-source" role="tablist" aria-label="What to analyse">
        <button role="tab" aria-selected={source === 'journal'} className={source === 'journal' ? 'on' : ''} onClick={() => setSource('journal')}>Journal account</button>
        <button role="tab" aria-selected={source === 'file'} className={source === 'file' ? 'on' : ''} onClick={() => setSource('file')}>Analyze a backtest file</button>
      </div>
      {source === 'file' && (
        <section className="bl-card">
          <h3>Backtest file</h3>
          <p className="bl-dim">TradingView (Strategy Tester → List of trades → Export), NinjaTrader (Strategy Analyzer → Trades → Export) or any CSV
            with a date/time column and a P&L column. Read in your browser only; nothing is saved.</p>
          <div className="bl-rules">
            <label className="bl-field">File <input type="file" accept=".csv,.txt,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); }} /></label>
            <label className="bl-field" title="Subtract this per contract per round trip if the file has no costs. NQ: $3.50 commission + 0.5 pt slippage = $13.50; MNQ: $1 + 0.5 pt = $2.">Costs to subtract ($/contract)
              <input type="number" min={0} step={0.5} value={fileCost} onChange={e => setFileCost(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <div className="bl-field">Presets
              <span className="bl-presets"><button onClick={() => { setFileCost(13.5); setFilePv(20); }}>NQ $13.50</button><button onClick={() => { setFileCost(2); setFilePv(2); }}>MNQ $2</button><button onClick={() => setFileCost(0)}>Already in file</button></span>
            </div>
            <label className="bl-field" title="Used by the slippage stress test">$ per point
              <select value={filePv} onChange={e => setFilePv(Number(e.target.value))}>{([[20, 'NQ 20'], [2, 'MNQ 2'], [50, 'ES 50'], [5, 'MES 5'], [0, 'other']] as [number, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="bl-field bl-check"><input type="checkbox" checked={nyRoll} onChange={e => setNyRoll(e.target.checked)} /> Times are New York (6 pm starts the next day)</label>
          </div>
          {file && (
            <p className={file.res.trades.length ? 'bl-dim' : 'bl-bad'}>
              <b>{file.name}</b>: {file.res.format === 'tradingview' ? 'TradingView' : file.res.format === 'ninjatrader' ? 'NinjaTrader' : 'CSV'} ·
              {' '}{file.res.trades.length} trades{file.res.skipped ? ` · ${file.res.skipped} rows skipped` : ''}
              {file.res.warnings.map((w, i) => <span key={i} className="bl-warn-line"> · {w}</span>)}
            </p>
          )}
        </section>
      )}
      <div className="bl-head">
        <div>
          <p className="bl-dim">{source === 'file' ? (file?.name ?? 'No file yet') : (acct?.account_name ?? 'Account')} · {trades.length} trades · {m.tradingDays} days</p>
        </div>
        <div className="bl-filters">
          {source === 'journal' && <>
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
          </>}
          <label className="bl-field" title="Scale every trade's P&L, e.g. 0.5 = half size, 2 = double size">Size ×
            <select value={size} onChange={e => setSize(Number(e.target.value))}>
              {[0.25, 0.5, 1, 1.5, 2, 3].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
      </div>
      {err && <p className="bl-bad">{err}</p>}
      {!trades.length ? <p className="bl-dim">{source === 'file' ? 'Choose a backtest file above.' : 'No trades with P&L for this selection.'}</p> : (
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
            <h3>Robustness — can you trust these numbers?</h3>
            <p className="bl-dim">Real fills cost more than a backtest assumes, and a good average can be luck. Add slippage, see the range the
              true average could be in (bootstrap, 2,000 resamples), and check the edge in each period of time.</p>
            <div className="bl-filters">
              <label className="bl-field">Extra slippage per trade
                <select value={slip} onChange={e => setSlip(Number(e.target.value))}>
                  {[0, 0.25, 0.5, 1, 2, 3].map(x => <option key={x} value={x}>{x === 0 ? 'none' : `${x} pt round trip`}</option>)}
                </select>
              </label>
            </div>
            {noPpt && slip > 0 && <p className="bl-dim">These trades have no contract size, so slippage could not be added.</p>}
            {stressed.length >= 5 ? (
              <>
                <div className="bl-tiles">
                  <Tile label={slip ? `Net after ${slip} pt slippage` : 'Net'} v={usd(sm.net, true)} bad={sm.net < 0} />
                  <Tile label="Avg per trade (95% range)" v={bootUsd ? `${usd(bootUsd.lo, true)} … ${usd(bootUsd.hi, true)}` : '—'} bad={!!bootUsd && bootUsd.hi < 0}
                    hint="If you could replay this strategy's luck many times, its true average per trade would land in this range 95% of the time" />
                  <Tile label="Avg R (95% range)" v={bootR ? `${fx(bootR.lo)} … ${fx(bootR.hi)}` : '—'} bad={!!bootR && bootR.hi < 0} />
                  <Tile label="Chance the edge is real" v={bootUsd ? pct(bootUsd.pPositive) : '—'} bad={!!bootUsd && bootUsd.pPositive < 0.8}
                    hint="Share of the resamples whose average trade is above zero" />
                </div>
                <p className={`bl-verdict bl-v-${verdict}`}>
                  {verdict === 'holds' && `Edge holds${slip ? ` with ${slip} pt slippage` : ''}: even the low end of the range is positive.`}
                  {verdict === 'losing' && `Losing${slip ? ` with ${slip} pt slippage` : ''}: even the best case of the range is negative.`}
                  {verdict === 'unproven' && `Not proven yet: the range includes zero.${need ? ` With this win/loss pattern you need about ${need.toLocaleString()} trades (you have ${stressed.length}).` : ''}`}
                </p>
                {wf.length > 0 && (
                  <>
                    <h4 className="bl-sub">Walk-forward: the same trades in 4 time periods, oldest first</h4>
                    <table className="bl-table">
                      <thead><tr><th>Period</th><th>Trades</th><th>Win %</th><th>Net</th><th>Avg</th><th>Avg R</th><th>Profit factor</th></tr></thead>
                      <tbody>
                        {wf.map(p => (
                          <tr key={p.from + p.to}>
                            <td>{p.from} → {p.to}</td><td>{p.n}</td><td>{pct(p.win)}</td>
                            <td className={p.net >= 0 ? 'bl-up' : 'bl-down'}>{usd(p.net, true)}</td>
                            <td className={p.avg >= 0 ? 'bl-up' : 'bl-down'}>{usd(p.avg, true)}</td><td>{fx(p.avgR)}</td><td>{fx(p.pf)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="bl-dim">{wf.every(p => p.net > 0) ? 'Positive in every period: a good sign the edge is not one lucky stretch.'
                      : wf.every(p => p.net <= 0) ? 'Negative in every period.'
                      : `Positive in ${wf.filter(p => p.net > 0).length} of 4 periods: the result depends on when you traded it.`}</p>
                  </>
                )}
              </>
            ) : <p className="bl-dim">Needs at least 5 trades.</p>}
          </section>

          {gate && (
            <section className="bl-card">
              <h3>Overfitting & go-live check</h3>
              <p className="bl-dim">Your go-live gate applied to these trades after costs{slip ? ` and ${slip} pt extra slippage` : ''}. The periods are split by
                trading days: the newest 25% is the holdout. If you tried several versions of this idea (settings, filters, stops), say how many —
                the more you tried, the more a good result can be luck.</p>
              <div className="bl-rules">
                <label className="bl-field">Versions tried
                  <input type="number" min={1} step={1} value={variants} onChange={e => setVariants(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                </label>
              </div>
              <div className={`bl-gate bl-v-${gate.verdict.replace(' ', '')}`}>
                <b>{gate.verdict === 'pass' ? 'PASS' : gate.verdict === 'watch' ? 'WATCH' : gate.verdict === 'reject' ? 'REJECT' : 'TOO FEW TRADES'}</b> — {gate.reason}
              </div>
              <table className="bl-table">
                <tbody>
                  {gate.checks.map(c => (
                    <tr key={c.key}>
                      <td>{c.pass === true ? <Check className="ic-sm bl-up" /> : c.pass === false ? <X className="ic-sm bl-down" /> : '—'}</td>
                      <td>{c.label}</td><td className="bl-dim">{c.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4 className="bl-sub">Split by date</h4>
              <table className="bl-table">
                <thead><tr><th>Period</th><th>From</th><th>To</th><th>Trades</th><th>Net</th><th>Avg / trade</th></tr></thead>
                <tbody>{parts.map(p => (
                  <tr key={p.label}><td>{p.label}</td><td>{p.from ?? '—'}</td><td>{p.to ?? '—'}</td><td>{p.n}</td>
                    <td className={p.net >= 0 ? 'bl-up' : 'bl-down'}>{usd(p.net, true)}</td><td className={p.avg >= 0 ? 'bl-up' : 'bl-down'}>{usd(p.avg, true)}</td></tr>
                ))}</tbody>
              </table>
              <h4 className="bl-sub">By year</h4>
              <table className="bl-table">
                <thead><tr><th>Year</th><th>Trades</th><th>Win %</th><th>Net</th><th>Avg / trade</th></tr></thead>
                <tbody>{years.map(y => (
                  <tr key={y.year}><td>{y.year}</td><td>{y.n}</td><td>{pct(y.win)}</td>
                    <td className={y.net >= 0 ? 'bl-up' : 'bl-down'}>{usd(y.net, true)}</td><td className={y.avg >= 0 ? 'bl-up' : 'bl-down'}>{usd(y.avg, true)}</td></tr>
                ))}</tbody>
              </table>
              <p className="bl-dim">
                Deflated Sharpe: {dsr ? `${(dsr.prob * 100).toFixed(0)}% chance the edge is real after ${dsr.variants} version${dsr.variants === 1 ? '' : 's'} (per-trade Sharpe ${dsr.sr.toFixed(3)} vs ${dsr.sr0.toFixed(3)} expected from luck)` : 'needs 10+ trades'}.
                {' '}Best day = {bestShare == null ? '—' : pct(bestShare)} of all profit (prop consistency rules often cap this at 30-50%).
              </p>
            </section>
          )}

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

          <section className="bl-card">
            <h3>Edge over time — is each setup still working?</h3>
            <p className="bl-dim">Rolling average of each setup's last 30 trades (line) with its 95% band (shaded), against the setup's
              all-time average (dotted) and zero. {slip ? `Includes ${slip} pt slippage.` : ''}</p>
            <EdgeDecay groups={decayGroups} window={30} />
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
