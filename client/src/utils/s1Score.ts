// S1 practice scorer. Two jobs:
//  1. simulateS1(): runs the S1 bot exactly as coded in trading-system/roboquant/nq_lab.rq (tag 1,
//     "S1S trend pullback") over 1m bars and returns every signal with its 1.5R_BE result after costs.
//  2. scoreTrade(): checks one of the trader's bar-replay trades against the same rules, using only
//     the candles that had closed before the entry.
// Rules (nq_lab.rq defaults): EMA21 on 15m / 5m / 3m, session VWAP (resets 6pm ET, hlc3 x volume),
// value-zone tolerance 5 pt, trigger within 6 3m candles of the touch, stop = pullback extreme -/+ 3 pt,
// max risk 100 pt, signal window 9:35-15:30 ET, flat 15:55. S1 Morning = 10:00-11:59 ET + 5m trend agrees.
import { etMinutes, sessionDay } from '../chart/time';

export type Bar1 = [number, number, number, number, number, number]; // start ms, o, h, l, c, v
const MIN = 60000;
const EMA_LEN = 21, TOL = 5, WINDOW = 6, MAX_RISK = 100, WIN_START = 935, WIN_END = 1530, FLAT = 1555;
export const TARGET_R = 1.5;
export const POINT_VALUE: Record<string, number> = { NQ: 20, MNQ: 2 };
export const COMMISSION: Record<string, number> = { NQ: 3.5, MNQ: 1.0 };
export const SLIP = 0.5;
const LEVEL_NAMES = ['EMA21 3m', 'EMA21 5m', 'VWAP'];

const hhmm = (ms: number) => { const m = etMinutes(ms); return Math.floor(m / 60) * 100 + (m % 60); };

class Ema {
  n = 0; v = NaN; prev: [number, number, number] = [NaN, NaN, NaN]; last = NaN;
  update(close: number) {
    this.prev = [this.v, this.prev[0], this.prev[1]];
    const k = 2 / (EMA_LEN + 1);
    this.v = this.n === 0 ? close : this.v + k * (close - this.v);
    this.last = close; this.n++;
  }
  trend(): number {
    if (this.n < EMA_LEN + 3) return 0;
    if (this.last > this.v && this.v > this.prev[2]) return 1;
    if (this.last < this.v && this.v < this.prev[2]) return -1;
    return 0;
  }
}

class Agg {
  live = false; start = 0; o = 0; h = 0; l = 0; c = 0; v = 0;
  constructor(private n: number) {}
  /** true when this 1m bar completes the candle */
  push(b: Bar1): boolean {
    if (!this.live) { this.live = true; this.start = b[0]; this.o = b[1]; this.h = b[2]; this.l = b[3]; }
    else { this.h = Math.max(this.h, b[2]); this.l = Math.min(this.l, b[3]); }
    this.c = b[4]; this.v += b[5];
    const done = (((b[0] + MIN) % (this.n * MIN)) + this.n * MIN) % (this.n * MIN) === 0;
    if (done) { this.live = false; this.v = 0; }
    return done;
  }
}

export interface BotSignal {
  t: number;            // close time of the trigger candle (ms)
  hhmm: number;         // ET hhmm of the last 1m bar (how the research log stamps it)
  dir: 1 | -1;
  entry: number; stop: number; risk: number;
  level: string;
  t5: number;           // 5m trend vs the trade: 1 agrees, -1 against, 0 flat
  morning: boolean;     // S1 Morning (the only version that made money in research)
  r: number | null;     // 1.5R_BE result after NQ costs (null = still open at the end of the data)
}

/** What the bot saw when a 3m candle closed (used to score the trader's entries). */
export interface Snap {
  t: number;            // candle close time
  bias: number;         // 15m EMA21 trend
  t5: number;           // 5m EMA21 trend
  e3: number; e5: number; e15: number; vwap: number;
  armDir: number; pbExt: number; armLevel: string | null; armAge: number;
  touched: string | null;  // a value level this candle touched (in the bias direction)
  fired: BotSignal | null;
  h: number; l: number; o: number; c: number; prevH: number; prevL: number;
}

