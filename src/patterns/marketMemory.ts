// Market Memory: "remember every candle" views over the NQ 1-minute history (New York session 9:30-16:00 ET).
//   1. dayMap       : all past days merged minute by minute -> the typical path, when big moves happen,
//                     when the high / low of day prints; older vs newer half to show whether it repeats.
//   2. analog       : for one moment, find the past days whose candles looked most alike at the same time of
//                     day (1m path shape + 5m candle shapes + position vs open / VWAP + volatility), show what
//                     happened next, and score the method honestly on days it had not seen (walk-forward),
//                     against "always long" and after costs.
//   3. candleStats  : classify every 1/3/5/15m candle (doji, hammer, engulfing, inside, big bar, ...), show at
//                     which times each forms and what the next candles do, vs the normal candle at that time;
//                     a shuffled-outcome luck baseline says how many "patterns" chance alone produces.
// No look-ahead: features use only bars that closed before the moment; analog memory = earlier days only.
import type { Store } from './timeScan';

export const SESSION_MIN = 390;          // 9:30 -> 16:00
const COST_PTS = 3.5 / 20 + 0.5;         // NQ round trip $3.50 + 0.5 pt slippage, in points

// ------------------------------------------------------------------ grid (one row of 390 minutes per day)
export interface Grid {
  key: number; D: number; dates: string[]; wd: Int8Array;
  O: Float64Array; H: Float64Array; L: Float64Array; C: Float64Array; V: Float64Array; VW: Float64Array; // D*390
  open: Float64Array; close: Float64Array; high: Float64Array; low: Float64Array;
  gap: Float64Array;      // open - previous day's 16:00 close (NaN for the first day)
  atr: Float64Array;      // average daily range (high-low) of the previous 20 days (NaN until 20 days)
}

let gridCache: Grid | null = null;

export function buildGrid(s: Store): Grid {
  if (gridCache && gridCache.key === s.loadedAt) return gridCache;
  const D = s.days.length, N = D * SESSION_MIN;
  const g: Grid = {
    key: s.loadedAt, D, dates: s.days.map(d => d.date), wd: Int8Array.from(s.days, d => d.wd),
    O: new Float64Array(N), H: new Float64Array(N), L: new Float64Array(N), C: new Float64Array(N), V: new Float64Array(N), VW: new Float64Array(N),
    open: new Float64Array(D), close: new Float64Array(D), high: new Float64Array(D), low: new Float64Array(D),
    gap: new Float64Array(D).fill(NaN), atr: new Float64Array(D).fill(NaN),
  };
  for (let di = 0; di < D; di++) {
    const d = s.days[di], base = di * SESSION_MIN;
    const filled = new Uint8Array(SESSION_MIN);
    for (let i = d.start; i < d.start + d.n; i++) {
      const k = s.m[i] - 570;
      if (k < 0 || k >= SESSION_MIN) continue;
      g.O[base + k] = s.o[i]; g.H[base + k] = s.h[i]; g.L[base + k] = s.l[i]; g.C[base + k] = s.c[i]; g.V[base + k] = s.v[i];
      filled[k] = 1;
    }
    // forward-fill missing minutes (flat bar at the last close, no volume)
    let first = filled.indexOf(1);
    if (first < 0) first = 0;
    for (let k = 0; k < SESSION_MIN; k++) {
      if (filled[k]) continue;
      const src = k === 0 ? base + first : base + k - 1;
      const p = k === 0 ? g.O[src] : g.C[src];
      g.O[base + k] = g.H[base + k] = g.L[base + k] = g.C[base + k] = p; g.V[base + k] = 0;
    }
    let pv = 0, vv = 0, hi = -Infinity, lo = Infinity;
    for (let k = 0; k < SESSION_MIN; k++) {
      const j = base + k, tp = (g.H[j] + g.L[j] + g.C[j]) / 3;
      pv += tp * g.V[j]; vv += g.V[j];
      g.VW[j] = vv > 0 ? pv / vv : tp;
      if (g.H[j] > hi) hi = g.H[j]; if (g.L[j] < lo) lo = g.L[j];
    }
    g.open[di] = g.O[base]; g.close[di] = g.C[base + SESSION_MIN - 1]; g.high[di] = hi; g.low[di] = lo;
    if (di > 0) g.gap[di] = g.open[di] - g.close[di - 1];
    if (di >= 20) { let r = 0; for (let x = di - 20; x < di; x++) r += g.high[x] - g.low[x]; g.atr[di] = r / 20; }
  }
  gridCache = g;
  return g;
}

