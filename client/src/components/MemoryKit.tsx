// Shared pieces for Market Memory: date range picker, "what is this" box, small candle charts with
// Price action / ICT / SMC drawings (src/shared/newsConcepts.ts), the event viewer (1m / 3m / 5m around a
// moment, saved as one image), and the panel that shows many news releases merged.
import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Download, HelpCircle, ChevronDown, ChevronUp, CandlestickChart } from 'lucide-react';
import { readEvent, bucket, Bar, Read } from '../../../src/shared/newsConcepts';
import { openReplayDay } from '../utils/chartLink';

const MIN = 60000;
const pct = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : `${Math.round(x * 100)}%`);
const etTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false });
const bcTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'Etc/GMT+7', hour: 'numeric', minute: '2-digit', hour12: false });

// ------------------------------------------------------------------ date range
export interface DateRange { dateFrom: string; dateTo: string; label: string; }
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function rangePresets(): DateRange[] {
  const now = new Date(), y = now.getUTCFullYear();
  const back = (days: number) => iso(new Date(now.getTime() - days * 864e5));
  return [
    { dateFrom: '', dateTo: '', label: 'All data' },
    { dateFrom: back(91), dateTo: '', label: 'Last 3 months' },
    { dateFrom: back(365), dateTo: '', label: 'Last 12 months' },
    ...[0, 1, 2, 3, 4].map(k => ({ dateFrom: `${y - k}-01-01`, dateTo: `${y - k}-12-31`, label: String(y - k) })),
  ];
}
export function RangePicker({ value, onChange, note }: { value: DateRange; onChange: (r: DateRange) => void; note?: string }) {
  const presets = useMemo(rangePresets, []);
  return (
    <div className="mk-range">
      <span className="mk-range-l">Dates</span>
      {presets.map(p => (
        <button key={p.label} className={`mk-chip${value.label === p.label ? ' on' : ''}`} onClick={() => onChange(p)}>{p.label}</button>
      ))}
      <label className="mk-date">From <input type="date" value={value.dateFrom} onChange={e => onChange({ ...value, dateFrom: e.target.value, label: 'Custom' })} /></label>
      <label className="mk-date">To <input type="date" value={value.dateTo} onChange={e => onChange({ ...value, dateTo: e.target.value, label: 'Custom' })} /></label>
      {note && <span className="bl-dim mk-range-note">{note}</span>}
    </div>
  );
}
export const rangeParams = (r: DateRange) => ({ dateFrom: r.dateFrom || undefined, dateTo: r.dateTo || undefined });