interface VT { sig: BotSignal; mfe: number; mae: number; beArmed: boolean; beHit: boolean; mfeBe: number; }

function outcome(v: VT, reason: 'stop' | 'eod', closeR: number): number {
  const mfeBe = v.beHit ? v.mfeBe : v.mfe, mfe = v.mfe, eod = reason === 'eod';
  let r: number;
  if (mfeBe >= TARGET_R) r = TARGET_R;
  else if (mfe >= 0.5) r = eod && mfeBe === mfe ? closeR : 1 / v.sig.risk;
  else r = eod ? closeR : -1;
  return r - (COMMISSION.NQ / POINT_VALUE.NQ + SLIP) / v.sig.risk;
}

/** Run the S1 bot over 1m bars (oldest first). Give it a day or more before the session you score: the EMAs need warming up. */
export function simulateS1(bars: Bar1[]): { signals: BotSignal[]; snaps: Snap[] } {
  const a3 = new Agg(3), a5 = new Agg(5), a15 = new Agg(15);
  const e3 = new Ema(), e5 = new Ema(), e15 = new Ema();
  let skey = NaN, pv = 0, vol = 0, n3 = 0;
  let armDir = 0, armAge = 0, pbExt = NaN, armLevel = -1;
  let prevH = NaN, prevL = NaN;
  const signals: BotSignal[] = [], snaps: Snap[] = [];
  let vts: VT[] = [];

  for (const b of bars) {
    const hm = hhmm(b[0]);
    // virtual trades: stop checked before excursion (conservative), as in the bot
    const eod = hm >= FLAT && hm < 1800;
    const keep: VT[] = [];
    for (const v of vts) {
      const d = v.sig.dir, s = v.sig;
      const adverse = d > 0 ? b[3] : b[2], favor = d > 0 ? b[2] : b[3];
      if ((adverse - s.stop) * d <= 0) { s.r = outcome(v, 'stop', -1); continue; }
      v.mae = Math.min(v.mae, (adverse - s.entry) * d / s.risk);
      if (v.beArmed && !v.beHit && (adverse - (s.entry + d)) * d <= 0) { v.beHit = true; v.mfeBe = v.mfe; }
      v.mfe = Math.max(v.mfe, (favor - s.entry) * d / s.risk);
      if (v.mfe >= 0.5) v.beArmed = true;
      if (eod) { s.r = outcome(v, 'eod', (b[4] - s.entry) * d / s.risk); continue; }
      keep.push(v);
    }
    vts = keep;

    // session (6pm ET reset): VWAP and the pullback state
    const key = sessionDay(b[0]);
    if (key !== skey) { skey = key; pv = 0; vol = 0; armDir = 0; }
    pv += ((b[2] + b[3] + b[4]) / 3) * b[5]; vol += b[5];
    const vwap = vol > 0 ? pv / vol : NaN;
    const inWindow = hm >= WIN_START && hm <= WIN_END;

    if (a15.push(b)) e15.update(a15.c);
    if (a5.push(b)) e5.update(a5.c);
    if (!a3.push(b)) continue;

    // ---- a 3m candle closed
    n3++;
    const o = a3.o, h = a3.h, l = a3.l, c = a3.c, t = b[0] + MIN;
    const ph = prevH, pl = prevL;
    prevH = h; prevL = l;
    const snap: Snap = {
      t, bias: e15.trend(), t5: e5.trend(), e3: NaN, e5: e5.v, e15: e15.v, vwap,
      armDir: 0, pbExt: NaN, armLevel: null, armAge: 0, touched: null, fired: null, h, l, o, c, prevH: ph, prevL: pl,
    };
    e3.update(c);
    snap.e3 = e3.v;
    snaps.push(snap);
    if (!inWindow || n3 < 6) { armDir = 0; continue; }

    const bias = snap.bias;
    if (bias === 0 || (armDir !== 0 && armDir !== bias)) armDir = 0;
    if (bias === 0) continue;
    const levels = [e3.v, e5.v, vwap];
    let touched = -1;
    for (let i = 0; i < 3; i++) {
      const lv = levels[i];
      if (Number.isFinite(lv) && (bias > 0 ? l <= lv + TOL : h >= lv - TOL)) { touched = i; break; }
    }
    snap.touched = touched >= 0 ? LEVEL_NAMES[touched] : null;
    if (touched >= 0 && armDir === 0) { armDir = bias; armAge = 0; armLevel = touched; pbExt = bias > 0 ? l : h; }
    if (armDir === 0) continue;
    pbExt = bias > 0 ? Math.min(pbExt, l) : Math.max(pbExt, h);
    snap.armDir = armDir; snap.pbExt = pbExt; snap.armLevel = LEVEL_NAMES[armLevel]; snap.armAge = armAge;
    const fired = bias > 0 ? c > o && c > ph : c < o && c < pl;
    if (!fired) { armAge++; if (armAge > WINDOW) armDir = 0; continue; }
    armDir = 0;
    const stop = pbExt - bias * 3, risk = (c - stop) * bias;
    if (risk <= 0 || risk > MAX_RISK) continue;
    const sigHm = hhmm(b[0]);
    const hour = Math.floor(sigHm / 100);
    const sig: BotSignal = {
      t, hhmm: sigHm, dir: bias as 1 | -1, entry: c, stop, risk, level: LEVEL_NAMES[armLevel],
      t5: snap.t5 * bias, morning: (hour === 10 || hour === 11) && snap.t5 * bias === 1, r: null,
    };
    snap.fired = sig;
    signals.push(sig);
    vts.push({ sig, mfe: 0, mae: 0, beArmed: false, beHit: false, mfeBe: 0 });
  }
  return { signals, snaps };
}