const hhmm = (k: number) => { const t = 570 + k; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
function pct(sorted: number[], q: number) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * q, a = Math.floor(i), b = Math.ceil(i); return sorted[a] + (sorted[b] - sorted[a]) * (i - a); }
function corr(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length); if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

// ------------------------------------------------------------------ 1. average day map
export type GapFilter = 'all' | 'up' | 'down' | 'flat';
export type DayTypeFilter = 'all' | 'trend' | 'range';
export interface DayMapParams { wd: number; gap: GapFilter; dayType: DayTypeFilter; unit: 'pts' | 'atr'; from?: string; to?: string; }

function gapClass(g: Grid, di: number): GapFilter {
  const a = g.atr[di], x = g.gap[di];
  if (!isFinite(a) || !isFinite(x)) return 'all';
  return Math.abs(x) < 0.1 * a ? 'flat' : x > 0 ? 'up' : 'down';
}
/** Hindsight label (known only after the close): trend = |close - open| >= 50% of the day's range. */
function dayType(g: Grid, di: number): 'trend' | 'range' {
  const r = g.high[di] - g.low[di];
  return r > 0 && Math.abs(g.close[di] - g.open[di]) >= 0.5 * r ? 'trend' : 'range';
}

export function dayMap(g: Grid, p: DayMapParams) {
  const sel: number[] = [];
  for (let di = 20; di < g.D; di++) {
    if (p.wd >= 0 && g.wd[di] !== p.wd) continue;
    if (p.from && g.dates[di] < p.from) continue;
    if (p.to && g.dates[di] > p.to) continue;
    if (p.gap !== 'all' && gapClass(g, di) !== p.gap) continue;
    if (p.dayType !== 'all' && dayType(g, di) !== p.dayType) continue;
    sel.push(di);
  }
  const n = sel.length, half = Math.floor(n / 2);
  const mean = new Array(SESSION_MIN).fill(0), older = new Array(SESSION_MIN).fill(0), newer = new Array(SESSION_MIN).fill(0);
  const p25: number[] = [], p50: number[] = [], p75: number[] = [], upFrac: number[] = [], absMove = new Array(SESSION_MIN).fill(0);
  const hod = new Array(26).fill(0), lod = new Array(26).fill(0);
  const col: number[][] = Array.from({ length: SESSION_MIN }, () => []);
  for (let s = 0; s < n; s++) {
    const di = sel[s], base = di * SESSION_MIN, scale = p.unit === 'atr' ? 1 / g.atr[di] : 1;
    let hk = 0, lk = 0;
    for (let k = 0; k < SESSION_MIN; k++) {
      const v = (g.C[base + k] - g.open[di]) * scale;
      col[k].push(v); mean[k] += v;
      if (s < half) older[k] += v; else newer[k] += v;
      absMove[k] += Math.abs(g.C[base + k] - (k ? g.C[base + k - 1] : g.O[base])) * scale;
      if (g.H[base + k] > g.H[base + hk]) hk = k;
      if (g.L[base + k] < g.L[base + lk]) lk = k;
    }
    hod[Math.floor(hk / 15)]++; lod[Math.floor(lk / 15)]++;
  }
  for (let k = 0; k < SESSION_MIN; k++) {
    const c = col[k].sort((a, b) => a - b);
    mean[k] = n ? mean[k] / n : 0; older[k] = half ? older[k] / half : 0; newer[k] = n - half ? newer[k] / (n - half) : 0;
    p25.push(pct(c, 0.25)); p50.push(pct(c, 0.5)); p75.push(pct(c, 0.75));
    upFrac.push(n ? c.filter(x => x > 0).length / n : 0);
    absMove[k] = n ? absMove[k] / n : 0;
  }
  const avgAbs = absMove.reduce((a, b) => a + b, 0) / SESSION_MIN;
  const bigMinutes = absMove.map((v, k) => ({ time: hhmm(k), x: v / (avgAbs || 1) })).sort((a, b) => b.x - a.x).slice(0, 10).map(b => ({ time: b.time, vsAvg: r2(b.x) }));
  const step = 5; // send every 5th minute for the paths (78 points) to keep the response small
  const pick = (a: number[], f = r2) => a.filter((_, k) => k % step === 0 || k === SESSION_MIN - 1).map(f);
  return {
    params: p, days: n, from: n ? g.dates[sel[0]] : null, to: n ? g.dates[sel[n - 1]] : null,
    olderTo: half ? g.dates[sel[half - 1]] : null,
    unit: p.unit, times: pick(Array.from({ length: SESSION_MIN }, (_, k) => k), k => k).map(hhmm),
    mean: pick(mean), p25: pick(p25), p50: pick(p50), p75: pick(p75), older: pick(older), newer: pick(newer), upFrac: pick(upFrac, r3),
    // does the typical path repeat? correlation of the older-half and newer-half average paths (1 = same shape)
    repeatScore: r2(corr(older, newer)),
    absMove: absMove.map(r3), bigMinutes,
    hodByQuarterHour: hod.map(x => r3(n ? x / n : 0)), lodByQuarterHour: lod.map(x => r3(n ? x / n : 0)),
    quarterHours: Array.from({ length: 26 }, (_, i) => hhmm(i * 15)),
    note: p.dayType !== 'all' ? 'Trend / range day is only known after the close (hindsight filter): use it to study, not to trade.' : null,
  };
}

