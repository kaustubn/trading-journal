// Edge Hunter: searches the chart's NQ history for repeating price-action patterns AND the stop /
// target that suit them, without being told either. Built to resist fooling itself:
//   1. Every event of 10 pattern families on 5-minute candles (New York session), taken both ways
//      (follow / fade), sliced by time of day, weekday, 15m trend (with / against) and volatility.
//   2. Exits searched too: stop 0.5 / 1 / 1.5 / 2 x ATR(14, 5m), target 1 / 1.5 / 2 / 3 R, 120 min max.
//      One walk per stop gives every target: a target counts only if reached before the stop
//      (a candle touching both = stop). Costs: NQ $3.50 + 0.5 pt per trade, taken off in R.
//   3. Days split by date: DISCOVERY = oldest 50%, VALIDATION = next 25%, HOLDOUT = newest 25%.
//      A rule must clear DISCOVERY (n >= 120, avg >= +0.08 R) and VALIDATION (n >= 50, avg > 0).
//      HOLDOUT is only reported for those survivors (never used to pick).
//   4. Luck baseline: the identical search with each event's direction set by a coin flip. The
//      number of "survivors" it produces is what chance alone gives.
// Entries: the open of the first minute after the 5m candle closes (no look-ahead).
import pool from '../db';
import { load, Store } from './timeScan';

const PATTERNS = [
  { key: 'orb', name: 'Opening range (9:30-9:45) break', desc: 'first 5m close beyond the 9:30-9:45 high / low (before 12:00)' },
  { key: 'emapb', name: 'Pullback to EMA21 (5m) in trend', desc: '5m candle dips to a rising EMA21 and closes above it (mirror for down)' },
  { key: 'vwapx', name: 'VWAP cross', desc: '5m close crosses session VWAP' },
  { key: 'pdsweep', name: 'Prior-day high/low sweep', desc: '5m wick through the prior day high (low), close back inside' },
  { key: 'engulf', name: 'Engulfing candle', desc: '5m body engulfs the previous opposite-colour body' },
  { key: 'inside', name: 'Inside-bar break', desc: '5m close beyond the high / low of an inside bar' },
  { key: 'three', name: 'Three same-colour candles', desc: 'third 5m candle in a row of the same colour' },
  { key: 'bigbar', name: 'Big candle', desc: '5m range at least 2 x ATR' },
  { key: 'gap', name: 'Opening gap', desc: 'open at least 0.25 x day range away from the prior close (9:35 close)' },
  { key: 'fhbreak', name: 'First-hour high/low break', desc: 'first 5m close beyond the 9:30-10:30 high / low (after 10:30)' },
] as const;
const MODES = ['follow', 'fade'] as const;
const TIMES = [{ k: 'any', a: 0, b: 390, label: 'any time' }, { k: 'open', a: 0, b: 60, label: '9:30-10:30' }, { k: 'morning', a: 60, b: 150, label: '10:30-12:00' },
  { k: 'midday', a: 150, b: 270, label: '12:00-14:00' }, { k: 'pm', a: 270, b: 390, label: '14:00-16:00' }];