// ------------------------------------------------------------------ the trader's trades
export interface PracticeTrade {
  id: number; symbol: string; quantity: number | null; side: 'long' | 'short';
  entry_price: number | null; exit_price: number | null; stop_loss: number | null; target: number | null;
  pnl: number | null; setup_tag: string | null; tags: string[]; entry: number; exit: number | null;
}

export interface Check { key: string; label: string; ok: boolean | null; detail: string; }
export interface TradeScore {
  trade: PracticeTrade;
  taggedS1: boolean;
  checks: Check[];
  followed: boolean;        // every rule check passed
  botMatch: BotSignal | null; // the bot fired the same way within 6 minutes of the entry
  r: number | null;         // result in R after costs (from the journal P&L)
  riskPts: number | null;
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');

export function scoreTrade(tr: PracticeTrade, sim: { signals: BotSignal[]; snaps: Snap[] }): TradeScore {
  const dir = tr.side === 'long' ? 1 : -1;
  const sym = tr.symbol?.toUpperCase().includes('MNQ') ? 'MNQ' : 'NQ';
  const pv = POINT_VALUE[sym], qty = tr.quantity || 1;
  const riskPts = tr.entry_price != null && tr.stop_loss != null ? (tr.entry_price - tr.stop_loss) * dir : null;
  const r = tr.pnl != null && riskPts && riskPts > 0
    ? (tr.pnl - qty * (COMMISSION[sym] + SLIP * pv)) / (riskPts * pv * qty) : null;
  // what the bot knew: the last 3m candle that closed at or before the entry
  let k = -1;
  for (let i = 0; i < sim.snaps.length; i++) { if (sim.snaps[i].t <= tr.entry) k = i; else break; }
  const s = k >= 0 ? sim.snaps[k] : null;
  const hm = hhmm(tr.entry), hour = Math.floor(hm / 100);
  const checks: Check[] = [];
  const add = (key: string, label: string, ok: boolean | null, detail: string) => checks.push({ key, label, ok, detail });
  const tStr = `${Math.floor(hm / 100)}:${String(hm % 100).padStart(2, '0')} ET`;
  add('time', 'S1 Morning window (10:00–11:59 ET)', hour === 10 || hour === 11, `Entry at ${tStr}.`);
  if (!s || s.e15 !== s.e15) {
    add('bias', '15m trend agrees', null, 'Not enough candles before the entry.');
  } else {
    const word = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
    add('bias', '15m trend agrees (price and EMA21 slope)', s.bias === dir, `15m trend was ${word(s.bias)}; EMA21 15m ${f1(s.e15)}.`);
    add('t5', '5m trend agrees', s.t5 === dir, `5m trend was ${word(s.t5)}; EMA21 5m ${f1(s.e5)}.`);
    // pullback into value in the last 6 closed 3m candles, on the trade's side
    let touch: Snap | null = null, ext = NaN;
    for (let i = k; i >= 0 && i >= k - WINDOW; i--) {
      const x = sim.snaps[i];
      ext = Number.isFinite(ext) ? (dir > 0 ? Math.min(ext, x.l) : Math.max(ext, x.h)) : dir > 0 ? x.l : x.h;
      const lv = [x.e3, x.e5, x.vwap];
      const hit = lv.findIndex(v => Number.isFinite(v) && (dir > 0 ? x.l <= v + TOL : x.h >= v - TOL));
      if (hit >= 0) { touch = x; break; }
    }
    add('pullback', 'Pullback into value (EMA21 3m / 5m / VWAP) in the last 6 3m candles', !!touch,
      touch ? `Touched value; pullback ${dir > 0 ? 'low' : 'high'} ${f1(ext)}. VWAP ${f1(s.vwap)}.`
        : `No 3m candle came within ${TOL} pt of EMA21 3m (${f1(s.e3)}), EMA21 5m (${f1(s.e5)}) or VWAP (${f1(s.vwap)}).`);
    const trig = dir > 0 ? s.c > s.o && s.c > s.prevH : s.c < s.o && s.c < s.prevL;
    add('trigger', `Trigger: last 3m candle closed ${dir > 0 ? 'up and above the previous high' : 'down and below the previous low'}`, trig,
      `Last 3m candle O ${f1(s.o)} C ${f1(s.c)}; previous ${dir > 0 ? 'high' : 'low'} ${f1(dir > 0 ? s.prevH : s.prevL)}.`);
    if (tr.stop_loss == null || !touch) {
      add('stop', 'Stop beyond the pullback extreme', null, tr.stop_loss == null ? 'No stop recorded.' : 'No pullback to measure from.');
    } else {
      const botStop = ext - dir * 3;
      const ok = (tr.stop_loss - ext) * dir < 0 && (botStop - tr.stop_loss) * dir < 25;
      add('stop', 'Stop just beyond the pullback extreme', ok,
        `Your stop ${f1(tr.stop_loss)}; the bot's would be ${f1(botStop)} (extreme ${dir > 0 ? '−' : '+'} 3 pt).` +
        ((tr.stop_loss - ext) * dir >= 0 ? ' Yours is inside the pullback: noise can hit it.' : (botStop - tr.stop_loss) * dir >= 25 ? ' Yours is 25+ pt further: risk bigger than needed.' : ''));
    }
  }
  if (riskPts != null && riskPts > 0 && tr.target != null && tr.entry_price != null) {
    const rr = (tr.target - tr.entry_price) * dir / riskPts;
    add('target', `Planned target at least ${TARGET_R}R`, rr >= TARGET_R - 0.05, `Planned ${rr.toFixed(2)}R (${f1(riskPts)} pt risk).`);
  } else add('target', `Planned target at least ${TARGET_R}R`, null, 'No stop or target recorded.');

  const followed = checks.every(c => c.ok === true);
  const botMatch = sim.signals.find(x => x.dir === dir && Math.abs(x.t - tr.entry) <= 6 * MIN) || null;
  return { trade: tr, taggedS1: /S1/i.test(tr.setup_tag || ''), checks, followed, botMatch, r, riskPts };
}

export interface Summary { n: number; win: number; avgR: number; pf: number | null; totR: number; }
export function summary(rs: number[]): Summary | null {
  if (!rs.length) return null;
  const w = rs.filter(r => r > 0), gl = -rs.filter(r => r <= 0).reduce((a, b) => a + b, 0), tot = rs.reduce((a, b) => a + b, 0);
  return { n: rs.length, win: w.length / rs.length, avgR: tot / rs.length, pf: gl > 0 ? w.reduce((a, b) => a + b, 0) / gl : null, totR: tot };
}