// ------------------------------------------------------------------ 2. look-alike (analog) finder
export interface AnalogParams { date?: string; time?: string; lookback: number; ahead: number; k: number; tol: number; }

/** Fills `out` with the feature vector; returns how many numbers were written (0 = not enough history). */
function features(g: Grid, di: number, m: number, L: number, out: Float64Array): number {
  // moment m = minute index of the entry (bars 0..m-1 have closed); window = bars [m-L, m-1]
  const base = di * SESSION_MIN, a = base + m - L, b = base + m - 1, atr = g.atr[di];
  if (m - L < 0 || !isFinite(atr) || atr <= 0) return 0;
  let hi = -Infinity, lo = Infinity;
  for (let j = a; j <= b; j++) { if (g.H[j] > hi) hi = g.H[j]; if (g.L[j] < lo) lo = g.L[j]; }
  const R = Math.max(hi - lo, 1), o0 = g.O[a];
  let f = 0;
  const stride = Math.max(1, Math.round(L / 60));
  for (let j = a + stride - 1; j <= b; j += stride) out[f++] = (g.C[j] - o0) / R;                // 1m path shape
  for (let s = a; s + 4 <= b; s += 5) {                                                             // 5m candle shapes
    const o = g.O[s], c = g.C[s + 4];
    let h = -Infinity, l = Infinity; for (let j = s; j < s + 5; j++) { if (g.H[j] > h) h = g.H[j]; if (g.L[j] < l) l = g.L[j]; }
    out[f++] = 0.7 * (c - o) / R; out[f++] = 0.7 * (h - Math.max(o, c)) / R; out[f++] = 0.7 * (Math.min(o, c) - l) / R;
  }
  const px = g.C[b];
  out[f++] = 1.5 * (px - g.open[di]) / atr;                                                         // where price is vs the open
  out[f++] = 1.5 * (px - g.VW[b]) / atr;                                                            // vs VWAP
  out[f++] = 1.5 * Math.log(R / (atr * Math.sqrt(L / SESSION_MIN)));                                // volatility of the window
  out[f++] = 1.0 * (isFinite(g.gap[di]) ? g.gap[di] / atr : 0);                                     // opening gap
  return f;
}

