// Market Memory: "remember every candle" views over the NQ 1-minute history (New York session).
//   Average day  : every past day merged minute by minute (typical path, big-move minutes, when HOD / LOD print)
//   Look-alikes  : past days whose candles looked like a chosen moment, what came next, and an honest score
//   Candles      : each candle type by time of day, what follows, vs a shuffled-luck baseline
// Server: src/patterns/marketMemory.ts (GET /api/patterns/memory/*).
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Search, AlertTriangle, CandlestickChart } from 'lucide-react';
import { openReplayDay } from '../utils/chartLink';
import '../styles/BacktestLab.css';
import '../styles/PatternFinder.css';
import { Odds, News, Sessions } from './MarketMemoryMore';
import { RangePicker, DateRange, rangeParams, rangePresets, Explain } from './MemoryKit';
import '../styles/MemoryKit.css';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);

// ------------------------------------------------------------------ tiny SVG line chart
interface Series { data: (number | null)[]; color: string; width?: number; dash?: string; opacity?: number; x0?: number; }
function LineChart({ series, band, labels, vline, height = 220, unit = '' }: {
  series: Series[]; band?: { lo: number[]; hi: number[]; color: string; x0?: number }; labels: string[]; vline?: number; height?: number; unit?: string;
}) {
  const W = 800, H = height, padL = 46, padR = 8, padT = 8, padB = 22;
  const n = labels.length;
  const all: number[] = [];
  for (const s of series) for (const v of s.data) if (v != null && isFinite(v)) all.push(v);
  if (band) for (const v of [...band.lo, ...band.hi]) if (isFinite(v)) all.push(v);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const X = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (d: (number | null)[], x0 = 0) => {
    let s = '', pen = false;
    d.forEach((v, i) => { if (v == null || !isFinite(v)) { pen = false; return; } s += `${pen ? 'L' : 'M'}${X(i + x0).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    return s;
  };
  const ticks = 5, yt = Array.from({ length: ticks }, (_, i) => lo + ((hi - lo) * i) / (ticks - 1));
  const xt = labels.map((l, i) => ({ l, i })).filter((_, i, a) => i % Math.max(1, Math.round(a.length / 7)) === 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {yt.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth={0.6} />
          <text x={padL - 4} y={Y(v) + 3} fontSize={10} textAnchor="end" fill="var(--text-dim)">{v.toFixed(Math.abs(hi - lo) < 5 ? 2 : 0)}{unit}</text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={Y(0)} y2={Y(0)} stroke="var(--text-dim)" strokeWidth={0.8} />
      {xt.map(({ l, i }) => <text key={i} x={X(i)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-dim)">{l}</text>)}
      {band && (() => {
        const x0 = band.x0 || 0;
        const top = band.hi.map((v, i) => `${i ? 'L' : 'M'}${X(i + x0).toFixed(1)},${Y(v).toFixed(1)}`).join('');
        const bot = band.lo.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => `L${X(i + x0).toFixed(1)},${Y(v).toFixed(1)}`).join('');
        return <path d={`${top}${bot}Z`} fill={band.color} stroke="none" />;
      })()}
      {vline != null && <line x1={X(vline)} x2={X(vline)} y1={padT} y2={H - padB} stroke="var(--text-dim)" strokeDasharray="3 3" />}
      {series.map((s, i) => <path key={i} d={path(s.data, s.x0)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash} opacity={s.opacity ?? 1} />)}
    </svg>
  );
}

function Bars({ values, labels, color }: { values: number[]; labels: string[]; color: string }) {
  const max = Math.max(0.0001, ...values);
  return (
    <div className="mm-bars">
      {values.map((v, i) => (
        <div key={i} className="mm-bar" title={`${labels[i]}: ${pct(v)}`}>
          <i style={{ height: `${(v / max) * 100}%`, background: color }} />
          {i % 4 === 0 && <span>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="pf-seg">{options.map(([v, l]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

// ------------------------------------------------------------------ main
export default function MarketMemory({ token }: { token: string }) {
  const [tab, setTab] = useState<'day' | 'analog' | 'candles' | 'odds' | 'news' | 'sessions'>(() => {
    try { return (localStorage.getItem('mm.tab') as any) || 'day'; } catch { return 'day'; }
  });
  const pick = (t: typeof tab) => { setTab(t); try { localStorage.setItem('mm.tab', t); } catch { /* ignore */ } };
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);
  const [info, setInfo] = useState<{ from: string; to: string; days: number; dates: string[] } | null>(null);
  const [range, setRangeState] = useState<DateRange>(() => {
    try { const r = JSON.parse(localStorage.getItem('mm.range') || 'null'); if (r && typeof r.label === 'string') return r; } catch { /* ignore */ }
    return rangePresets()[0];
  });
  const setRange = (r: DateRange) => { setRangeState(r); try { localStorage.setItem('mm.range', JSON.stringify(r)); } catch { /* ignore */ } };
  useEffect(() => { axios.get('/api/patterns/memory/info', auth).then(r => setInfo(r.data)).catch(() => {}); }, [auth]);
  const TABS: [typeof tab, string, string][] = [
    ['day', 'Average day', 'How a normal day moves and how big it is'],
    ['candles', 'Candles by time', 'Does a candle type at a set time predict the next candles?'],
    ['odds', 'Candle odds', 'How often each candle type forms in a time window'],
    ['news', 'News reaction', 'Every news release: charts, ICT / SMC / price action, all merged'],
    ['sessions', 'Sessions & calendar', 'Which session / weekday / month tends to go up or trend'],
    ['analog', 'Look-alike days', 'Past days that looked like a chosen moment, and what came next'],
  ];
  return (
    <>
      <div className="bl-card">
        <div className="pf-note"><CandlestickChart size={15} style={{ flexShrink: 0 }} /><span><b>Market Memory</b> looks at every NQ 1-minute candle{info ? ` (${info.days} days, ${info.from} → ${info.to})` : ''} and answers one question per tab. Every result is split into <b>older vs newer</b> days: if both agree, it is a habit that repeats; if not, it was luck or a one-time thing.</span></div>
        <div className="pf-tabs" style={{ marginTop: 8 }}>
          {TABS.map(([k, l, h]) => <button key={k} className={tab === k ? 'on' : ''} title={h} onClick={() => pick(k)}>{l}</button>)}
        </div>
        {tab !== 'analog' && <RangePicker value={range} onChange={setRange} note="applies to this tab" />}
      </div>
      {tab === 'day' && <DayMap auth={auth} range={range} />}
      {tab === 'analog' && <Analog auth={auth} info={info} />}
      {tab === 'candles' && <Candles auth={auth} range={range} />}
      {tab === 'odds' && <Odds auth={auth} range={range} />}
      {tab === 'news' && <News auth={auth} range={range} />}
      {tab === 'sessions' && <Sessions auth={auth} range={range} />}
    </>
  );
}

// ------------------------------------------------------------------ 1. average day
function DayMap({ auth, range }: { auth: any; range: DateRange }) {
  const [f, setF] = useState({ wd: -1, gap: 'all', dayType: 'all', unit: 'pts' });
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true); setErr('');
    axios.get('/api/patterns/memory/daymap', { ...auth, params: { ...f, ...rangeParams(range) } })
      .then(x => setR(x.data)).catch(e => { setR(null); setErr(e.response?.data?.error || 'Failed to load'); }).finally(() => setBusy(false));
  }, [auth, f.wd, f.gap, f.dayType, f.unit, range.dateFrom, range.dateTo]);
  const u = f.unit === 'atr' ? ' ×range' : ' pts';
  const rs = r?.repeatScore;
  return (
    <div className="bl-card">
      <Explain id="day" title="Average day" what="Stacks every New York session (9:30–16:00 ET) in your date range on top of each other and shows the typical path from the 9:30 open, how big a day / an hour / a candle usually is, and how up-trend, down-trend and range days differ."
        read={['Blue line = average distance from the 9:30 open, minute by minute. Shaded = where the middle half of days were.', 'Grey dashed (older days) vs orange (newer days): if they look alike, the shape repeats.', '"How big is a day" = average high-to-low of the session, of each time window and of one candle of each timeframe.', 'Up / down / range table = how far those days usually run from the open, how far they go against you first, and when the high / low usually prints.']}
        filters={[['Weekday', 'only Mondays, Tuesdays, …'], ['Open', 'gap up / down = opened 10%+ of a normal day above / below yesterday’s close'], ['Day type', 'up-trend = closed far above the open (move ≥ half the day’s range), down-trend = far below, range = neither. Known only after the close: for study, not to pick a side in the morning.'], ['Points / × avg day range', 'show moves in points or as a share of a normal day (fair across years)']]}
        example="Pick Up-trend + 2025: the table shows how far those days usually ran from the open and how far they went against you first — that is the stop room a good trend day needs." />
      <div className="bl-rules" style={{ gap: 8, flexWrap: 'wrap', display: 'flex' }}>
        <label className="mk-flabel">Weekday</label><Seg value={f.wd} options={[[-1, 'All'], ...WD.map((w, i) => [i, w] as [number, string])]} onChange={v => setF({ ...f, wd: v })} />
        <label className="mk-flabel">Open</label><Seg value={f.gap} options={[['all', 'Any'], ['up', 'Gap up'], ['down', 'Gap down'], ['flat', 'Flat']]} onChange={v => setF({ ...f, gap: v })} />
        <label className="mk-flabel">Day type</label><Seg value={f.dayType} options={[['all', 'Any'], ['up', 'Up-trend'], ['down', 'Down-trend'], ['range', 'Range'], ['trend', 'Any trend']]} onChange={v => setF({ ...f, dayType: v })} />
        <label className="mk-flabel">Units</label><Seg value={f.unit} options={[['pts', 'Points'], ['atr', '× avg day range']]} onChange={v => setF({ ...f, unit: v })} />
      </div>
      {err && <p className="bl-bad">{err}</p>}
      {busy && !r && <p className="bl-dim">Loading 5 years (first time ~5 s)…</p>}
      {r && <>
        <div className="bl-tiles">
          <div className="bl-tile"><div className="bl-tile-label">Days merged</div><div className="bl-tile-v">{r.days.toLocaleString()}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Avg 9:30 → 16:00</div><div className="bl-tile-v">{pts(r.mean[r.mean.length - 1], f.unit === 'atr' ? 2 : 1)}{u}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Closed above the open</div><div className="bl-tile-v">{pct(r.upFrac[r.upFrac.length - 1])}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Repeats? (older vs newer)</div><div className={`bl-tile-v ${rs >= 0.7 ? 'bl-up' : rs < 0.3 ? 'bl-down' : ''}`}>{rs == null || !isFinite(rs) ? '—' : rs.toFixed(2)}</div></div>
        </div>
        <p className={`pf-verdict ${rs >= 0.7 ? 'ok' : 'no'}`}>
          {rs >= 0.7 ? 'The typical path of these days looks the same in older and newer years: it repeats.'
            : rs >= 0.3 ? 'Older and newer years only partly agree: treat the shape as a loose tendency.'
            : 'Older and newer years do not agree: there is no stable "typical day" for this filter.'}
        </p>
        <LineChart labels={r.times} unit={f.unit === 'atr' ? '' : ''} series={[
          { data: r.older, color: '#8a8f98', dash: '4 3', width: 1.3 },
          { data: r.newer, color: '#f7a600', width: 1.3 },
          { data: r.mean, color: 'var(--brand-2)', width: 2.2 },
        ]} band={{ lo: r.p25, hi: r.p75, color: 'rgba(41,98,255,0.10)' }} />
        <p className="bl-dim"><b style={{ color: 'var(--brand-2)' }}>Blue</b> = average move from the 9:30 open ({u.trim()}), shaded = middle half of days.
          <b style={{ color: '#8a8f98' }}> Grey dashed</b> = older half ({r.from} → {r.olderTo}), <b style={{ color: '#f7a600' }}>orange</b> = newer half. When grey and orange look alike, the pattern repeats.</p>
        {r.note && <p className="pf-note"><AlertTriangle size={14} /> {r.note}</p>}
        <div className="mm-two">
          <div><div className="bl-head"><b>When the high of the day prints</b></div><Bars values={r.hodByQuarterHour} labels={r.quarterHours} color="var(--green)" /></div>
          <div><div className="bl-head"><b>When the low of the day prints</b></div><Bars values={r.lodByQuarterHour} labels={r.quarterHours} color="var(--red)" /></div>
        </div>
        <div className="bl-head" style={{ marginTop: 10 }}><b>Minutes with the biggest moves</b> <span className="bl-dim">(× a normal minute)</span></div>
        <div className="mm-chips">{r.bigMinutes.map((b: any) => <span key={b.time}>{b.time} <b>{b.vsAvg.toFixed(1)}×</b></span>)}</div>
        {r.size && <>
          <div className="bl-head" style={{ marginTop: 14 }}><b>How big is a day?</b> <span className="bl-dim">high to low of the New York session, {r.days} days</span></div>
          <div className="bl-tiles">
            <div className="bl-tile"><div className="bl-tile-label">Average day range</div><div className="bl-tile-v">{r.size.avg} pts</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Median day</div><div className="bl-tile-v">{r.size.median} pts</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Quiet day (10%) … wild day (90%)</div><div className="bl-tile-v">{r.size.p10} … {r.size.p90}</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Up legs / down legs (5m)</div><div className="bl-tile-v">{r.legs.up.avgPts} / {r.legs.down.avgPts} pts</div><div className="bl-dim" style={{ fontSize: 11 }}>{r.legs.up.avgMin} / {r.legs.down.avgMin} min each · {r.legs.up.perDay} + {r.legs.down.perDay} a day</div></div>
          </div>
          <div className="mm-two">
            <div>
              <div className="bl-head"><b>By time of day</b></div>
              <table className="pf-grid mm-table"><thead><tr><th style={{ textAlign: 'left' }}>Window (ET)</th><th>Avg high–low</th><th>Avg start→end</th><th>Share of the day</th></tr></thead>
                <tbody>{r.size.windows.map((w: any) => <tr key={w.label}><td style={{ textAlign: 'left' }}>{w.label}</td><td>{w.avgRange} pts</td><td>{w.avgMove} pts</td><td>{pct(w.shareOfDay)}</td></tr>)}</tbody></table>
            </div>
            <div>
              <div className="bl-head"><b>One candle of each timeframe</b></div>
              <table className="pf-grid mm-table"><thead><tr><th>Candle</th><th>Avg high–low</th><th>Avg body</th><th>First hour</th><th>Lunch</th></tr></thead>
                <tbody>{r.size.byTf.map((t: any) => <tr key={t.tf}><td>{t.tf < 60 ? `${t.tf}m` : '1h'}</td><td>{t.avgRange} pts</td><td>{t.avgBody} pts</td><td>{t.firstHour} pts</td><td>{t.lunch} pts</td></tr>)}</tbody></table>
              <p className="bl-dim">Use it for stops: a stop smaller than one normal candle of your timeframe gets hit by noise.</p>
            </div>
          </div>
          <div className="bl-head" style={{ marginTop: 10 }}><b>Up-trend vs down-trend vs range days</b> <span className="bl-dim">same dates / weekday / open filter, all day types</span></div>
          <div className="pf-scroll"><table className="pf-grid mm-table">
            <thead><tr><th style={{ textAlign: 'left' }}>Day type</th><th>Days</th><th>Share</th><th>Avg range</th><th>Avg open→close</th><th>Avg run with the trend</th><th>Avg move against first</th><th>High usually at</th><th>Low usually at</th></tr></thead>
            <tbody>{r.regimes.map((g: any) => (
              <tr key={g.kind}><td style={{ textAlign: 'left' }}><b className={g.kind === 'up' ? 'bl-up' : g.kind === 'down' ? 'bl-down' : ''}>{g.kind === 'up' ? 'Up-trend' : g.kind === 'down' ? 'Down-trend' : 'Range'}</b></td>
                <td>{g.days}</td><td>{pct(g.share)}</td><td>{g.avgRange} pts</td><td>{pts(g.avgMove)} pts</td><td>{g.avgWithRun} pts</td><td>{g.avgAgainst} pts</td><td>{g.medianHigh ?? '—'}</td><td>{g.medianLow ?? '—'}</td></tr>))}</tbody>
          </table></div>
          <p className="bl-dim">Run with the trend = open to the day's high (up days) or low (down days); for range days, the bigger side. Move against first = the other side. {r.legs.rule}</p>
        </>}
        <p className="bl-dim">* Trend / range day is only known after the close. Use it to study what those days look like, not to pick trades in the morning.</p>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ 2. look-alike days
function Analog({ auth, info }: { auth: any; info: { from: string; to: string; dates: string[] } | null }) {
  const [f, setF] = useState({ date: '', time: '10:30', lookback: 60, ahead: 30, k: 40 });
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (info && !f.date) setF(x => ({ ...x, date: info.to })); }, [info]);
  const run = () => {
    setBusy(true); setErr('');
    axios.get('/api/patterns/memory/analog', { ...auth, params: { ...f, tol: 10 } })
      .then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Search failed')).finally(() => setBusy(false));
  };
  const L = r?.params.lookback || 0, A = r?.params.ahead || 0;
  const labels = r ? Array.from({ length: L + A }, (_, i) => (i === L - 1 ? r.params.time : i < L ? `−${L - 1 - i}m` : `+${i - L + 1}m`)) : [];
  const acc = r?.accuracy;
  return (
    <div className="bl-card">
      <div className="bl-rules">
        <label className="bl-field">Day<input type="date" value={f.date} min={info?.dates?.[40]} max={info?.to} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="bl-field">Time (ET)<input value={f.time} onChange={e => setF({ ...f, time: e.target.value })} placeholder="10:30" style={{ width: 70 }} /></label>
        <label className="bl-field">Look back<select value={f.lookback} onChange={e => setF({ ...f, lookback: Number(e.target.value) })}>{[30, 60, 90, 120].map(x => <option key={x} value={x}>{x} min</option>)}</select></label>
        <label className="bl-field">Look ahead<select value={f.ahead} onChange={e => setF({ ...f, ahead: Number(e.target.value) })}>{[15, 30, 60, 120].map(x => <option key={x} value={x}>{x} min</option>)}</select></label>
        <label className="bl-field">How many look-alikes<select value={f.k} onChange={e => setF({ ...f, k: Number(e.target.value) })}>{[20, 40, 80].map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      <button className="pf-run" disabled={busy || !f.date} onClick={run}><Search size={14} /> {busy ? 'Comparing with every past day…' : 'Find look-alike days'}</button>
      {err && <p className="bl-bad">{err}</p>}
      <p className="bl-dim">It takes the candles of the last {f.lookback} minutes before {f.time} ET on {f.date || 'that day'} (1-minute path, 5-minute candle shapes, where price is vs the open and VWAP, how volatile it was, the gap)
        and finds the past days that looked most alike around the same time (±10 min). Only days <b>before</b> the chosen day are used.</p>
      {r && <>
        <div className="bl-tiles">
          <div className="bl-tile"><div className="bl-tile-label">Look-alikes that went up</div><div className={`bl-tile-v ${r.next.up >= 0.6 ? 'bl-up' : r.next.up <= 0.4 ? 'bl-down' : ''}`}>{pct(r.next.up)}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Avg / median next {A} min</div><div className="bl-tile-v">{pts(r.next.mean)} / {pts(r.next.median)} pts</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Range (10%–90%)</div><div className="bl-tile-v">{pts(r.next.p10, 0)} … {pts(r.next.p90, 0)}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">What really happened</div><div className={`bl-tile-v ${r.actual ? (r.actual.end >= 0 ? 'bl-up' : 'bl-down') : ''}`}>{r.actual ? `${pts(r.actual.end)} pts` : 'not yet'}</div></div>
        </div>
        <LineChart labels={labels} vline={L - 1} series={[
          ...r.overlays.map((o: any) => ({ data: o.path, color: '#8a8f98', width: 0.8, opacity: 0.45 })),
          { data: [...r.qWindow, ...(r.actual ? r.actual.path : [])], color: '#f7a600', width: 2 },
          { data: r.fan.p50, color: 'var(--brand-2)', width: 2.2, x0: L },
        ]} band={{ lo: r.fan.p25, hi: r.fan.p75, color: 'rgba(41,98,255,0.13)', x0: L }} />
        <p className="bl-dim"><b style={{ color: '#f7a600' }}>Orange</b> = the chosen day ({r.params.date} {r.params.time}), <b style={{ color: '#8a8f98' }}>grey</b> = the 12 closest look-alikes,
          <b style={{ color: 'var(--brand-2)' }}> blue</b> = what the {r.matches.length} look-alikes did next (middle line + middle half). Points rescaled to this day's volatility (20-day avg range {r.atr} pts). Avg best run +{r.next.avgBestRun}, avg worst run {r.next.avgWorstRun}.</p>
        <div className={`pf-verdict ${/Looks real/.test(acc.verdict) ? 'ok' : 'no'}`}>
          Does this method work at {r.params.time}? {acc.verdict}
        </div>
        <p className="bl-dim">Honest test on {acc.testDays} newer days ({acc.from} → {acc.to}) it had not seen, each compared only with the days before it.
          Rule: {acc.rule}. Result: {acc.trades} trades, win {pct(acc.winRate)}, avg {pts(acc.avgPts, 2)} pts after costs, t = {acc.tStat}. "Always long" at this time: {pts(acc.alwaysLongAvgPts, 2)} pts.
          {' '}Needs t ≥ 3 and to beat "always long" before it means anything.</p>
        <div className="pf-scroll">
          <table className="pf-grid mm-table">
            <thead><tr><th>Day</th><th>Time</th><th>Match</th><th>Next {A} min</th><th>Best</th><th>Worst</th><th></th></tr></thead>
            <tbody>{r.matches.map((m: any) => (
              <tr key={m.date}>
                <td>{m.date} <span className="bl-dim">{WD[m.wd]}</span></td><td>{m.time}</td><td>{m.similarity}%</td>
                <td className={m.next >= 0 ? 'bl-up' : 'bl-down'}>{pts(m.next)}</td><td>{pts(m.best)}</td><td>{pts(m.worst)}</td>
                <td><button className="mm-link" onClick={() => openReplayDay(m.date)}>Chart</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ 3. candles by time
function Candles({ auth, range }: { auth: any; range: DateRange }) {
  const [f, setF] = useState({ tf: 5, next: 3 });
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<{ type: string; time: string } | null>(null);
  useEffect(() => {
    setErr('');
    axios.get('/api/patterns/memory/candles', { ...auth, params: { ...f, ...rangeParams(range) } }).then(x => setR(x.data)).catch(e => { setR(null); setErr(e.response?.data?.error || 'Failed to load'); });
  }, [auth, f.tf, f.next, range.dateFrom, range.dateTo]);
  const scale = useMemo(() => {
    if (!r) return 1;
    const v = r.types.flatMap((t: any) => t.slots.filter((s: any) => s.n >= 60).map((s: any) => Math.abs(s.edge)));
    v.sort((a: number, b: number) => a - b); return Math.max(0.5, v[Math.floor(v.length * 0.9)] || 1);
  }, [r]);
  const cellBg = (e: number) => { const a = Math.min(1, Math.abs(e) / scale); return e >= 0 ? `rgba(8,153,129,${0.08 + 0.55 * a})` : `rgba(242,54,69,${0.08 + 0.55 * a})`; };
  const picked = r && sel ? (() => { const t = r.types.find((x: any) => x.key === sel.type); const s = sel.time === 'all' ? t.all : t.slots.find((x: any) => x.time === sel.time); return { t, s }; })() : null;
  const real = r ? r.repeating > Math.max(2, r.luckRepeating * 2) : false;
  return (
    <div className="bl-card">
      <Explain id="candles" title="Candles by time" what="Finds every candle of a type (doji, hammer, engulfing, big candle…) at each 15-minute slot of the day and checks what the next candles did, compared with a normal candle at that same time."
        read={['Rows = candle types, columns = time of day (ET). The number = how many points better (green) or worse (red) the next candles went than usual.', 'An outlined cell repeats in older AND newer days. Without an outline it is noise.', 'The top line compares how many cells repeat with what random shuffled data gives: if they are about equal, nothing here is real.']}
        filters={[['Candle', 'the timeframe of the candles'], ['Look at the next', 'how many candles after it to measure']]} />
      <div className="bl-rules" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="mk-flabel">Candle</label><Seg value={f.tf} options={[[1, '1m'], [3, '3m'], [5, '5m'], [15, '15m']]} onChange={v => { setSel(null); setF({ ...f, tf: v }); }} />
        <label className="bl-field">Look at the next<select value={f.next} onChange={e => { setSel(null); setF({ ...f, next: Number(e.target.value) }); }}>{[1, 2, 3, 6, 12].map(x => <option key={x} value={x}>{x} candle{x > 1 ? 's' : ''}</option>)}</select></label>
      </div>
      {err && <p className="bl-bad">{err}</p>}
      {r && <>
        <div className={`pf-verdict ${real ? 'ok' : 'no'}`}>
          {r.repeating} of {r.slotsTested} candle-type × time cells repeat in both older and newer years. Shuffled (random) data gives {r.luckRepeating}.
          {' '}{real ? 'More than chance: check the outlined cells.' : 'That is what luck alone produces: no candle type at a set time reliably predicts the next candles here.'}
        </div>
        <p className="bl-dim">{r.rule} Colour = how much better (green) or worse (red) the next {r.next} candle(s) went vs a normal {r.tf}m candle at that time. Click a cell for details.</p>
        <div className="pf-scroll">
          <table className="pf-grid mm-candles">
            <thead><tr><th></th><th>All times</th>{r.types[0].slots.map((s: any) => <th key={s.time}>{s.time}</th>)}</tr></thead>
            <tbody>{r.types.map((t: any) => (
              <tr key={t.key}>
                <td className="pf-slot">{t.name}</td>
                {[{ time: 'all', ...t.all }, ...t.slots].map((s: any) => (
                  <td key={s.time} className={`pf-cell ${s.repeats ? 'pass' : ''} ${sel && sel.type === t.key && sel.time === s.time ? 'sel' : ''}`}
                    style={{ background: s.n >= 30 ? cellBg(s.edge) : 'var(--card)', opacity: s.n >= 30 ? 1 : 0.4 }}
                    title={`${t.name} at ${s.time}: ${s.n} times, next ${r.next}: ${pts(s.avg, 2)} pts (edge ${pts(s.edge, 2)})`}
                    onClick={() => setSel({ type: t.key, time: s.time })}>{s.n >= 30 ? pts(s.edge, 1) : ''}</td>
                ))}
              </tr>))}</tbody>
          </table>
        </div>
        {picked && <div className="mm-detail">
          <b>{picked.t.name}, {sel!.time === 'all' ? 'any time' : `${sel!.time}–${sel!.time.replace(/:(\d\d)$/, (_m: string, mm: string) => `:${String(Number(mm) + 14).padStart(2, '0')}`)} ET`}</b>
          <span>{picked.s.n.toLocaleString()} times</span>
          <span>next {r.next}: up {pct(picked.s.up)}, avg {pts(picked.s.avg, 2)} pts</span>
          <span>vs normal candle: {pts(picked.s.edge, 2)} pts (older years {pts(picked.s.edgeOlder, 2)}, newer {pts(picked.s.edgeNewer, 2)})</span>
          <span className={picked.s.repeats ? 'bl-up' : 'bl-dim'}>{picked.s.repeats ? 'Repeats in both halves' : 'Does not repeat reliably'}</span>
        </div>}
      </>}
      {!r && !err && <p className="bl-dim">Loading…</p>}
    </div>
  );
}
