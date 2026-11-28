import React, { useEffect, useRef, useState } from 'react';
import { OctagonAlert, GripVertical, ChevronDown, ChevronUp, ChevronRight, ArrowLeftToLine, ArrowRightToLine, Dices, Flag, StepForward, StepBack, Play, Pause, CalendarDays } from 'lucide-react';
import { ReplayEngine, OrderInput, Side, ClosedTrade, rOf, OrderType } from '../chart/replay';
import { Contract, fmtPrice, fmtUsd, signed } from '../chart/drawings';
import { Clock, fmtWall, wallToUtc, etMinutes, etOffset } from '../chart/time';
import { useOptions, values } from '../utils/options';
import type { CoachRules } from '../chart/coach';
import type { Verdict } from './CoachPanel';

// replay speed like TradingView (1x = one step a second)
const SPEEDS = [10, 7, 5, 3, 1, 0.5, 0.3, 0.1];
// forward test: market seconds per real second (1 = real time; 60 = a minute every second)
const LIVE_SPEEDS = [1, 2, 5, 10, 20, 30, 60];
const REASON: Record<ClosedTrade['reason'], string> = { target: 'target', stop: 'stop', manual: 'closed', end: 'replay ended' };
// Quick tags after a trade closes: same keys the trade review uses, so they feed the Emotions / Discipline pages
const QUICK_TAGS: [string, string, boolean][] = [
  ['planned', 'Followed plan', false], ['patient', 'Patient', false], ['fomo', 'FOMO', true], ['chased', 'Chased', true],
  ['panic', 'Exited early', true], ['revenge', 'Revenge', true], ['hesitated', 'Hesitated', true], ['moved-stop', 'Moved stop', true],
];
const DAY = 86400000;
/** 9:25 ET on the next trading weekday (or today when it is still before 9:25 and `nextDay` is false). */
export function nextOpen(cursor: number, nextDay: boolean): number {
  const wall = new Date(cursor + etOffset(cursor));
  let d = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  const wd = (x: number) => new Date(x).getUTCDay();
  if (nextDay || etMinutes(cursor) >= 9 * 60 + 25 || wd(d) === 0 || wd(d) === 6) {
    do { d += DAY; } while (wd(d) === 0 || wd(d) === 6);
  }
  return wallToUtc(new Date(d).toISOString().slice(0, 10), '09:25', 'ET');
}

/** P&L, R, win rate and max drawdown of this replay session, plus the equity points. */
function sessionStats(trades: ClosedTrade[]) {
  let eq = 0, peak = 0, dd = 0, rSum = 0;
  const curve = [0];
  for (const t of trades) { eq += t.pnl; rSum += t.r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); curve.push(eq); }
  const wins = trades.filter(t => t.pnl > 0).length;
  return { pnl: eq, rSum, avgR: trades.length ? rSum / trades.length : 0, win: trades.length ? wins / trades.length : 0, dd, curve };
}

function EquityCurve({ curve }: { curve: number[] }) {
  if (curve.length < 2) return null;
  const W = 260, H = 54;
  const lo = Math.min(0, ...curve), hi = Math.max(0, ...curve), span = hi - lo || 1;
  const x = (i: number) => (i / (curve.length - 1)) * W, y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const last = curve[curve.length - 1];
  return (
    <svg className="mc-eq" viewBox={`0 0 ${W} ${H}`} aria-label="Equity curve of this session">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="mc-eq-zero" />
      <polyline points={curve.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className={last >= 0 ? 'mc-eq-up' : 'mc-eq-down'} />
    </svg>
  );
}

interface Account { id: number; account_name: string; }
interface Props {
  engine: ReplayEngine;
  clock: Clock;
  accounts: Account[];
  accountId: number | null;
  onAccount: (id: number) => void;
  onRetry: (t: ClosedTrade) => void;
  onExit: () => void;
  coach: CoachHooks;
  onJump: (t: number) => Promise<void>;                                     // restart replay at time t
  onPick: () => void;                                                       // pick a new start candle on the chart
  onTags: (t: ClosedTrade, tags: string[]) => Promise<string | null>;       // write tags to the saved journal trade
  atr?: { value: number; tf: string } | null;                               // ATR(14) of the active chart, for the stop check
  tfLabel?: string;                                                         // the active chart's timeframe ("5m"): the bar step
  dataRange?: { first: number | null; last: number | null };               // first / last minute with chart data
}
export interface CoachHooks {
  rules: CoachRules;
  check: (o: OrderInput) => string[];                                       // instant rule checks
  review: (o: OrderInput, breaks: string[]) => Promise<{ verdict: Verdict; text: string } | null>; // Claude (null = unavailable)
  note: (from: 'rule' | 'claude' | 'error', text: string, verdict?: Verdict) => void;
}
type Stage =
  | { kind: 'breaks'; o: OrderInput; breaks: string[] }
  | { kind: 'ai'; o: OrderInput; breaks: string[] }
  | { kind: 'verdict'; o: OrderInput; breaks: string[]; verdict: Verdict | null; text: string };

// Order ticket defaults are a per-browser convenience
const DEF_KEY = 'mc.replay.order';
const SIZE_KEY = 'mc.replay.sizing';
interface Sizing { mode: 'fixed' | 'risk'; balance: number; riskPct: number; dailyPct: number; halfAfter: number }
function loadSizing(): Sizing {
  const d: Sizing = { mode: 'fixed', balance: 50000, riskPct: 0.5, dailyPct: 3, halfAfter: 2 };
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
    if (s && typeof s === 'object') {
      if (s.mode === 'fixed' || s.mode === 'risk') d.mode = s.mode;
      for (const k of ['balance', 'riskPct', 'dailyPct', 'halfAfter'] as const) if (Number.isFinite(s[k]) && s[k] >= 0) d[k] = s[k];
    }
  } catch { /* storage unavailable */ }
  return d;
}
/** Losing trades in a row at the end of the session, and the session P&L. */
function sessionState(trades: ClosedTrade[]) {
  let streak = 0;
  for (let i = trades.length - 1; i >= 0 && trades[i].pnl < 0; i--) streak++;
  return { streak, pnl: trades.reduce((s, t) => s + t.pnl, 0) };
}
type Defaults = Omit<OrderInput, 'side' | 'notes'>;
function loadDefaults(): Defaults {
  const d: Defaults = { qty: 1, contract: 'NQ', stopPts: 20, target: 2, targetUnit: 'R', setup: '' };
  try {
    const s = JSON.parse(localStorage.getItem(DEF_KEY) || 'null');
    if (s && typeof s === 'object') {
      if (Number.isInteger(s.qty) && s.qty >= 1 && s.qty <= 100) d.qty = s.qty;
      if (s.contract === 'NQ' || s.contract === 'MNQ') d.contract = s.contract;
      if (Number.isFinite(s.stopPts) && s.stopPts > 0) d.stopPts = s.stopPts;
      if (Number.isFinite(s.target) && s.target > 0) d.target = s.target;
      if (s.targetUnit === 'R' || s.targetUnit === 'pts') d.targetUnit = s.targetUnit;
      if (typeof s.setup === 'string') d.setup = s.setup;
    }
  } catch { /* storage unavailable: use defaults */ }
  return d;
}