function dist(a: Float64Array, b: Float64Array, n: number, cutoff: number) {
  let s = 0; for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; if (s > cutoff) return Infinity; } return s;
}

interface Match { di: number; m: number; d2: number; }

function topMatches(g: Grid, qdi: number, qm: number, L: number, A: number, k: number, tol: number, step: number, qf: Float64Array, nf: number, memEnd: number): Match[] {
  const buf = new Float64Array(qf.length);
  const best: Match[] = [];
  let worst = Infinity;
  for (let di = 20; di < memEnd; di++) {
    if (di === qdi) continue;
    let dayBest: Match | null = null;
    for (let m = Math.max(L, qm - tol); m <= Math.min(SESSION_MIN - A, qm + tol); m += step) {
      if (!features(g, di, m, L, buf)) break;
      const d2 = dist(qf, buf, nf, dayBest ? Math.min(dayBest.d2, worst) : worst);
      if (d2 < Infinity && (!dayBest || d2 < dayBest.d2)) dayBest = { di, m, d2 };
    }
    if (!dayBest) continue;
    if (best.length < k) { best.push(dayBest); if (best.length === k) { best.sort((x, y) => x.d2 - y.d2); worst = best[k - 1].d2; } }
    else if (dayBest.d2 < worst) { best[k - 1] = dayBest; best.sort((x, y) => x.d2 - y.d2); worst = best[k - 1].d2; }
  }
  return best.sort((x, y) => x.d2 - y.d2);
}

function outcome(g: Grid, di: number, m: number, A: number, scale: number) {
  const base = di * SESSION_MIN, e = g.C[base + m - 1];
  const path: number[] = [];
  let mfe = 0, mae = 0;
  for (let j = 1; j <= A; j++) {
    const x = (g.C[base + m - 1 + j] - e) * scale; path.push(x);
    mfe = Math.max(mfe, (g.H[base + m - 1 + j] - e) * scale); mae = Math.min(mae, (g.L[base + m - 1 + j] - e) * scale);
  }
  return { path, end: path[A - 1], mfe, mae };
}

const accCache = new Map<string, any>();