const WDS = ['any day', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TRENDS = ['any trend', 'with the 15m trend', 'against the 15m trend'];
const VOLS = ['any volatility', 'quiet (ATR < 0.8x normal)', 'normal', 'wild (ATR > 1.25x normal)'];
const STOPS = [0.5, 1, 1.5, 2];
const TARGETS = [1, 1.5, 2, 3];
const HOLD = 120, FLAT = 385, COOLDOWN = 15;            // max minutes in a trade; flat by 15:55
const COST_PTS = 3.5 / 20 + 0.5;          // NQ commission in points + slippage
const MIN_DISC_N = 120, DISC_MIN = 0.08, MIN_VAL_N = 50, VAL_MIN = 0;

const NP = PATTERNS.length, NM = 2, NT = TIMES.length, NW = WDS.length, NTR = 3, NV = 4, NS = STOPS.length, NG = TARGETS.length;
const SIZE = NP * NM * NT * NW * NTR * NV * NS * NG;
const keyOf = (p: number, m: number, t: number, w: number, tr: number, v: number, s: number, g: number) =>
  ((((((p * NM + m) * NT + t) * NW + w) * NTR + tr) * NV + v) * NS + s) * NG + g;

interface Event { day: number; min: number; pat: number; dir: number; tr: number; vol: number; atr: number; r: Float32Array; } // r[s*NG+g] = net R in the event's own direction
// For the fade the walk is different, so each event stores both: rF (follow) and rD (fade)
interface Ev2 extends Event { rFade: Float32Array; }

function ema(prev: number, x: number, n: number) { return Number.isNaN(prev) ? x : prev + (2 / (n + 1)) * (x - prev); }

/** Walk one trade from minute `m0` of day `d` (entry at that minute's open) for each stop size. */
function walk(s: Store, idx: Int32Array, m0: number, dir: number, atr: number): Float32Array {
  const out = new Float32Array(NS * NG);
  const j0 = idx[m0];
  const entry = s.o[j0];
  for (let si = 0; si < NS; si++) {
    const stopPts = Math.max(2, STOPS[si] * atr);
    let mfe = 0, stopped = false, last = entry;
    const end = Math.min(FLAT, m0 + HOLD - 1);
    for (let q = m0; q <= end; q++) {
      const j = idx[q]; if (j < 0) continue;
      const adverse = dir > 0 ? entry - s.l[j] : s.h[j] - entry;
      if (adverse >= stopPts) { stopped = true; break; }
      const fav = dir > 0 ? s.h[j] - entry : entry - s.l[j];
      if (fav > mfe) mfe = fav;
      last = s.c[j];
    }
    const costR = COST_PTS / stopPts;
    for (let gi = 0; gi < NG; gi++) {
      const tgt = TARGETS[gi];
      let r: number;
      if (mfe >= tgt * stopPts) r = tgt;
      else if (stopped) r = -1;
      else r = Math.max(-1, Math.min(tgt, ((last - entry) * dir) / stopPts));
      out[si * NG + gi] = r - costR;
    }
  }
  return out;
}

/** All pattern events, day by day, using only finished candles. */
function events(s: Store): { evs: Ev2[]; days: Store['days'] } {
  const days = s.days;
  const evs: Ev2[] = [];
  let e5 = NaN, e15 = NaN, e15p = NaN, e5p = NaN, atr = NaN, prevC5 = NaN;
  const e15hist: number[] = [];
  const dayAtrs: number[] = [];     // average 5m ATR of each past day (volatility normal)
  let pdh = NaN, pdl = NaN, pdc = NaN, prevRange = NaN;
  days.forEach((d, di) => {
    const idx = new Int32Array(390).fill(-1);
    for (let k = 0; k < d.n; k++) { const q = s.m[d.start + k] - 570; if (q >= 0 && q < 390) idx[q] = d.start + k; }
    const open = s.o[d.start];
    // 5m candles of the day
    const b5: { o: number; h: number; l: number; c: number; v: number; end: number }[] = [];
    for (let k = 0; k < 78; k++) {
      let o = NaN, h = -Infinity, l = Infinity, c = NaN, v = 0;
      for (let q = k * 5; q < k * 5 + 5; q++) { const j = idx[q]; if (j < 0) continue; if (Number.isNaN(o)) o = s.o[j]; h = Math.max(h, s.h[j]); l = Math.min(l, s.l[j]); c = s.c[j]; v += s.v[j]; }
      b5.push({ o, h, l, c, v, end: k * 5 + 5 });
    }
    const normAtr = dayAtrs.length >= 10 ? dayAtrs.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, dayAtrs.length) : NaN;
    let pv = 0, vv = 0, vwapPrev = NaN, orH = -Infinity, orL = Infinity, fhH = -Infinity, fhL = Infinity;
    let orLong = false, orShort = false, fhLong = false, fhShort = false, gapDone = false;
    let atrSum = 0, atrN = 0, c15 = NaN;
    const lastAt = new Array(PATTERNS.length).fill(-999);
    const push = (k: number, pat: number, dir: number) => {
      const m0 = b5[k].end;                      // entry minute = first minute after the candle
      if (m0 - lastAt[pat] < COOLDOWN) return;   // one signal per pattern per 15 min (no stacked repeats)
      lastAt[pat] = m0;
      if (m0 > FLAT - 5 || idx[m0] < 0 || !(atr > 0) || !Number.isFinite(dir) || dir === 0) return;
      const t15 = !Number.isNaN(e15p) && !Number.isNaN(c15) ? (c15 > e15 && e15 > e15p ? 1 : c15 < e15 && e15 < e15p ? -1 : 0) : 0;
      const tr = t15 === 0 ? 0 : t15 === dir ? 1 : 2;   // follow-direction trend relation (fade flips below)
      const vol = Number.isNaN(normAtr) ? 2 : atr < 0.8 * normAtr ? 1 : atr > 1.25 * normAtr ? 3 : 2;
      evs.push({ day: di, min: m0, pat, dir, tr, vol, atr, r: walk(s, idx, m0, dir, atr), rFade: walk(s, idx, m0, -dir, atr) });
    };
    for (let k = 0; k < 78; k++) {
      const b = b5[k];
      if (Number.isNaN(b.o)) continue;
      // indicators updated with this finished candle
      const tr = Number.isNaN(prevC5) ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - prevC5), Math.abs(b.l - prevC5));
      atr = Number.isNaN(atr) ? tr : atr + (tr - atr) / 14;
      atrSum += atr; atrN++;
      e5p = e5; e5 = ema(e5, b.c, 21);
      for (let q = k * 5; q < k * 5 + 5; q++) { const j = idx[q]; if (j >= 0) { pv += ((s.h[j] + s.l[j] + s.c[j]) / 3) * s.v[j]; vv += s.v[j]; } }
      const vwap = vv > 0 ? pv / vv : NaN;
      if ((k + 1) % 3 === 0) { c15 = b.c; e15hist.push(e15); e15p = e15hist.length >= 3 ? e15hist[e15hist.length - 3] : NaN; e15 = ema(e15, b.c, 21); }
      const p = k > 0 ? b5[k - 1] : null, pp = k > 1 ? b5[k - 2] : null;
      if (k < 3) { orH = Math.max(orH, b.h); orL = Math.min(orL, b.l); }
      if (k < 12) { fhH = Math.max(fhH, b.h); fhL = Math.min(fhL, b.l); }
      // ---- patterns (direction = the natural "follow" direction)
      if (k >= 3 && k < 30) {                                         // 0 ORB
        if (!orLong && b.c > orH) { orLong = true; push(k, 0, 1); }
        if (!orShort && b.c < orL) { orShort = true; push(k, 0, -1); }
      }
      if (p && !Number.isNaN(e5p)) {                                   // 1 EMA pullback
        if (b.c > e5 && e5 > e5p && b.l <= e5 + 0.1 * atr && b.c > b.o) push(k, 1, 1);
        else if (b.c < e5 && e5 < e5p && b.h >= e5 - 0.1 * atr && b.c < b.o) push(k, 1, -1);
      }
      if (p && !Number.isNaN(vwapPrev)) {                              // 2 VWAP cross
        if (p.c < vwapPrev && b.c > vwap) push(k, 2, 1);
        else if (p.c > vwapPrev && b.c < vwap) push(k, 2, -1);
      }
      if (!Number.isNaN(pdh)) {                                        // 3 prior-day sweep (follow = reversal back inside)
        if (b.h > pdh && b.c < pdh) push(k, 3, -1);
        else if (b.l < pdl && b.c > pdl) push(k, 3, 1);
      }
      if (p && !Number.isNaN(p.o)) {                                   // 4 engulfing
        if (p.c < p.o && b.c > b.o && b.c >= p.o && b.o <= p.c && b.c - b.o > p.o - p.c) push(k, 4, 1);
        else if (p.c > p.o && b.c < b.o && b.c <= p.o && b.o >= p.c && b.o - b.c > p.c - p.o) push(k, 4, -1);
      }
      if (p && pp && p.h <= pp.h && p.l >= pp.l) {                     // 5 inside-bar break
        if (b.c > p.h) push(k, 5, 1); else if (b.c < p.l) push(k, 5, -1);
      }
      if (p && pp) {                                                   // 6 three same colour
        const up = (x: typeof b) => x.c > x.o, dn = (x: typeof b) => x.c < x.o;
        if (up(b) && up(p) && up(pp)) push(k, 6, 1); else if (dn(b) && dn(p) && dn(pp)) push(k, 6, -1);
      }
      if (atr > 0 && b.h - b.l >= 2 * atr) push(k, 7, b.c >= b.o ? 1 : -1); // 7 big candle
      if (!gapDone && k === 0 && !Number.isNaN(pdc) && prevRange > 0) {  // 8 gap (follow = gap direction)
        gapDone = true;
        const gap = open - pdc;
        if (Math.abs(gap) >= 0.25 * prevRange) push(k, 8, Math.sign(gap));
      }
      if (k >= 12 && k < 72) {                                         // 9 first-hour break
        if (!fhLong && b.c > fhH) { fhLong = true; push(k, 9, 1); }
        if (!fhShort && b.c < fhL) { fhShort = true; push(k, 9, -1); }
      }
      vwapPrev = vwap; prevC5 = b.c;
    }
    // prior-day levels for tomorrow
    let hi = -Infinity, lo = Infinity;
    for (const b of b5) if (!Number.isNaN(b.o)) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); }
    pdh = hi; pdl = lo; pdc = s.c[d.start + d.n - 1]; prevRange = hi - lo;
    if (atrN) dayAtrs.push(atrSum / atrN);
  });
  return { evs, days };
}