const POS_KEY = 'mc.replay.pos';
function loadPos(): { x: number; y: number } {
  try {
    const s = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) return { x: s.x, y: s.y };
  } catch { /* storage unavailable */ }
  return { x: 0, y: 0 };
}

export default function ReplayBar({ engine: e, clock, accounts, accountId, onAccount, onRetry, onExit, coach, onJump, onPick, onTags, atr, tfLabel = 'bar', dataRange }: Props) {
  // ---- drag the bar anywhere over the chart (position kept for next time) ----
  const [pos, setPos] = useState(loadPos);
  const boxRef = useRef<HTMLDivElement>(null);
  // short version: click the grip (play, step, buy / sell and the open position only)
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('mc.replay.mini') === '1'; } catch { return false; } });
  const toggleMini = () => setMini(m => { try { localStorage.setItem('mc.replay.mini', m ? '0' : '1'); } catch { /* ignore */ } return !m; });
  const startDrag = (ev: React.PointerEvent) => {
    const box = boxRef.current, parent = box?.offsetParent as HTMLElement | null;
    if (!box || !parent) return;
    ev.preventDefault();
    const r = box.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    const baseL = r.left - pos.x, baseT = r.top - pos.y;           // where the bar sits with no offset
    const lim = { x0: pr.left - baseL, x1: pr.right - (baseL + r.width), y0: pr.top - baseT, y1: pr.bottom - (baseT + r.height) };
    const sx = ev.clientX - pos.x, sy = ev.clientY - pos.y, x0 = ev.clientX, y0 = ev.clientY;
    let last = pos, moved = false;
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
      moved = true;
      last = { x: Math.min(lim.x1, Math.max(lim.x0, m.clientX - sx)), y: Math.min(lim.y1, Math.max(lim.y0, m.clientY - sy)) };
      setPos(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!moved) { toggleMini(); return; }
      try { localStorage.setItem(POS_KEY, JSON.stringify(last)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const resetPos = () => { setPos({ x: 0, y: 0 }); try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ } };
  // ---- start again from another date / candle ----
  const [menu, setMenu] = useState(false);
  const [pop, setPop] = useState<null | 'speed' | 'interval'>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [jDate, setJDate] = useState('');
  const [jTime, setJTime] = useState('09:25');
  /** 9:25 New York shown in the chart's clock (BC is 2-3 hours behind). */
  const nyInClock = (day: string) => (clock === 'ET' ? '09:25' : fmtWall(wallToUtc(day, '09:25', 'ET'), clock).slice(11, 16));
  const openMenu = () => {
    if (!menu) {
      const day = e.cursor ? fmtWall(e.cursor + 60000, clock).slice(0, 10) : '';
      setJDate(day);
      if (day) setJTime(nyInClock(day));
    }
    setMenu(!menu); setPop(null); setDateOpen(false); setTicket(null); setShowTrades(false); setErr('');
  };
  const goDate = async () => {
    if (e.position || jumping || !/^\d{4}-\d{2}-\d{2}$/.test(jDate) || !/^\d{2}:\d{2}$/.test(jTime)) return;
    setJumping(true);
    const from = e.cursor;
    try {
      const t = wallToUtc(jDate, jTime, clock);
      await onJump(t);
      if (!e.hasBar || Math.abs(e.cursor - t) > 4 * 86400000) {
        if (from) await onJump(from);
        setErr('No chart data at that date (weekend, holiday or outside the data). Try another day.');
        return;
      }
      setErr(''); setMenu(false);
    } finally { setJumping(false); }
  };
  const [sizing, setSizingState] = useState<Sizing>(loadSizing);
  const setSizing = (patch: Partial<Sizing>) => setSizingState(cur => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const [tagFor, setTagFor] = useState<string | null>(null);   // id of the just-closed trade asking for quick tags
  const [tagErr, setTagErr] = useState('');
  const [jumping, setJumping] = useState(false);
  const seenTrades = useRef(e.trades.length);
  useEffect(() => {
    if (e.trades.length > seenTrades.current) { setTagFor(e.trades[e.trades.length - 1].id); setTagErr(''); }
    seenTrades.current = e.trades.length;
  }, [e.trades.length]);
  const jump = async (nextDay: boolean) => {
    if (e.position || jumping) return;
    setJumping(true);
    const from = e.cursor;
    try {
      let t = nextOpen(e.cursor || Date.now(), nextDay);
      // holidays have no 9:25 bar: try the following weekdays
      for (let i = 0; i < 6; i++) {
        await onJump(t);
        if (e.hasBar && e.cursor >= t - 3 * 3600000) { setErr(''); return; }
        if (!e.hasBar) break;                       // past the end of the data
        t = nextOpen(t + 60000, true);
      }
      // no session there (the data ends): go back to where the trader was
      if (from) await onJump(from);
      setErr('No data for the next session yet.');
    } finally { setJumping(false); }
  };
  /** Start at 9:25 New York of the first trading day at or after t (holidays skipped); back to where it was if none. */
  const startAt = async (t0: number) => {
    if (e.position || jumping) return;
    setJumping(true);
    const from = e.cursor;
    try {
      let t = nextOpen(t0 - 1, false);
      if (t < t0 - 6 * 3600000) t = nextOpen(t0, true);
      for (let i = 0; i < 8; i++) {
        await onJump(t);
        if (e.hasBar && e.cursor >= t - 3 * 3600000) { setErr(''); setMenu(false); return; }
        t = nextOpen(t + 60000, true);
      }
      if (from) await onJump(from);
      setErr('No chart data there. Try another start.');
    } finally { setJumping(false); }
  };
  const firstDate = () => { if (dataRange?.first) void startAt(dataRange.first + 2 * 86400000); };   // a couple of days in, so the chart has history
  const randomBar = () => {
    const a = (dataRange?.first ?? 0) + 5 * 86400000, b = (dataRange?.last ?? Date.now()) - 86400000;
    if (!(b > a)) { setErr('Not enough chart data for a random start.'); return; }
    void startAt(a + Math.random() * (b - a));
  };
  const speedLabel = (v: number) => `${v}x`;
  const intervalLabel = e.live ? 'Live' : e.stepMode === '1m' ? '1m' : tfLabel;
  const tagged = e.trades.find(t => t.id === tagFor) ?? null;
  const toggleTag = async (k: string) => {
    if (!tagged) return;
    const cur = tagged.tags ?? [];
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    setTagErr((await onTags(tagged, next)) ?? '');
  };
  const [ticket, setTicket] = useState<Side | null>(null);
  const [form, setForm] = useState(() => ({ ...loadDefaults(), notes: '' }));
  const [err, setErr] = useState('');
  const [showTrades, setShowTrades] = useState(false);
  const [otype, setOtype] = useState<OrderType>('market');
  const [oprice, setOprice] = useState('');
  const [stage, setStageState] = useState<Stage | null>(null);
  const stageSeq = useRef(0);   // a Claude review that comes back after Cancel is ignored
  const setStage = (st: Stage | null) => { stageSeq.current++; setStageState(st); };
  const opts = useOptions();
  const setups = values(opts, 'setup');

  useEffect(() => { if (e.position) { setTicket(null); setStage(null); } }, [e.position]);
  // Hotkeys while replaying / forward testing: B buy, S sell (ticket), A add 1, H close half,
  // E break-even, F flatten. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      const pos = e.position;
      if (!pos && (k === 'b' || k === 's') && e.price !== null) { ev.preventDefault(); openTicket(k === 'b' ? 'long' : 'short'); return; }
      if (!pos) return;
      if (k === 'a') { ev.preventDefault(); setErr(e.scaleIn(1) ?? ''); }
      else if (k === 'h') { ev.preventDefault(); if (pos.qty >= 2) setErr(e.scaleOut(Math.floor(pos.qty / 2)) ?? ''); }
      else if (k === 'e') { ev.preventDefault(); setErr(e.breakEven() ?? ''); }
      else if (k === 'f') { ev.preventDefault(); e.closeAtMarket(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openTicket = (side: Side) => {
    // the chart keeps running while the ticket is open (TradingView-style); pause yourself if you want to think
    setOtype('market'); setOprice('');
    setTicket(ticket === side ? null : side); setStage(null); setShowTrades(false); setErr('');
  };

  const p = e.position;
  const price = e.price;
  const total = e.trades.reduce((s, t) => s + t.pnl, 0);
  const st = sessionStats(e.trades);
  const failed = e.trades.filter(t => t.saved === 'failed');
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  const place = (o: OrderInput, breaks: string[]) => {
    const msg = e.open(o, breaks);
    if (msg) { setErr(msg); setStage(null); return; }
    setErr('');
    setTicket(null);
    setStage(null);
    if (breaks.length) coach.note('rule', `Took it with ${breaks.length} rule break${breaks.length === 1 ? '' : 's'}, logged with the trade (tag "Rule break"):\n• ${breaks.join('\n• ')}`);
    try { const { notes: _n, ...keep } = form; localStorage.setItem(DEF_KEY, JSON.stringify(keep)); } catch { /* ignore */ }
    setForm(f => ({ ...f, notes: '' }));
  };
  const runReview = (o: OrderInput, breaks: string[]) => {
    setStage({ kind: 'ai', o, breaks });
    const seq = stageSeq.current;
    coach.review(o, breaks).then(res => {
      if (seq !== stageSeq.current) return;
      if (res && res.verdict === 'GO') { place(o, breaks); return; }
      setStageState({ kind: 'verdict', o, breaks, verdict: res?.verdict ?? null, text: res?.text ?? 'Claude could not review this one (see the coach panel).' });
    });
  };
  const aiOnTrades = coach.rules.enabled && coach.rules.ai === 'trades';
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!ticket || stage) return;
    const o: OrderInput = { ...form, side: ticket, qty: qtyNow };
    if (sizing.mode === 'risk' && qtyNow < 1) { setErr(`Stop too wide for ${fmtUsd(riskUsd)} risk with ${form.contract}: switch to MNQ or use a closer level.`); return; }
    if (!Number.isInteger(o.qty) || o.qty < 1 || o.qty > 100) { setErr('Quantity must be 1–100.'); return; }
    if (!(o.stopPts > 0) || !(o.target > 0)) { setErr('Stop and target must be above 0.'); return; }
    const breaks = coach.check(o);
    if (pastDaily) breaks.push(`Past your daily loss limit (${fmtUsd(-dailyLimit)}): the plan says stop for the day`);
    if (otype !== 'market') {
      const px = Number(oprice);
      if (!Number.isFinite(px) || px <= 0) { setErr('Enter the order price.'); return; }
      const msg = e.placeOrder({ ...o, type: otype, price: px });
      if (msg) { setErr(msg); return; }
      setErr(''); setTicket(null);
      if (breaks.length) coach.note('rule', `Working order placed with ${breaks.length} rule break${breaks.length === 1 ? '' : 's'}:\n• ${breaks.join('\n• ')}`);
      return;
    }
    // Backtesting is for testing ideas: never pause, block or hold an order. Rule breaks are logged on the
    // trade and noted quietly in the coach panel; a Claude review (if switched on) runs in the background.
    place(o, breaks);
    if (aiOnTrades) void coach.review(o, breaks);
  };
  const cancelStage = () => { setStage(null); };

  const reward = form.targetUnit === 'R' ? form.stopPts * form.target : form.target;
  const pv = form.contract === 'NQ' ? 20 : 2;
  // ---- risk-based size with a drawdown throttle ----
  const ss = sessionState(e.trades);
  const throttled = sizing.halfAfter > 0 && ss.streak >= sizing.halfAfter;
  const dailyLimit = sizing.balance * sizing.dailyPct / 100;
  const pastDaily = sizing.dailyPct > 0 && ss.pnl <= -dailyLimit;
  const riskUsd = sizing.balance * sizing.riskPct / 100 * (throttled ? 0.5 : 1);
  const riskQty = form.stopPts > 0 ? Math.floor(riskUsd / (form.stopPts * pv)) : 0;
  const qtyNow = sizing.mode === 'risk' ? riskQty : form.qty;
  const tightStop = atr && atr.value > 0 && form.stopPts > 0 && form.stopPts < 0.75 * atr.value;

  return (
    <div className={`mc-replay${pos.x === 0 && pos.y === 0 ? ' docked' : ''}${mini ? ' mini' : ''}`} ref={boxRef} style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }} onMouseDown={ev => ev.stopPropagation()}>
      {ticket && (
        <form className="mc-ticket" onSubmit={submit} noValidate>
          <div className="mc-panel-title">{ticket === 'long' ? 'Buy' : 'Sell'} {otype === 'market' ? 'at market' : otype}{price !== null ? ` · ${fmtPrice(price)}` : ''}</div>
          {(
            <div className="mc-row">
              <div className="mc-seg" title="Market fills now. Limit / stop wait for the price; drag the order's line on the chart to move it.">
                {(['market', 'limit', 'stop'] as OrderType[]).map(t => (
                  <button type="button" key={t} className={otype === t ? 'on' : ''}
                    onClick={() => { setOtype(t); if (t !== 'market' && price !== null && !oprice) setOprice(String(price + ((t === 'limit') === (ticket === 'long') ? -5 : 5))); }}>
                    {t[0].toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
              {otype !== 'market' && (
                <label className="mc-field">Price
                  <input className="mc-input" type="number" step={0.25} value={oprice} onChange={ev => setOprice(ev.target.value)} />
                </label>
              )}
            </div>
          )}
          <div className="mc-row">
            <div className="mc-seg" title="Fixed contracts, or size from the money you risk to the stop">
              <button type="button" className={sizing.mode === 'fixed' ? 'on' : ''} onClick={() => setSizing({ mode: 'fixed' })}>Fixed</button>
              <button type="button" className={sizing.mode === 'risk' ? 'on' : ''} onClick={() => setSizing({ mode: 'risk' })}>By risk</button>
            </div>
            {sizing.mode === 'fixed' ? (
              <label className="mc-field">Qty
                <input className="mc-input" type="number" min={1} max={100} step={1} value={Number.isFinite(form.qty) ? form.qty : ''}
                  onChange={ev => setForm(f => ({ ...f, qty: Math.round(num(ev.target.value)) }))} />
              </label>
            ) : (
              <>
                <label className="mc-field">Account $
                  <input className="mc-input" type="number" min={1000} step={1000} value={sizing.balance} onChange={ev => setSizing({ balance: Math.max(0, num(ev.target.value) || 0) })} />
                </label>
                <label className="mc-field">Risk %
                  <input className="mc-input" type="number" min={0.1} max={5} step={0.1} value={sizing.riskPct} onChange={ev => setSizing({ riskPct: Math.max(0, num(ev.target.value) || 0) })} />
                </label>
              </>
            )}
            <div className="mc-seg" title="Contract">
              {(['NQ', 'MNQ'] as Contract[]).map(c => (
                <button type="button" key={c} className={form.contract === c ? 'on' : ''} onClick={() => { setForm(f => ({ ...f, contract: c })); setErr(''); }}>{c}</button>
              ))}
            </div>
          </div>
          <div className="mc-row">
            <label className="mc-field">Stop (pts)
              <input className="mc-input" type="number" min={0.25} step={0.25} value={Number.isFinite(form.stopPts) ? form.stopPts : ''}
                onChange={ev => setForm(f => ({ ...f, stopPts: num(ev.target.value) }))} />
            </label>
            <label className="mc-field">Target
              <input className="mc-input" type="number" min={0.25} step="any" value={Number.isFinite(form.target) ? form.target : ''}
                onChange={ev => setForm(f => ({ ...f, target: num(ev.target.value) }))} />
            </label>
            <div className="mc-seg" title="Target in R (multiples of the stop) or points">
              {(['R', 'pts'] as const).map(u => (
                <button type="button" key={u} className={form.targetUnit === u ? 'on' : ''} onClick={() => setForm(f => ({ ...f, targetUnit: u }))}>{u}</button>
              ))}
            </div>
          </div>
          {Number.isFinite(reward) && Number.isFinite(form.stopPts) && Number.isFinite(qtyNow) && (
            <div className="mc-hint">{sizing.mode === 'risk' ? `${qtyNow} ${form.contract} · ` : ''}Risk {fmtUsd(form.stopPts * pv * qtyNow)} · reward {fmtUsd(reward * pv * qtyNow)} · {(reward / form.stopPts).toFixed(2)}R</div>
          )}
          {sizing.mode === 'risk' && throttled && <div className="mc-hint mc-warn">{ss.streak} losses in a row: size cut to half ({fmtUsd(riskUsd)} risk) until a win.</div>}
          {pastDaily && <div className="mc-hint mc-bad">Session P&amp;L {fmtUsd(ss.pnl)} is past your daily loss limit ({sizing.dailyPct}% = {fmtUsd(-dailyLimit)}). Your plan says stop for today.</div>}
          {tightStop && atr && <div className="mc-hint mc-warn">Stop {form.stopPts} pt is only {(form.stopPts / atr.value).toFixed(1)}× the {atr.tf} ATR ({atr.value.toFixed(1)} pt): normal noise can hit it. Use a level further away and cut the size instead.</div>}
          <div className="mc-row">
            <label className="mc-field mc-grow">Setup
              <select className="mc-input" value={form.setup} onChange={ev => setForm(f => ({ ...f, setup: ev.target.value }))}>
                <option value="">—</option>
                {setups.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <input className="mc-input mc-wide" placeholder="Note (optional)" maxLength={500} value={form.notes}
            onChange={ev => setForm(f => ({ ...f, notes: ev.target.value }))} />
          {err && <div className="mc-hint mc-bad">{err}</div>}
          {stage?.kind === 'breaks' && (
            <div className="mc-coach-stop">
              <div className="mc-coach-stop-title"><OctagonAlert size={15} /> Coach: this order breaks your rules</div>
              <ul>{stage.breaks.map(b => <li key={b}>{b}</li>)}</ul>
              <div className="mc-row mc-row-end">
                <button type="button" className="mc-btn" onClick={cancelStage}>Fix the order</button>
                <button type="button" className="mc-btn mc-small" onClick={() => { setStage(null); setTicket(null); coach.note('rule', 'Good call: order cancelled instead of breaking a rule.'); }}>Cancel order</button>
                <button type="button" className="mc-btn mc-bad" onClick={() => (aiOnTrades ? runReview(stage.o, stage.breaks) : place(stage.o, stage.breaks))}>Take anyway (log rule break)</button>
              </div>
            </div>
          )}
          {stage?.kind === 'ai' && (
            <div className="mc-coach-stop mc-coach-wait">
              Claude is reviewing the entry…
              <button type="button" className="mc-btn mc-small" onClick={() => place(stage.o, stage.breaks)}>Skip review</button>
              <button type="button" className="mc-btn mc-small" onClick={cancelStage}>Back</button>
            </div>
          )}
          {stage?.kind === 'verdict' && (
            <div className={`mc-coach-stop mc-v-${(stage.verdict ?? 'info').toLowerCase()}`}>
              <div className="mc-coach-stop-title">Claude: {stage.verdict ?? 'no review'}</div>
              <div className="mc-coach-text">{stage.text}</div>
              <div className="mc-row mc-row-end">
                <button type="button" className="mc-btn" onClick={() => { setStage(null); setTicket(null); }}>Cancel order</button>
                <button type="button" className={`mc-btn${stage.verdict === 'STOP' ? ' mc-bad' : ''}`}
                  onClick={() => place(stage.o, stage.verdict === 'STOP' ? [...stage.breaks, "Took the trade against Claude's STOP"] : stage.breaks)}>
                  {stage.verdict === 'STOP' ? 'Take anyway (log rule break)' : 'Place order'}
                </button>
              </div>
            </div>
          )}
          {!stage && <div className="mc-row mc-row-end">
            <button type="button" className="mc-btn" onClick={() => { setTicket(null); setErr(''); }}>Cancel</button>
            <button type="submit" className={`mc-btn ${ticket === 'long' ? 'mc-buy' : 'mc-sell'}`}>
              {ticket === 'long' ? 'Buy' : 'Sell'} {qtyNow} {form.contract}
            </button>
          </div>}
        </form>
      )}

      {showTrades && (
        <div className="mc-ticket mc-trades">
          <div className="mc-panel-title">This session · {e.trades.length} trade{e.trades.length === 1 ? '' : 's'}</div>
          {!e.trades.length && <div className="mc-hint">Closed trades appear here and in the journal.</div>}
          {e.trades.length > 0 && (
            <div className="mc-stats">
              <div><span>P&amp;L</span><b className={st.pnl >= 0 ? 'mc-up' : 'mc-down'}>{fmtUsd(st.pnl)}</b></div>
              <div><span>Total R</span><b className={st.rSum >= 0 ? 'mc-up' : 'mc-down'}>{signed(st.rSum, 1)}R</b></div>
              <div><span>Win rate</span><b>{Math.round(st.win * 100)}%</b></div>
              <div><span>Avg R</span><b>{signed(st.avgR, 2)}R</b></div>
              <div><span>Max drawdown</span><b className={st.dd < 0 ? 'mc-down' : ''}>{fmtUsd(st.dd)}</b></div>
            </div>
          )}
          <EquityCurve curve={st.curve} />
          {[...e.trades].reverse().map(t => (
            <div key={t.id} className="mc-trade-row">
              <span className={t.side === 'long' ? 'mc-up' : 'mc-down'}>{t.side === 'long' ? 'Long' : 'Short'}</span>
              <span className="mc-dim">{fmtWall(t.entryTime, clock).slice(5)} · {REASON[t.reason]}</span>
              <span className={t.pnl >= 0 ? 'mc-up' : 'mc-down'}>{signed(t.r, 1)}R {fmtUsd(t.pnl)}</span>
              {t.saved === 'saved' && <span className="mc-dim" title="Saved to the journal">✓</span>}
              {t.saved === 'pending' && <span className="mc-dim">saving…</span>}
              {t.saved === 'failed' && <button className="mc-btn mc-small mc-bad" title={t.error} onClick={() => onRetry(t)}>Retry save</button>}
            </div>
          ))}
        </div>
      )}

      {tagged && !ticket && !p && (
        <div className="mc-quicktags">
          <span className="mc-dim">Last trade {signed(tagged.r, 1)}R — how was it?</span>
          {QUICK_TAGS.map(([k, label, neg]) => (
            <button key={k} className={`mc-qtag ${neg ? 'neg' : 'pos'}${tagged.tags?.includes(k) ? ' on' : ''}`}
              disabled={!tagged.dbId} title={tagged.dbId ? 'Saved as a tag on the journal trade' : 'Waiting for the trade to save'}
              onClick={() => toggleTag(k)}>{label}</button>
          ))}
          {tagErr && <span className="mc-bad mc-small-msg">{tagErr}</span>}
          <button className="mc-btn mc-small" onClick={() => setTagFor(null)} title="Hide">✕</button>
        </div>
      )}
      {menu && (
        <div className="mc-tvmenu" role="menu">
          <div className="mc-tvmenu-h">Select starting point</div>
          <button className="mc-tvmenu-i" role="menuitem" disabled={!!p} onClick={() => { setMenu(false); setErr(''); onPick(); }}
            title={p ? 'Close the position first' : 'Click a candle on the chart: replay restarts from it'}><ArrowLeftToLine size={16} /> Bar</button>
          <button className={`mc-tvmenu-i${dateOpen ? ' on' : ''}`} role="menuitem" disabled={!!p} onClick={() => setDateOpen(!dateOpen)}><CalendarDays size={16} /> Date…</button>
          {dateOpen && (
            <div className="mc-tvmenu-date">
              <input type="date" className="mc-input" value={jDate} onChange={ev => setJDate(ev.target.value)} />
              <input type="time" className="mc-input" value={jTime} onChange={ev => setJTime(ev.target.value)} title={`Time (${clock})`} />
              <button className="mc-btn mc-primary mc-small" disabled={!!p || jumping || !jDate} onClick={goDate}>Go</button>
            </div>
          )}
          <button className="mc-tvmenu-i" role="menuitem" disabled={!!p || jumping || !dataRange?.first} onClick={firstDate}><Flag size={16} /> First available date</button>
          <button className="mc-tvmenu-i" role="menuitem" disabled={!!p || jumping || !dataRange?.first} onClick={randomBar}><Dices size={16} /> Random bar</button>
          <div className="mc-tvmenu-sep" />
          <div className="mc-tvmenu-row">
            <button className="mc-btn mc-small" disabled={!!p || jumping || e.busy} onClick={() => { setMenu(false); jump(false); }}
              title="Skip to 9:25 ET (5 minutes before the New York open)">⏩ 9:25 today</button>
            <button className="mc-btn mc-small" disabled={!!p || jumping || e.busy} onClick={() => { setMenu(false); jump(true); }}
              title="Next trading day at 9:25 ET">Next day</button>
          </div>
          <label className="mc-field">Save replay trades to
            <select className="mc-input" value={accountId ?? ''} onChange={ev => onAccount(Number(ev.target.value))}>
              {accountId === null && <option value="">Save to…</option>}
              {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
            </select>
          </label>
          {p && <div className="mc-hint">Close the open position to change the start.</div>}
          <button className="mc-btn mc-small" onClick={resetPos}>Put the bar back in the middle</button>
        </div>
      )}
      {pop === 'speed' && (
        <div className="mc-tvmenu mc-tvmenu-small" role="menu">
          <div className="mc-tvmenu-h">Replay speed</div>
          {e.live
            ? LIVE_SPEEDS.map(v => <button key={v} className={`mc-tvmenu-i${e.liveSpeed === v ? ' on' : ''}`} onClick={() => { e.liveSpeed = v; if (e.playing) { e.pause(); e.play(); } setPop(null); }}>{v}x</button>)
            : SPEEDS.map(v => <button key={v} className={`mc-tvmenu-i${e.speed === v ? ' on' : ''}`} onClick={() => { e.speed = v; if (e.playing) { e.pause(); e.play(); } setPop(null); }}>{speedLabel(v)}</button>)}
        </div>
      )}
      {pop === 'interval' && (
        <div className="mc-tvmenu mc-tvmenu-small" role="menu">
          <div className="mc-tvmenu-h">Update interval</div>
          <button className={`mc-tvmenu-i${!e.live && e.stepMode === '1m' ? ' on' : ''}`} onClick={() => { e.setLive(false); e.stepMode = '1m'; e.pause(); setPop(null); }}>1m</button>
          <button className={`mc-tvmenu-i${!e.live && e.stepMode === 'bar' ? ' on' : ''}`} onClick={() => { e.setLive(false); e.stepMode = 'bar'; e.pause(); setPop(null); }}>{tfLabel} (chart)</button>
          <button className={`mc-tvmenu-i${e.live ? ' on' : ''}`} onClick={() => { e.setLive(true); setPop(null); }}
            title="Forward test: the market plays second by second and you trade it as it happens">● Live (forward test)</button>
        </div>
      )}
      <div className="mc-replay-row">
        <span className="mc-grip" onPointerDown={startDrag} onDoubleClick={resetPos} title={mini ? 'Click: full replay bar · drag: move · double-click: dock under the chart' : 'Click: short replay bar · drag: move over the chart · double-click: dock under the chart'}><GripVertical size={14} /></span>
        <button className={`mc-tvbtn mc-tvsel mc-rfull${menu ? ' open' : ''}`} disabled={jumping} onClick={openMenu}
          title="Select starting point: a bar, a date, the first available date or a random bar">
          <ArrowLeftToLine size={16} /> Select bar {menu ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className="mc-sep mc-rfull" />
        <button className="mc-tvbtn mc-tvicon mc-rfull" disabled={e.busy || e.playing} onClick={() => e.stepBack()} title="Step back (←)"><StepBack size={16} /></button>
        <button className="mc-tvbtn mc-tvicon mc-tvplay" disabled={e.ended} onClick={() => (e.playing ? e.pause() : e.play())} title={e.playing ? 'Pause (Space)' : 'Play (Space)'}>
          {e.playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="mc-tvbtn mc-tvicon" disabled={e.busy || e.playing || e.ended} onClick={() => e.stepForward()} title="Forward (→)"><StepForward size={16} /></button>
        <button className={`mc-tvbtn mc-rfull${pop === 'speed' ? ' open' : ''}`} onClick={() => { setPop(pop === 'speed' ? null : 'speed'); setMenu(false); }}
          title={e.live ? 'Forward test speed: market time per real second' : 'Replay speed'}>{e.live ? `${e.liveSpeed}x` : speedLabel(e.speed)}</button>
        <button className={`mc-tvbtn mc-rfull${pop === 'interval' ? ' open' : ''}${e.live ? ' mc-live-on' : ''}`} onClick={() => { setPop(pop === 'interval' ? null : 'interval'); setMenu(false); }}
          title="Update interval: each step reveals 1 minute, or one candle of the chart's timeframe; Live = forward test">{intervalLabel}</button>
        <span className="mc-sep mc-rfull" />
        <button className="mc-tvbtn mc-tvicon mc-rfull" onClick={onExit} title={p ? 'Jump to real-time: leave replay (closes the open position at the current price)' : 'Jump to real-time: leave replay'}><ArrowRightToLine size={16} /></button>
        <span className="mc-dim mc-replay-time mc-rfull" title={e.cursor ? `${fmtWall(e.live ? e.nowMs - 1000 : e.cursor + 60000, clock, e.live)} ${clock}` : ''}>
          {e.cursor ? fmtWall(e.live ? e.nowMs - 1000 : e.cursor + 60000, clock, e.live).slice(5) : ''}
        </span>
        <span className="mc-sep mc-rfull" />
        {p ? (
          <>
            <span className={p.side === 'long' ? 'mc-up' : 'mc-down'}>{p.side === 'long' ? 'Long' : 'Short'} {p.qty} {p.contract} @ {fmtPrice(p.entry)}</span>
            <span className={e.openPnl >= 0 ? 'mc-up' : 'mc-down'}>
              {fmtUsd(e.openPnl)}{price !== null ? ` (${signed(rOf(p, price), 2)}R)` : ''}
            </span>
            <button className="mc-btn mc-small mc-rfull" onClick={() => setErr(e.scaleIn(1) ?? '')} title="Add 1 contract at the current price (A)">+1</button>
            <button className="mc-btn mc-small mc-rfull" disabled={p.qty < 2} onClick={() => setErr(e.scaleOut(Math.floor(p.qty / 2)) ?? '')} title="Close half (H)">½</button>
            <button className="mc-btn mc-small mc-rfull" onClick={() => setErr(e.breakEven() ?? '')} title="Move the stop to break-even (E)">BE</button>
            <button className="mc-btn mc-small" onClick={() => e.closeAtMarket()} title="Close everything at the current price (F)">Close</button>
          </>
        ) : (
          <>
            <button className="mc-btn mc-buy" disabled={price === null} onClick={() => openTicket('long')}>Buy</button>
            <button className="mc-btn mc-sell" disabled={price === null} onClick={() => openTicket('short')}>Sell</button>
          </>
        )}
        {e.pending.map(o => (
          <span key={o.id} className={`mc-pending ${o.side === 'long' ? 'mc-up' : 'mc-down'}`} title="Working order: fills when the price gets there">
            {o.side === 'long' ? 'Buy' : 'Sell'} {o.type} {o.qty} @ {fmtPrice(o.price)}
            <button className="mc-btn mc-small" onClick={() => e.cancelOrder(o.id)} title="Cancel the order">✕</button>
          </span>
        ))}
        <span className="mc-sep mc-rfull" />
        <button className={`mc-btn mc-small mc-rfull${showTrades ? ' open' : ''}`} onClick={() => { setShowTrades(!showTrades); setTicket(null); setStage(null); }}
          title="Trades taken in this replay session">
          {e.trades.length ? `${e.trades.length} · ${fmtUsd(total)}` : '0 trades'}
          {failed.length ? <span className="mc-bad"> · {failed.length} not saved</span> : null}
        </button>
        {accountId === null && <button className="mc-btn mc-small mc-bad" onClick={openMenu} title="Pick the journal account replay trades are saved to">Save to…</button>}
        {mini && <button className="mc-tvbtn mc-tvicon" onClick={toggleMini} title="Open the full replay bar"><ChevronRight size={16} /></button>}
        <button className="mc-btn mc-small mc-rfull" onClick={onExit} title={p ? 'Exit replay (closes the open position at the current price)' : 'Exit replay'}>✕</button>
      </div>
      {err && !ticket && <div className="mc-replay-msg mc-bad">{err} <button className="mc-btn mc-small" onClick={() => setErr('')} title="Hide">✕</button></div>}
      {e.message && <div className="mc-replay-msg">{e.message}</div>}
    </div>
  );
}