export function analog(g: Grid, p: AnalogParams) {
  const L = Math.max(10, Math.min(180, Math.round(p.lookback))), k = Math.max(10, Math.min(100, Math.round(p.k))), tol = Math.max(0, Math.min(30, Math.round(p.tol)));
  let qdi = p.date ? g.dates.indexOf(p.date) : g.D - 1;
  if (qdi < 0) throw Object.assign(new Error('No New York session for that date in the data (weekends, holidays and half days are skipped).'), { status: 400 });
  if (qdi < 40) throw Object.assign(new Error('Pick a later date (the first 40 days are needed as memory).'), { status: 400 });
  const tm = /^(\d{1,2}):(\d{2})$/.exec(p.time || '10:30');
  if (!tm) throw Object.assign(new Error('time must be H:MM (ET)'), { status: 400 });
  const qm = Number(tm[1]) * 60 + Number(tm[2]) - 570;
  if (qm < L || qm > SESSION_MIN - 5) throw Object.assign(new Error(`time must be between ${hhmm(L)} and ${hhmm(SESSION_MIN - 5)} ET for a ${L}-minute look-back`), { status: 400 });
  const A = Math.max(5, Math.min(SESSION_MIN - qm, Math.round(p.ahead)));

  const qf = new Float64Array(400);
  const nf = features(g, qdi, qm, L, qf);
  if (!nf) throw Object.assign(new Error('Not enough history before that day.'), { status: 400 });

  const matches = topMatches(g, qdi, qm, L, A, k, tol, 1, qf, nf, qdi); // memory = earlier days only
  const qatr = g.atr[qdi];
  const outs = matches.map(mt => ({ mt, o: outcome(g, mt.di, mt.m, A, qatr / g.atr[mt.di]) }));
  const ends = outs.map(x => x.o.end).sort((a, b) => a - b);
  const fan = { p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[] };
  for (let j = 0; j < A; j++) {
    const col = outs.map(x => x.o.path[j]).sort((a, b) => a - b);
    fan.p10.push(r1(pct(col, 0.1))); fan.p25.push(r1(pct(col, 0.25))); fan.p50.push(r1(pct(col, 0.5))); fan.p75.push(r1(pct(col, 0.75))); fan.p90.push(r1(pct(col, 0.9)));
  }
  const up = ends.filter(x => x > 0).length / (ends.length || 1);
  const mean = ends.reduce((a, b) => a + b, 0) / (ends.length || 1);

  // the query window (+ what actually happened, if that day is in the past)
  const qb = qdi * SESSION_MIN, entry = g.C[qb + qm - 1];
  const qWindow = Array.from({ length: L }, (_, i) => r1(g.C[qb + qm - L + i] - entry));
  const actual = qm - 1 + A <= SESSION_MIN - 1 && qdi < g.D ? outcome(g, qdi, qm, A, 1) : null;
  const overlays = outs.slice(0, 12).map(({ mt }) => {
    const b = mt.di * SESSION_MIN, e = g.C[b + mt.m - 1], sc = qatr / g.atr[mt.di];
    return { date: g.dates[mt.di], path: Array.from({ length: L + A }, (_, i) => r1((g.C[b + mt.m - L + i] - e) * sc)) };
  });

  return {
    params: { date: g.dates[qdi], time: hhmm(qm), lookback: L, ahead: A, k, tol },
    entryPrice: r2(entry), atr: r1(qatr), memoryDays: qdi - 20,
    next: { up: r3(up), mean: r1(mean), median: r1(pct(ends, 0.5)), p10: r1(pct(ends, 0.1)), p90: r1(pct(ends, 0.9)),
      avgBestRun: r1(outs.reduce((a, x) => a + x.o.mfe, 0) / (outs.length || 1)), avgWorstRun: r1(outs.reduce((a, x) => a + x.o.mae, 0) / (outs.length || 1)) },
    fan, qWindow, actual: actual ? { end: r1(actual.end), path: actual.path.map(r1) } : null,
    overlays,
    matches: outs.map(({ mt, o }) => ({ date: g.dates[mt.di], wd: g.wd[mt.di], time: hhmm(mt.m), similarity: Math.round(100 / (1 + Math.sqrt(mt.d2 / Math.max(nf, 1)))), next: r1(o.end), best: r1(o.mfe), worst: r1(o.mae) })),
    accuracy: accuracy(g, qm, L, A, k, tol),
    unitNote: 'Moves are NQ points, rescaled to this day\'s volatility (past day move x this day\'s 20-day range / that day\'s).',
  };
}