// ------------------------------------------------------------------ "what is this" box
export function Explain({ id, title, what, read, filters, example }: { id: string; title: string; what: string; read: string[]; filters?: [string, string][]; example?: string }) {
  const key = `mk.explain.${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== 'closed'; } catch { return true; } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? 'closed' : 'open'); } catch { /* ignore */ } };
  return (
    <div className={`mk-explain${open ? ' open' : ''}`}>
      <button className="mk-explain-h" onClick={toggle}><HelpCircle size={15} /> <b>{title}</b> <span className="bl-dim">{open ? 'hide' : 'what is this? how do I read it?'}</span>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      {open && <div className="mk-explain-b">
        <p><b>What it does:</b> {what}</p>
        <div><b>How to read it:</b><ul>{read.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
        {filters && <div><b>Filters:</b><ul>{filters.map(([f, d]) => <li key={f}><b>{f}</b> — {d}</li>)}</ul></div>}
        {example && <p><b>Example:</b> {example}</p>}
      </div>}
    </div>
  );
}

// ------------------------------------------------------------------ small candle chart (canvas)
export interface Concepts { pa: boolean; ict: boolean; smc: boolean; }
interface MiniProps {
  read: Read; showFrom: number; showTo: number; concepts: Concepts; highlights?: number[]; height?: number;
  canvasRef?: (c: HTMLCanvasElement | null) => void; title: string;
}
export function MiniChart({ read, showFrom, showTo, concepts, highlights, height = 250, canvasRef, title }: MiniProps) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement | null>(null);
  const [w, setW] = useState(700);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr; c.style.width = `${w}px`; c.style.height = `${height}px`;
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, height, read, showFrom, showTo, concepts, highlights ?? [], title, getComputedStyle(box.current!));
  }, [w, height, read, showFrom, showTo, concepts, highlights, title]);
  return <div ref={box} className="mk-mini"><canvas ref={el => { cv.current = el; canvasRef?.(el); }} /></div>;
}

function draw(ctx: CanvasRenderingContext2D, W: number, H: number, rd: Read, from: number, to: number, cc: Concepts, hl: number[], title: string, css: CSSStyleDeclaration) {
  const ink = css.color || '#ddd', bg = css.backgroundColor && css.backgroundColor !== 'rgba(0, 0, 0, 0)' ? css.backgroundColor : '#131722';
  const dark = (() => { const m = bg.match(/\d+/g); return !m || (+m[0] + +m[1] + +m[2]) / 3 < 128; })();
  ctx.fillStyle = dark ? '#131722' : '#ffffff'; ctx.fillRect(0, 0, W, H);
  const cs = rd.candles.filter(x => x[0] >= from && x[0] < to);
  if (!cs.length) { ctx.fillStyle = ink; ctx.fillText('No candles in the data for this time.', 10, 20); return; }
  const tfMs = rd.tf * MIN, padR = 58, padT = 18, volH = Math.round(H * 0.16), axisH = 16;
  const plotW = W - padR - 4, priceH = H - padT - volH - axisH - 6;
  let hi = Math.max(...cs.map(x => x[2])), lo = Math.min(...cs.map(x => x[3]));
  if ((cc.ict || cc.pa) && rd.pre) { hi = Math.max(hi, rd.pre.high); lo = Math.min(lo, rd.pre.low); }
  const pad = (hi - lo) * 0.06 || 1; hi += pad; lo -= pad;
  const n = Math.round((to - from) / tfMs), slot = plotW / Math.max(n, 1), bw = Math.max(1, Math.min(slot * 0.7, 18));
  const X = (t: number) => 4 + ((t - from) / tfMs) * slot + slot / 2;   // centre of the candle that starts at t
  const XL = (t: number) => 4 + ((t - from) / tfMs) * slot;            // left edge
  const Y = (p: number) => padT + ((hi - p) / (hi - lo)) * priceH;
  const grid = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', dim = dark ? '#8a8f98' : '#6a6d78';
  ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textBaseline = 'middle';
  // price grid + labels
  for (let i = 0; i <= 4; i++) {
    const p = lo + ((hi - lo) * i) / 4, y = Y(p);
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(4 + plotW, y); ctx.stroke();
    ctx.fillStyle = dim; ctx.textAlign = 'left'; ctx.fillText(p.toFixed(2), 4 + plotW + 4, y);
  }
  // zones under the candles
  const box = (t0: number, t1: number, a: number, b: number, fill: string, stroke?: string) => {
    const x0 = Math.max(4, XL(t0)), x1 = Math.min(4 + plotW, XL(t1)), y0 = Y(Math.max(a, b)), y1 = Y(Math.min(a, b));
    if (x1 <= x0) return; ctx.fillStyle = fill; ctx.fillRect(x0, y0, x1 - x0, Math.max(1, y1 - y0));
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, Math.max(1, y1 - y0) - 1); }
  };
  if (cc.pa && rd.pre) box(Math.max(from, rd.pre.from), rd.anchor, rd.pre.high, rd.pre.low, dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
  if (cc.ict) for (const z of rd.fvgs) box(z.t - tfMs, (z.filledAt ?? to) + tfMs, z.lo, z.hi, z.dir > 0 ? 'rgba(8,153,129,0.22)' : 'rgba(242,54,69,0.22)');
  if (cc.smc && rd.orderBlock) { const o = rd.orderBlock; box(o.t, o.touchedAt ? o.touchedAt + tfMs : to, o.lo, o.hi, 'rgba(124,92,255,0.18)', 'rgba(124,92,255,0.7)'); }
  // release line
  if (rd.anchor >= from && rd.anchor < to) {
    const x = XL(rd.anchor);
    ctx.strokeStyle = '#f7a600'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, padT - 6); ctx.lineTo(x, H - axisH); ctx.stroke(); ctx.setLineDash([]);
  }
  // volume
  const vmax = Math.max(...cs.map(x => x[5]), 1), vy0 = H - axisH - 2;
  for (const x of cs) {
    const h = (x[5] / vmax) * volH; ctx.fillStyle = x[4] >= x[1] ? 'rgba(8,153,129,0.45)' : 'rgba(242,54,69,0.45)';
    ctx.fillRect(X(x[0]) - bw / 2, vy0 - h, bw, h);
  }
  // candles
  const hlSet = new Set(hl);
  for (const x of cs) {
    const up = x[4] >= x[1], col = up ? '#089981' : '#f23645', cx = X(x[0]);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, Y(x[2])); ctx.lineTo(cx, Y(x[3])); ctx.stroke();
    const yo = Y(x[1]), yc = Y(x[4]);
    ctx.fillStyle = col; ctx.fillRect(cx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    if (hlSet.has(x[0])) { ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2; ctx.strokeRect(cx - bw / 2 - 3, Y(x[2]) - 3, bw + 6, Y(x[3]) - Y(x[2]) + 6); ctx.lineWidth = 1; }
  }
  const label = (txt: string, x: number, y: number, color: string, align: CanvasTextAlign = 'center') => {
    ctx.font = 'bold 10px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(txt, x, y);
    ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
  };
  const hline = (p: number, t0: number, t1: number, color: string, dash: number[], txt?: string) => {
    const y = Y(p), x0 = Math.max(4, XL(t0)), x1 = Math.min(4 + plotW, XL(t1));
    ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
    if (txt) label(txt, x1 - 2, y - 7, color, 'right');
  };
  // ICT: liquidity lines + sweeps + displacement
  if (cc.ict && rd.pre) {
    hline(rd.pre.high, Math.max(from, rd.pre.from), to, '#ff9f43', [5, 4], 'buy-side liquidity');
    hline(rd.pre.low, Math.max(from, rd.pre.from), to, '#ff9f43', [5, 4], 'sell-side liquidity');
    for (const s of rd.sweeps) {
      const x = rd.candles.find(c => c[0] === s.t); if (!x || x[0] < from || x[0] >= to) continue;
      label(s.side === 'buy' ? (s.reversed ? '▼ sweep' : '▲ took BSL') : (s.reversed ? '▲ sweep' : '▼ took SSL'), X(x[0]), s.side === 'buy' ? Y(x[2]) - 9 : Y(x[3]) + 9, '#ff9f43');
    }
    if (rd.displacement) { const x = rd.candles.find(c => c[0] === rd.displacement!.t); if (x && x[0] >= from) { ctx.strokeStyle = '#ffd400'; ctx.setLineDash([2, 2]); ctx.strokeRect(X(x[0]) - bw / 2 - 2, Y(x[2]) - 2, bw + 4, Y(x[3]) - Y(x[2]) + 4); ctx.setLineDash([]); label('displacement', X(x[0]), Y(x[3]) + 18, '#ffd400'); } }
    for (const z of rd.fvgs.slice(0, 4)) if (z.t >= from) label('FVG', XL(z.t), Y(z.hi) - 7, z.dir > 0 ? '#089981' : '#f23645', 'left');
  }
  // SMC: swings + BOS / CHoCH
  if (cc.smc) {
    for (const s of rd.swings) if (s.t >= from && s.t < to) label(s.kind === 'H' ? 'H' : 'L', X(s.t), s.kind === 'H' ? Y(s.price) - 8 : Y(s.price) + 8, dim);
    for (const st of rd.structure) {
      if (st.t < from) continue;
      const col = st.kind === 'CHoCH' ? '#7c5cff' : st.dir > 0 ? '#089981' : '#f23645';
      hline(st.level, Math.max(from, st.from), st.t + tfMs, col, [1, 0]);
      label(st.kind, (Math.max(XL(Math.max(from, st.from)), 4) + XL(st.t + tfMs)) / 2, Y(st.level) + (st.dir > 0 ? -7 : 7), col);
    }
    if (rd.orderBlock && rd.orderBlock.t >= from) label('OB', XL(rd.orderBlock.t) + 2, Y(rd.orderBlock.hi) - 7, '#7c5cff', 'left');
  }
  // price action: breakout + failure + first bar
  if (cc.pa) {
    if (rd.pre) { hline(rd.pre.high, Math.max(from, rd.pre.from), rd.anchor, dim, [2, 3]); hline(rd.pre.low, Math.max(from, rd.pre.from), rd.anchor, dim, [2, 3]); }
    if (rd.breakout && rd.breakout.t < to) {
      const x = rd.candles.find(c => c[0] === rd.breakout!.t);
      if (x) label(rd.breakout.dir > 0 ? 'BO ↑' : 'BO ↓', X(x[0]), rd.breakout.dir > 0 ? Y(x[2]) - 20 : Y(x[3]) + 20, '#2962ff');
      if (rd.breakout.failedAt) { const y = rd.candles.find(c => c[0] === rd.breakout!.failedAt); if (y) label('failed BO', X(y[0]), rd.breakout.dir > 0 ? Y(y[3]) + 20 : Y(y[2]) - 20, '#2962ff'); }
    }
    const f = rd.candles.find(c => c[0] === rd.anchor);
    if (f && rd.firstBar) label(`1st: ${rd.firstBar.kind.split(' (')[0]}`, X(f[0]), padT - 8, '#2962ff', 'left');
  }
  // time axis: minutes from the anchor + New York clock
  ctx.fillStyle = dim; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(plotW / 55))));
  for (let i = 0; i < n; i += every) {
    const t = from + i * tfMs, off = Math.round((t - rd.anchor) / MIN);
    ctx.fillText(off === 0 ? etTime(t) : `${off > 0 ? '+' : ''}${off}`, XL(t), H - 3);
  }
  ctx.textAlign = 'left'; ctx.font = 'bold 12px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = ink; ctx.textBaseline = 'middle';
  ctx.fillText(title, 8, 9);
}

// ------------------------------------------------------------------ one event: 1m / 3m / 5m charts
export function EventCharts({ auth, anchor, title, sub, highlights, defaultBefore = 5, after = 60, onClose, what = 'news' }: {
  auth: any; anchor: number; title: string; sub?: string; highlights?: { tf: number; times: number[] }; defaultBefore?: number; after?: number; onClose?: () => void; what?: 'news' | 'start';
}) {
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState('');
  const [before, setBefore] = useState(defaultBefore);
  const [cc, setCc] = useState<Concepts>(() => { try { return { pa: false, ict: false, smc: false, ...JSON.parse(localStorage.getItem('mk.concepts') || '{}') }; } catch { return { pa: false, ict: false, smc: false }; } });
  const setConcept = (k: keyof Concepts) => setCc(c => { const nx = { ...c, [k]: !c[k] }; try { localStorage.setItem('mk.concepts', JSON.stringify(nx)); } catch { /* ignore */ } return nx; });
  const canv = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    let dead = false; setBars(null); setErr('');
    axios.get('/api/bars', { ...auth, params: { symbol: 'NQ', tf: 1, from: anchor - 30 * MIN, to: anchor + Math.max(60, after + 5) * MIN, limit: 400 } })
      .then(r => { if (!dead) setBars(r.data.bars as Bar[]); })
      .catch(e => { if (!dead) setErr(e.response?.data?.error || 'Could not load the candles.'); });
    return () => { dead = true; };
  }, [anchor, after]); // eslint-disable-line react-hooks/exhaustive-deps
  const reads = useMemo(() => (bars ? [1, 3, 5].map(tf => {
    const rd = readEvent(bars, anchor, tf, what);
    // candles after +60 are kept for the chart (Candle odds windows can be longer than an hour)
    rd.candles = bucket(bars.filter(b => b[0] >= anchor - 30 * MIN), tf, anchor);
    return rd;
  }) : null), [bars, anchor, what]);
  const date = new Date(anchor).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const save = () => {
    const cs = canv.current.filter(Boolean) as HTMLCanvasElement[];
    if (!cs.length) return;
    const dpr = window.devicePixelRatio || 1, W = Math.max(...cs.map(c => c.width)), head = 34 * dpr;
    const out = document.createElement('canvas'); out.width = W; out.height = head + cs.reduce((s, c) => s + c.height + 6 * dpr, 0);
    const x = out.getContext('2d')!; x.fillStyle = '#131722'; x.fillRect(0, 0, out.width, out.height);
    x.fillStyle = '#e6e8ee'; x.font = `bold ${14 * dpr}px -apple-system, "Segoe UI", Roboto, sans-serif`; x.textBaseline = 'middle';
    x.fillText(`NQ · ${title} · ${date} ${etTime(anchor)} ET (${bcTime(anchor)} BC)`, 10 * dpr, head / 2);
    let y = head; for (const c of cs) { x.drawImage(c, 0, y); y += c.height + 6 * dpr; }
    const a = document.createElement('a'); a.href = out.toDataURL('image/png');
    a.download = `NQ_${date}_${etTime(anchor).replace(':', '')}_${title.replace(/[^\w]+/g, '_').slice(0, 40)}.png`; a.click();
  };
  const from = anchor - before * MIN, to = anchor + after * MIN;
  const hl = (tf: number) => (highlights && highlights.tf === tf ? highlights.times : []);
  return (
    <div className="mk-event">
      <div className="mk-event-h">
        <div><b>{title}</b> <span className="bl-dim">{date} · {etTime(anchor)} ET ({bcTime(anchor)} BC){sub ? ` · ${sub}` : ''}</span></div>
        <div className="mk-event-tools">
          <span className="bl-dim">Read it as:</span>
          <button className={`mk-chip${cc.pa ? ' on' : ''}`} onClick={() => setConcept('pa')} title="Al Brooks style: first bar, breakout of the range before, follow-through or failure, trend vs range">Price action</button>
          <button className={`mk-chip${cc.ict ? ' on' : ''}`} onClick={() => setConcept('ict')} title="Liquidity above/below the 30 min before, sweeps (stop runs), fair value gaps, displacement">ICT</button>
          <button className={`mk-chip${cc.smc ? ' on' : ''}`} onClick={() => setConcept('smc')} title="Swing highs/lows, break of structure (BOS), change of character (CHoCH), order block">SMC</button>
          <label className="mk-check"><input type="checkbox" checked={before === 30} onChange={e => setBefore(e.target.checked ? 30 : defaultBefore)} /> 30 min before</label>
          <button className="mk-chip" onClick={save} disabled={!reads}><Download size={13} /> Save image</button>
          <button className="mk-chip" onClick={() => openReplayDay(date)}><CandlestickChart size={13} /> Open in chart</button>
          {onClose && <button className="mk-chip" onClick={onClose}>Close</button>}
        </div>
      </div>
      {err && <p className="bl-bad">{err}</p>}
      {!reads && !err && <p className="bl-dim">Loading candles…</p>}
      {reads && reads.map((rd, i) => (
        <div key={rd.tf} className="mk-event-chart">
          <MiniChart read={rd} showFrom={from} showTo={to} concepts={cc} highlights={hl(rd.tf)} title={`${rd.tf}m candles`} canvasRef={c => { canv.current[i] = c; }} />
          {(cc.pa || cc.ict || cc.smc) && (
            <div className="mk-reads">
              {cc.pa && <div><b>Price action</b><ul>{rd.text.pa.map((t, j) => <li key={j}>{t}</li>)}</ul></div>}
              {cc.ict && <div><b>ICT</b><ul>{rd.text.ict.map((t, j) => <li key={j}>{t}</li>)}</ul></div>}
              {cc.smc && <div><b>SMC</b><ul>{rd.text.smc.map((t, j) => <li key={j}>{t}</li>)}</ul></div>}
            </div>
          )}
        </div>
      ))}
      {reads && <p className="bl-dim">Orange dashed line = the release / start time (09:30-style label = New York time). Numbers under the chart = minutes from it. These read-outs describe what the candles did; they are not tested signals.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ many releases merged
const CONCEPT_NAMES: Record<string, string> = {
  anySweepRev: 'ICT: one side of the 30-min range swept, then reversed (stop run)',
  buySweepRev: 'ICT: buy-side (above) swept, then reversed down',
  sellSweepRev: 'ICT: sell-side (below) swept, then reversed up',
  breakoutFailed: 'Price action: breakout of the pre-news range failed within 30 min',
  displacement5: 'ICT: displacement candle (2× normal) in the first 5 min',
  fvgFirst15: 'ICT: fair value gap formed in the first 15 min',
  fvgFilled: 'ICT: …and that gap was filled within the hour',
  choch60: 'SMC: change of character (direction flip) within the hour',
  trendHour: 'Price action: the hour after was a trend (not a trading range)',
};
export function CombinePanel({ r }: { r: any }) {
  const maxX = Math.max(...r.minutes.map((m: any) => m.xNormal ?? 0), 1);
  return (
    <div className="mk-combine">
      <div className="bl-tiles">
        <div className="bl-tile"><div className="bl-tile-label">Releases merged</div><div className="bl-tile-v">{r.n}</div><div className="bl-dim" style={{ fontSize: 11 }}>{r.from} → {r.to}</div></div>
        <div className="bl-tile"><div className="bl-tile-label">Normal 1-min candle before</div><div className="bl-tile-v">{r.normalRange1m} pts</div></div>
        <div className="bl-tile"><div className="bl-tile-label">Kept going after the first 5 min (to +60)</div><div className="bl-tile-v">{pct(r.firstCandle?.['5m']?.at60)}</div></div>
        <div className="bl-tile"><div className="bl-tile-label">Older vs newer releases</div><div className="bl-tile-v">{pct(r.halves.older.cont60)} / {pct(r.halves.newer.cont60)}</div><div className="bl-dim" style={{ fontSize: 11 }}>same question, split by date</div></div>
      </div>
      <div className="pf-verdict ok"><ul className="mk-say">{r.say.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
      {r.careful.length > 0 && <div className="mk-careful"><b>Be careful:</b>{r.careful.map((w: any) => <span key={w.from}>{w.from >= 0 ? '+' : ''}{w.from}{w.to !== w.from ? ` → ${w.to >= 0 ? '+' : ''}${w.to}` : ''} min · {w.xNormal}× size · {w.volX}× volume</span>)}</div>}
      <div className="bl-head" style={{ marginTop: 10 }}><b>Minute by minute</b> <span className="bl-dim">bar = average candle size vs a normal minute before the news (red = 2×+, orange = 1.4×+) · hover a bar for size, direction and volume</span></div>
      <div className="mk-minutes">
        {r.minutes.map((m: any) => (
          <div key={m.off} className={`mk-min${m.off === 0 ? ' zero' : ''}`} title={`${m.off >= 0 ? '+' : ''}${m.off} min: candle ${m.range} pts (${m.xNormal}× normal), body ${m.absMove} pts, up ${pct(m.up)}, volume ${m.volX}×`}>
            <div className="mk-min-bar" style={{ height: `${Math.max(2, ((m.xNormal ?? 0) / maxX) * 100)}%`, background: (m.xNormal ?? 0) >= 2 ? '#f23645' : (m.xNormal ?? 0) >= 1.4 ? '#f7a600' : '#2962ff' }} />
            {m.off % 5 === 0 && <span>{m.off >= 0 ? '+' : ''}{m.off}</span>}
          </div>
        ))}
      </div>
      <div className="mm-two" style={{ marginTop: 10 }}>
        <div>
          <div className="bl-head"><b>After the first candle closed, did price keep going its way?</b></div>
          <table className="pf-grid mm-table"><thead><tr><th>First candle</th><th>Releases</th><th>+15 min</th><th>+30 min</th><th>+60 min</th></tr></thead>
            <tbody>{Object.entries(r.firstCandle).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{v.n}</td><td>{pct(v.at15)}</td><td>{pct(v.at30)}</td><td>{pct(v.at60)}</td></tr>)}</tbody></table>
          <p className="bl-dim">Measured from the first candle's close, so the first candle's own move does not count. 50% = coin flip. 60%+ = moves tend to continue; 40%− = they tend to reverse.</p>
        </div>
        <div>
          <div className="bl-head"><b>When the hour's high / low / biggest volume printed</b></div>
          <table className="pf-grid mm-table"><thead><tr><th>After the release</th><th>High</th><th>Low</th><th>Volume peak</th></tr></thead>
            <tbody>{r.highAt.map((h: any, i: number) => <tr key={h.label}><td>{h.label}</td><td>{pct(h.share)}</td><td>{pct(r.lowAt[i].share)}</td><td>{pct(r.volumePeakAt[i].share)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="mm-two" style={{ marginTop: 10 }}>
        <div>
          <div className="bl-head"><b>Repeated first 3 one-minute candles</b></div>
          <table className="pf-grid mm-table"><thead><tr><th>Sequence</th><th>Times</th><th>Share</th><th>Next 30 min (in the 1st candle's way)</th></tr></thead>
            <tbody>{r.sequences.map((s: any) => <tr key={s.seq}><td>{s.seq}</td><td>{s.n}</td><td>{pct(s.share)}</td><td className={s.follow30 >= 0 ? 'bl-up' : 'bl-down'}>{s.follow30 >= 0 ? '+' : ''}{s.follow30} pts · kept going {pct(s.kept)}</td></tr>)}</tbody></table>
        </div>
        <div>
          <div className="bl-head"><b>Concepts: how often each happened</b> <span className="bl-dim">(5m candles)</span></div>
          <table className="pf-grid mm-table"><tbody>{Object.entries(r.concepts).filter(([k]) => CONCEPT_NAMES[k]).map(([k, v]: any) => <tr key={k}><td style={{ textAlign: 'left' }}>{CONCEPT_NAMES[k]}</td><td>{pct(v.share)}</td><td className="bl-dim">of {v.n}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="mm-two" style={{ marginTop: 10 }}>
        <div>
          <div className="bl-head"><b>By release time (ET)</b></div>
          <table className="pf-grid mm-table"><thead><tr><th>Time</th><th>Releases</th><th>Avg first 5 min</th><th>Avg hour range</th></tr></thead>
            <tbody>{r.byTime.map((g: any) => <tr key={g.key}><td>{g.key}</td><td>{g.n}</td><td>{g.first5} pts</td><td>{g.range60} pts</td></tr>)}</tbody></table>
        </div>
        <div>
          <div className="bl-head"><b>By release</b></div>
          <table className="pf-grid mm-table"><thead><tr><th style={{ textAlign: 'left' }}>Release</th><th>Times</th><th>Avg first 5 min</th><th>Avg hour range</th></tr></thead>
            <tbody>{r.byTitle.map((g: any) => <tr key={g.key}><td style={{ textAlign: 'left' }}>{g.key}</td><td>{g.n}</td><td>{g.first5} pts</td><td>{g.range60} pts</td></tr>)}</tbody></table>
        </div>
      </div>
      <p className="bl-dim">Points, not % of price: NQ was ~12,000 in 2022 and ~25,000 in 2026, so older moves look smaller. Nothing here is a tested trade signal; a habit counts only if older and newer releases agree.</p>
    </div>
  );
}