interface Agg { n: Int32Array; sum: Float64Array; wins: Int32Array; }
const mkAgg = (): Agg => ({ n: new Int32Array(SIZE), sum: new Float64Array(SIZE), wins: new Int32Array(SIZE) });

function aggregate(evs: Ev2[], days: Store['days'], split: (di: number) => 0 | 1 | 2, flip?: () => boolean) {
  const A = [mkAgg(), mkAgg(), mkAgg()];
  const tb = (m: number) => { for (let t = 1; t < NT; t++) if (m >= TIMES[t].a && m < TIMES[t].b) return t; return 0; };
  for (const e of evs) {
    const sp = split(e.day), agg = A[sp];
    const t = tb(e.min - 5), w = days[e.day].wd + 1;
    for (let mode = 0; mode < 2; mode++) {
      // the real search tests both modes; the luck run gives each event ONE random mode, so a
      // pattern's follow and fade both get coin-flip trades
      const useFade = flip ? flip() : mode === 1;
      const r = useFade ? e.rFade : e.r;
      const trRel = e.tr === 0 ? 0 : useFade ? (e.tr === 1 ? 2 : 1) : e.tr;
      for (const tt of t ? [0, t] : [0]) for (const ww of [0, w]) for (const trr of trRel === 0 ? [0] : [0, trRel]) for (const vv of [0, e.vol]) {
        for (let si = 0; si < NS; si++) for (let gi = 0; gi < NG; gi++) {
          const k = keyOf(e.pat, mode, tt, ww, trr, vv, si, gi);
          const x = r[si * NG + gi];
          agg.n[k]++; agg.sum[k] += x; if (x > 0) agg.wins[k]++;
        }
      }
    }
  }
  return A;
}