/** Walk-forward score of the method at this time of day: newest 40% of days, each using only earlier days. */
export function accuracy(g: Grid, qm: number, L: number, A: number, k: number, tol: number) {
  const key = `${g.key}|${qm}|${L}|${A}|${k}|${tol}`;
  if (accCache.has(key)) return accCache.get(key);
  const start = Math.floor(g.D * 0.6), test: number[] = [];
  const want = Math.min(200, g.D - start), stride = (g.D - start) / Math.max(want, 1);
  for (let i = 0; i < want; i++) test.push(Math.min(g.D - 1, start + Math.floor(i * stride)));
  const qf = new Float64Array(400);
  let trades = 0, wins = 0, sum = 0, sum2 = 0, longSum = 0, longN = 0, skipped = 0;
  for (const di of test) {
    const nf = qm - 1 + A > SESSION_MIN - 1 ? 0 : features(g, di, qm, L, qf);
    if (!nf) continue;
    const ms = topMatches(g, di, qm, L, A, k, tol, Math.max(1, Math.ceil(tol / 3) || 1), qf, nf, di);
    if (ms.length < k / 2) continue;
    const ends = ms.map(mt => outcome(g, mt.di, mt.m, A, g.atr[di] / g.atr[mt.di]).end);
    const upF = ends.filter(x => x > 0).length / ends.length;
    const real = outcome(g, di, qm, A, 1).end;
    longSum += real - COST_PTS; longN++;
    if (upF >= 0.6 || upF <= 0.4) {
      const dir = upF >= 0.6 ? 1 : -1, net = dir * real - COST_PTS;
      trades++; sum += net; sum2 += net * net; if (net > 0) wins++;
    } else skipped++;
  }
  const avg = trades ? sum / trades : 0, sd = trades > 1 ? Math.sqrt(Math.max(0, sum2 / trades - avg * avg) * trades / (trades - 1)) : 0;
  const t = sd > 0 ? avg / (sd / Math.sqrt(trades)) : 0;
  const longAvg = longN ? longSum / longN : 0;
  const verdict = trades < 30 ? 'Too few signals to judge.'
    : t >= 3 && avg > longAvg ? 'Looks real: beats costs and "always long" with t >= 3. Paper-test it before trusting it.'
    : avg > 0 && avg > longAvg ? 'Slightly positive but weak (t < 3): could easily be luck.'
    : 'No edge: after costs it does not beat a coin flip / "always long" at this time.';
  const res = { testDays: test.length, from: g.dates[test[0]], to: g.dates[test[test.length - 1]], rule: 'long if >= 60% of look-alikes went up, short if <= 40%, else no trade; exit after the look-ahead; costs 0.675 pt',
    trades, skipped, winRate: r3(trades ? wins / trades : 0), avgPts: r2(avg), tStat: r2(t), alwaysLongAvgPts: r2(longAvg), verdict };
  accCache.set(key, res);
  if (accCache.size > 200) accCache.delete(accCache.keys().next().value as string);
  return res;
}

// ------------------------------------------------------------------ 3. candle-at-time stats
export const CANDLE_TYPES: Record<string, string> = {
  doji: 'Doji (tiny body)', hammer: 'Hammer (long lower wick)', star: 'Shooting star (long upper wick)',
  bullEngulf: 'Bullish engulfing', bearEngulf: 'Bearish engulfing', inside: 'Inside bar', outside: 'Outside bar',
  bigBull: 'Big green candle (2x normal body)', bigBear: 'Big red candle (2x normal body)',
  threeBull: 'Three green in a row', threeBear: 'Three red in a row',
};
const TYPE_KEYS = Object.keys(CANDLE_TYPES);

export function classify(o: number[], h: number[], l: number[], c: number[], i: number, avgBody: number): string[] {
  const out: string[] = [];
  const body = Math.abs(c[i] - o[i]), range = h[i] - l[i], up = h[i] - Math.max(o[i], c[i]), dn = Math.min(o[i], c[i]) - l[i];
  if (range <= 0) return out;
  if (body <= 0.1 * range) out.push('doji');
  if (dn >= 0.6 * range && up <= 0.15 * range) out.push('hammer');
  if (up >= 0.6 * range && dn <= 0.15 * range) out.push('star');
  if (i >= 1) {
    const pBull = c[i - 1] > o[i - 1], pBear = c[i - 1] < o[i - 1];
    if (pBear && c[i] > o[i] && c[i] >= o[i - 1] && o[i] <= c[i - 1] && body > Math.abs(c[i - 1] - o[i - 1])) out.push('bullEngulf');
    if (pBull && c[i] < o[i] && c[i] <= o[i - 1] && o[i] >= c[i - 1] && body > Math.abs(c[i - 1] - o[i - 1])) out.push('bearEngulf');
    if (h[i] < h[i - 1] && l[i] > l[i - 1]) out.push('inside');
    if (h[i] > h[i - 1] && l[i] < l[i - 1]) out.push('outside');
  }
  if (avgBody > 0 && body >= 2 * avgBody) out.push(c[i] > o[i] ? 'bigBull' : c[i] < o[i] ? 'bigBear' : '');
  if (i >= 2 && c[i] > o[i] && c[i - 1] > o[i - 1] && c[i - 2] > o[i - 2]) out.push('threeBull');
  if (i >= 2 && c[i] < o[i] && c[i - 1] < o[i - 1] && c[i - 2] < o[i - 2]) out.push('threeBear');
  return out.filter(Boolean);
}

interface Cell { n: number; up: number; sum: number; nO: number; sumO: number; sqO: number; nN: number; sumN: number; sqN: number; }
const newCell = (): Cell => ({ n: 0, up: 0, sum: 0, nO: 0, sumO: 0, sqO: 0, nN: 0, sumN: 0, sqN: 0 });

export function candleStats(g: Grid, p: { tf: number; next: number }, seed = 7) {
  const tf = [1, 3, 5, 15].includes(p.tf) ? p.tf : 5, nx = Math.max(1, Math.min(12, Math.round(p.next)));
  const perDay = Math.floor(SESSION_MIN / tf), half = Math.floor((g.D - 20) / 2) + 20;
  type Ev = { slot: number; ti: number; move: number; older: boolean };
  const evs: Ev[] = [];
  const base: Cell[] = Array.from({ length: 26 }, newCell);
  let bodySum = 0; const bodyWin: number[] = [];
  for (let di = 20; di < g.D; di++) {
    const b = di * SESSION_MIN, o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [];
    for (let s = 0; s < perDay; s++) {
      const a = b + s * tf;
      let hi = -Infinity, lo = Infinity; for (let j = a; j < a + tf; j++) { if (g.H[j] > hi) hi = g.H[j]; if (g.L[j] < lo) lo = g.L[j]; }
      o.push(g.O[a]); h.push(hi); l.push(lo); c.push(g.C[a + tf - 1]);
    }
    for (let s = 0; s < perDay; s++) {
      const avgBody = bodyWin.length ? bodySum / bodyWin.length : 0;
      const types = classify(o, h, l, c, s, avgBody);
      const bd = Math.abs(c[s] - o[s]); bodyWin.push(bd); bodySum += bd; if (bodyWin.length > 20) bodySum -= bodyWin.shift()!;
      if (s + nx >= perDay) continue;
      const move = c[s + nx] - c[s], slot = Math.floor((s * tf) / 15), older = di < half;
      const bc = base[slot]; bc.n++; bc.sum += move; if (move > 0) bc.up++; if (older) { bc.nO++; bc.sumO += move; bc.sqO += move * move; } else { bc.nN++; bc.sumN += move; bc.sqN += move * move; }
      for (const t of types) evs.push({ slot, ti: TYPE_KEYS.indexOf(t), move, older });
    }
  }
  // per type x slot, and per type for all times
  const tally = (moves: (e: Ev) => number) => {
    const cells: Cell[][] = TYPE_KEYS.map(() => Array.from({ length: 27 }, newCell)); // slot 26 = all times
    for (const e of evs) {
      const mv = moves(e);
      for (const s of [e.slot, 26]) {
        const x = cells[e.ti][s]; x.n++; x.sum += mv; if (mv > 0) x.up++;
        if (e.older) { x.nO++; x.sumO += mv; x.sqO += mv * mv; } else { x.nN++; x.sumN += mv; x.sqN += mv * mv; }
      }
    }
    return cells;
  };
  const baseAll = base.reduce((a, x) => ({ n: a.n + x.n, sum: a.sum + x.sum, up: a.up + x.up, nO: a.nO + x.nO, sumO: a.sumO + x.sumO, sqO: a.sqO + x.sqO, nN: a.nN + x.nN, sumN: a.sumN + x.sumN, sqN: a.sqN + x.sqN }), newCell());
  const baseOf = (s: number) => (s === 26 ? baseAll : base[s]);
  // edge vs the normal candle at that time, and its t-stat, inside one half of the days
  const half_t = (n: number, sum: number, sq: number, bN: number, bSum: number) => {
    if (n < 2) return { e: 0, t: 0 };
    const m = sum / n, sd = Math.sqrt(Math.max(0, (sq - n * m * m) / (n - 1))), e = m - bSum / Math.max(bN, 1);
    return { e, t: sd > 0 ? e / (sd / Math.sqrt(n)) : 0 };
  };
  const repeats = (x: Cell, s: number) => {
    const bb = baseOf(s);
    if (x.nO < 30 || x.nN < 30) return 0;
    const O = half_t(x.nO, x.sumO, x.sqO, bb.nO, bb.sumO), N = half_t(x.nN, x.sumN, x.sqN, bb.nN, bb.sumN);
    const ok = Math.sign(O.e) === Math.sign(N.e) && Math.abs(O.e) > COST_PTS && Math.abs(N.e) > COST_PTS && Math.abs(O.t) >= 2 && Math.abs(N.t) >= 2;
    return ok ? Math.sign(N.e) : 0;
  };
  const real = tally(e => e.move);
  // luck baseline: give every event the outcome of a random candle from the same time slot (any type), same test
  let sd = seed; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const pool: number[][] = Array.from({ length: 26 }, () => []);
  for (const e of evs) pool[e.slot].push(e.move);
  const fake = tally(e => { const pl = pool[e.slot]; return pl[Math.floor(rnd() * pl.length)]; });
  let tested = 0, found = 0, luck = 0;
  for (let t = 0; t < TYPE_KEYS.length; t++) for (let s = 0; s < 26; s++) {
    if (real[t][s].nO >= 30 && real[t][s].nN >= 30) tested++;
    if (repeats(real[t][s], s)) found++;
    if (repeats(fake[t][s], s)) luck++;
  }
  const quarter = Array.from({ length: 26 }, (_, i) => hhmm(i * 15));
  const out = TYPE_KEYS.map((key, t) => ({
    key, name: CANDLE_TYPES[key],
    all: cellOut(real[t][26], baseAll, repeats(real[t][26], 26)),
    slots: real[t].slice(0, 26).map((x, s) => ({ time: quarter[s], ...cellOut(x, base[s], repeats(x, s)) })),
  }));
  return {
    tf, next: nx, days: g.D - 20, from: g.dates[20], to: g.dates[g.D - 1], olderTo: g.dates[half - 1],
    types: out, slotsTested: tested, repeating: found, luckRepeating: luck, costPts: r3(COST_PTS),
    baseBySlot: base.map((x, s) => ({ time: quarter[s], n: x.n, up: r3(x.n ? x.up / x.n : 0), avg: r2(x.n ? x.sum / x.n : 0) })),
    rule: `A candle type "repeats" at a time only if, in BOTH the older and the newer half of the days (30+ cases each), the move over the next ${nx} candle(s) beats the normal candle at that time by more than the cost (${r2(COST_PTS)} pt), in the same direction, and is statistically clear in each half on its own (t >= 2).`,
  };
}

function cellOut(x: Cell, b: Cell, rep: number) {
  const avg = x.n ? x.sum / x.n : 0, bAvg = b.n ? b.sum / b.n : 0;
  return { n: x.n, up: r3(x.n ? x.up / x.n : 0), avg: r2(avg), edge: r2(avg - bAvg),
    edgeOlder: r2((x.nO ? x.sumO / x.nO : 0) - (b.nO ? b.sumO / b.nO : 0)), edgeNewer: r2((x.nN ? x.sumN / x.nN : 0) - (b.nN ? b.sumN / b.nN : 0)),
    repeats: rep };
}

export function _resetCaches() { gridCache = null; accCache.clear(); }