function survivors(A: Agg[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < SIZE; k++) {
    const nd = A[0].n[k], nv = A[1].n[k];
    if (nd >= MIN_DISC_N && nv >= MIN_VAL_N && A[0].sum[k] / nd >= DISC_MIN && A[1].sum[k] / nv > VAL_MIN) out.push(k);
  }
  return out;
}

function decode(k: number) {
  const g = k % NG; k = Math.floor(k / NG);
  const s = k % NS; k = Math.floor(k / NS);
  const v = k % NV; k = Math.floor(k / NV);
  const tr = k % NTR; k = Math.floor(k / NTR);
  const w = k % NW; k = Math.floor(k / NW);
  const t = k % NT; k = Math.floor(k / NT);
  const m = k % NM; const p = Math.floor(k / NM);
  return { p, m, t, w, tr, v, s, g };
}

export interface Candidate {
  key: number; pattern: string; mode: string; time: string; weekday: string; trend: string; vol: string;
  stopAtr: number; targetR: number; rule: string; avgStopPts: number;
  disc: { n: number; avgR: number; win: number }; val: { n: number; avgR: number; win: number }; hold: { n: number; avgR: number; win: number };
  perDay: number; maxLosingStreak: number; maxDdR: number;
  trades: [string, number, number, number][];   // [date, minute after 9:30, dir, R]
}
export interface EdgeResult {
  runAt: string; secs: number; days: number; from: string; to: string; splits: [string, string];
  tested: number; events: number; survivors: number; luck: number; verdict: string;
  candidates: Candidate[]; patterns: typeof PATTERNS; settings: Record<string, unknown>;
}

let running: Promise<EdgeResult> | null = null;
let progress = '';
export const edgeStatus = () => ({ running: !!running, progress });

export async function latest(): Promise<EdgeResult | null> {
  await pool.query(`CREATE TABLE IF NOT EXISTS edge_runs (id SERIAL PRIMARY KEY, run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result JSONB NOT NULL)`);
  const r = await pool.query('SELECT result FROM edge_runs ORDER BY id DESC LIMIT 1');
  return r.rows[0]?.result ?? null;
}

export function startHunt(): Promise<EdgeResult> {
  if (running) return running;
  running = hunt().finally(() => { running = null; });
  return running;
}

async function hunt(): Promise<EdgeResult> {
  const t0 = Date.now();
  progress = 'Loading 5 years of 1-minute bars…';
  const s = await load();
  progress = 'Finding every pattern and walking every trade…';
  await new Promise(r => setImmediate(r));
  const { evs, days } = events(s);
  const n = days.length, c1 = Math.floor(n * 0.5), c2 = Math.floor(n * 0.75);
  const split = (di: number): 0 | 1 | 2 => (di < c1 ? 0 : di < c2 ? 1 : 2);
  progress = `Testing ${SIZE.toLocaleString()} rule combinations on ${evs.length.toLocaleString()} events…`;
  await new Promise(r => setImmediate(r));
  const A = aggregate(evs, days, split);
  const surv = survivors(A);
  // luck baseline: same search, coin-flip directions (3 runs, averaged)
  let luck = 0;
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 < 0.5;
  for (let run = 0; run < 3; run++) {
    progress = `Luck baseline ${run + 1}/3…`;
    await new Promise(r => setImmediate(r));
    luck += survivors(aggregate(evs, days, split, rnd)).length;
  }
  luck = Math.round(luck / 3);

  // best survivors: rank by the weaker of discovery / validation; one per pattern+mode+exit family
  const score = (k: number) => Math.min(A[0].sum[k] / A[0].n[k], A[1].sum[k] / A[1].n[k]);
  const ranked = surv.sort((a, b) => score(b) - score(a));
  const seen = new Set<string>();
  const top: number[] = [];
  for (const k of ranked) {
    const d = decode(k);
    const fam = `${d.p}|${d.m}|${d.t}|${d.w}`;
    if (seen.has(fam)) continue;
    seen.add(fam); top.push(k);
    if (top.length >= 25) break;
  }
  const tbOf = (m: number) => { for (let t = 1; t < NT; t++) if (m >= TIMES[t].a && m < TIMES[t].b) return t; return 0; };
  const st = (agg: Agg, k: number) => ({ n: agg.n[k], avgR: agg.n[k] ? Math.round((agg.sum[k] / agg.n[k]) * 1000) / 1000 : 0, win: agg.n[k] ? Math.round((agg.wins[k] / agg.n[k]) * 1000) / 1000 : 0 });
  const candidates: Candidate[] = top.map(k => {
    const d = decode(k);
    const P = PATTERNS[d.p];
    const trades: [string, number, number, number][] = [];
    let stopSum = 0;
    for (const e of evs) {
      if (e.pat !== d.p) continue;
      const fade = d.m === 1;
      const trRel = e.tr === 0 ? 0 : fade ? (e.tr === 1 ? 2 : 1) : e.tr;
      if (d.t && tbOf(e.min - 5) !== d.t) continue;
      if (d.w && days[e.day].wd + 1 !== d.w) continue;
      if (d.tr && trRel !== d.tr) continue;
      if (d.v && e.vol !== d.v) continue;
      const r = (fade ? e.rFade : e.r)[d.s * NG + d.g];
      trades.push([days[e.day].date, e.min, fade ? -e.dir : e.dir, Math.round(r * 1000) / 1000]);
      stopSum += Math.max(2, STOPS[d.s] * e.atr);
    }
    let streak = 0, worst = 0, eq = 0, peak = 0, dd = 0;
    for (const t of trades) { if (t[3] <= 0) { streak++; worst = Math.max(worst, streak); } else streak = 0; eq += t[3]; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
    const tradeDays = new Set(trades.map(t => t[0])).size;
    const parts = [P.name, d.m === 1 ? '— FADE it' : '— follow it', TIMES[d.t].k === 'any' ? '' : `, ${TIMES[d.t].label} ET`, d.w ? `, ${WDS[d.w]} only` : '',
      d.tr ? `, ${TRENDS[d.tr]}` : '', d.v ? `, ${VOLS[d.v]}` : ''];
    return {
      key: k, pattern: P.name, mode: MODES[d.m], time: TIMES[d.t].label, weekday: WDS[d.w], trend: TRENDS[d.tr], vol: VOLS[d.v],
      stopAtr: STOPS[d.s], targetR: TARGETS[d.g],
      rule: `${parts.join('')}. Stop ${STOPS[d.s]} x ATR(5m) (≈${Math.round(stopSum / Math.max(1, trades.length))} pt), target ${TARGETS[d.g]}R, out after ${HOLD} min.`,
      avgStopPts: Math.round((stopSum / Math.max(1, trades.length)) * 10) / 10,
      disc: st(A[0], k), val: st(A[1], k), hold: st(A[2], k),
      perDay: Math.round((trades.length / Math.max(1, n)) * 100) / 100, maxLosingStreak: worst, maxDdR: Math.round(dd * 10) / 10,
      trades: trades.slice(-1500),
    };
  });
  const holdPos = candidates.filter(c => c.hold.n >= 20 && c.hold.avgR > 0).length;
  const verdict = surv.length <= luck * 1.5
    ? `No reliable pattern: the search found ${surv.length} rules that pass discovery + validation, and coin-flip directions give about ${luck}. Treat every rule below as probably luck.`
    : `${surv.length} rules passed discovery + validation vs about ${luck} by luck — more than chance. ${holdPos} of the top ${candidates.length} are also positive on the untouched holdout. Next step: a pre-registered forward test of the best one.`;
  const result: EdgeResult = {
    runAt: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000), days: n, from: days[0].date, to: days[n - 1].date,
    splits: [days[c1].date, days[c2].date], tested: SIZE, events: evs.length, survivors: surv.length, luck, verdict, candidates,
    patterns: PATTERNS,
    settings: { stops: STOPS, targets: TARGETS, holdMin: HOLD, costPts: COST_PTS, minDiscN: MIN_DISC_N, discMinR: DISC_MIN, minValN: MIN_VAL_N },
  };
  await latest(); // makes sure the table exists
  await pool.query('INSERT INTO edge_runs (result) VALUES ($1)', [JSON.stringify(result)]);
  await pool.query('DELETE FROM edge_runs WHERE id NOT IN (SELECT id FROM edge_runs ORDER BY id DESC LIMIT 3)'); // keep the last 3 runs
  progress = '';
  return result;
}
