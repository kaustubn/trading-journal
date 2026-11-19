// News Event Analyzer: deterministic statistics (no AI). Pure functions; tested in tests/econStats.test.ts.
// Minute arrays are New York clock minutes from 07:30 (index 0) to 15:59 (index 509), filled forward.

export type EventCode = 'CPI' | 'NFP' | 'PPI' | 'RETAIL' | 'FOMC';
export const EVENT_INFO: Record<EventCode, { name: string; measures: string; time: string }> = {
  CPI: { name: 'CPI (consumer prices)', measures: 'Monthly change in consumer prices (headline CPI, % m/m).', time: '08:30' },
  NFP: { name: 'Jobs report (NFP)', measures: 'Monthly change in non-farm payrolls (thousands of jobs).', time: '08:30' },
  PPI: { name: 'PPI (producer prices)', measures: 'Monthly change in producer prices for final demand (% m/m).', time: '08:30' },
  RETAIL: { name: 'Retail sales', measures: 'Monthly change in retail and food-services sales (% m/m).', time: '08:30' },
  FOMC: { name: 'FOMC rate decision', measures: 'Change in the Fed funds target (upper bound, basis points).', time: '14:00' },
};

export interface Release {
  event: EventCode; date: string; time: string; period: string;
  actual: number | null;    // FIRST release (as published that day)
  previous: number | null;  // previous period as shown that day
  revised: number | null;   // this period as shown in the next release
  unit: string;
  forecast?: number | null; // consensus as it stood before the release (imported)
}

export const FIRST_MIN = 450;  // 07:30
export const LAST_MIN = 959;   // 15:59
export const minuteIndex = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m - FIRST_MIN; };

// ------------------------------------------------------------ surprise, z-score, bucket
export type Bucket = 'above' | 'inline' | 'below' | 'unknown';

/**
 * Adds surprise / z / bucket to each release, using ONLY earlier releases of the same event for the z-score
 * (no look-ahead). Needs at least `minHistory` earlier surprises; otherwise the bucket is 'unknown'.
 * FOMC: bucket by the sign of (decision - expected) and flagged as less precise.
 */
export function classify(rels: Release[], sigma = 0.5, minHistory = 8): (Release & { surprise: number | null; z: number | null; bucket: Bucket; lessPrecise: boolean })[] {
  const byEvent = new Map<EventCode, number[]>();
  return [...rels].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(r => {
    const surprise = r.actual != null && r.forecast != null ? r.actual - r.forecast : null;
    const past = byEvent.get(r.event) ?? [];
    let z: number | null = null, bucket: Bucket = 'unknown';
    if (surprise != null) {
      if (r.event === 'FOMC') {
        bucket = surprise > 0 ? 'above' : surprise < 0 ? 'below' : 'inline';
      } else if (past.length >= minHistory) {
        const m = past.reduce((a, x) => a + x, 0) / past.length;
        const sd = Math.sqrt(past.reduce((a, x) => a + (x - m) ** 2, 0) / (past.length - 1));
        z = sd > 0 ? (surprise - m) / sd : 0;
        bucket = z > sigma ? 'above' : z < -sigma ? 'below' : 'inline';
      }
      byEvent.set(r.event, [...past, surprise]);
    }
    return { ...r, surprise, z, bucket, lessPrecise: r.event === 'FOMC' };
  });
}

// ------------------------------------------------------------ reaction windows
export interface Grid { O: ArrayLike<number>; H: ArrayLike<number>; L: ArrayLike<number>; C: ArrayLike<number> }
export interface Win { pts: number; pct: number; mfe: number; mae: number; range: number }
export const WINDOWS = ['pre15', 'm1', 'm5', 'm15', 'm30', 'm60', 'session', 'nextDay'] as const;
export type WindowKey = typeof WINDOWS[number];
export const WINDOW_LABEL: Record<WindowKey, string> = {
  pre15: '15 min before', m1: '+1 min', m5: '+5 min', m15: '+15 min', m30: '+30 min', m60: '+60 min', session: 'Rest of session (to 16:00)', nextDay: 'Next day close',
};

function span(g: Grid, from: number, to: number, p0: number): Win | null {
  if (from < 0 || to >= g.C.length || to < from) return null;
  let hi = -Infinity, lo = Infinity;
  for (let i = from; i <= to; i++) { hi = Math.max(hi, g.H[i]); lo = Math.min(lo, g.L[i]); }
  const end = g.C[to];
  if (![hi, lo, end, p0].every(Number.isFinite)) return null;
  return { pts: end - p0, pct: ((end - p0) / p0) * 100, mfe: hi - p0, mae: lo - p0, range: hi - lo };
}

export interface Reaction {
  p0: number;                               // price just before the release (close of the minute before)
  windows: Partial<Record<WindowKey, Win>>;
  first15Range: number | null;              // high-low of the first 15 minutes
  first15VsAvg: number | null;              // first15Range / 20-day average range of the same clock window
  reversal: boolean | null;                 // first-5-min direction opposite to the 60-min direction
}

/**
 * Reaction around one release. `r` = minute index of the release (e.g. 8:30 -> 60).
 * `nextClose`: next trading day's 16:00 close (null when unknown or when a contract roll lies in between).
 * `avg20Range`: average high-low of the same 15-minute clock window on the previous 20 trading days.
 */
export function reaction(g: Grid, r: number, nextClose: number | null, avg20Range: number | null): Reaction | null {
  const p0 = g.C[r - 1];
  if (!Number.isFinite(p0) || r < 16) return null;
  const w: Partial<Record<WindowKey, Win>> = {};
  const pre = span(g, r - 15, r - 1, g.C[r - 16]); if (pre) w.pre15 = pre;
  for (const [k, n] of [['m1', 1], ['m5', 5], ['m15', 15], ['m30', 30], ['m60', 60]] as [WindowKey, number][]) {
    const x = span(g, r, r + n - 1, p0); if (x) w[k] = x;
  }
  const sess = span(g, r, LAST_MIN - FIRST_MIN, p0); if (sess) w.session = sess;
  if (nextClose != null && Number.isFinite(nextClose)) w.nextDay = { pts: nextClose - p0, pct: ((nextClose - p0) / p0) * 100, mfe: NaN, mae: NaN, range: NaN };
  const f15 = w.m15 ? w.m15.range : null;
  const rev = w.m5 && w.m60 && w.m5.pts !== 0 && w.m60.pts !== 0 ? Math.sign(w.m5.pts) !== Math.sign(w.m60.pts) : null;
  return { p0, windows: w, first15Range: f15, first15VsAvg: f15 != null && avg20Range && avg20Range > 0 ? f15 / avg20Range : null, reversal: rev };
}

// ------------------------------------------------------------ aggregation with confidence intervals
/** Wilson 95% interval for a proportion k/n. */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export const MIN_N = 10;
export interface WindowStats {
  n: number; insufficient: boolean;
  up: { p: number; lo: number; hi: number } | null; down: { p: number; lo: number; hi: number } | null;
  medianPts: number | null; meanPts: number | null; meanPct: number | null; avgRange: number | null; minPts: number | null; maxPts: number | null;
}
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };

export function windowStats(xs: Win[]): WindowStats {
  const n = xs.length;
  if (n < MIN_N) return { n, insufficient: true, up: null, down: null, medianPts: null, meanPts: null, meanPct: null, avgRange: null, minPts: null, maxPts: null };
  const pts = xs.map(x => x.pts), rng = xs.map(x => x.range).filter(Number.isFinite);
  return {
    n, insufficient: false,
    up: wilson(pts.filter(x => x > 0).length, n), down: wilson(pts.filter(x => x < 0).length, n),
    medianPts: median(pts), meanPts: pts.reduce((a, x) => a + x, 0) / n, meanPct: xs.reduce((a, x) => a + x.pct, 0) / n,
    avgRange: rng.length ? rng.reduce((a, x) => a + x, 0) / rng.length : null, minPts: Math.min(...pts), maxPts: Math.max(...pts),
  };
}

export function reversalStats(rs: (Reaction | null)[]): { n: number; insufficient: boolean; rate: { p: number; lo: number; hi: number } | null } {
  const xs = rs.filter((r): r is Reaction => !!r && r.reversal != null);
  if (xs.length < MIN_N) return { n: xs.length, insufficient: true, rate: null };
  return { n: xs.length, insufficient: false, rate: wilson(xs.filter(r => r.reversal).length, xs.length) };
}

// ------------------------------------------------------------ simultaneous releases
const THURSDAY = 4;
/** Other releases at the same minute: our own events, and weekly jobless claims on Thursdays at 8:30. */
export function sharedWith(rels: Pick<Release, 'event' | 'date' | 'time'>[]): Map<string, string[]> {
  const slot = new Map<string, string[]>();
  for (const r of rels) slot.set(`${r.date} ${r.time}`, [...(slot.get(`${r.date} ${r.time}`) ?? []), r.event]);
  const out = new Map<string, string[]>();
  for (const r of rels) {
    const others = (slot.get(`${r.date} ${r.time}`) ?? []).filter(e => e !== r.event);
    if (r.time === '08:30' && new Date(r.date + 'T12:00:00Z').getUTCDay() === THURSDAY) others.push('Jobless claims (weekly)');
    out.set(`${r.event} ${r.date}`, others);
  }
  return out;
}

// ------------------------------------------------------------ time zones
/** UTC instant of a New York wall-clock time (handles daylight saving with the IANA rules). */
export function nyToUtc(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = (t: number) => Object.fromEntries(fmt.formatToParts(new Date(t)).map(p => [p.type, p.value]));
  const p = parts(guess);
  const asNy = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess + (guess - asNy));
}

// ------------------------------------------------------------ personal stats
export interface PTrade { day: string; pnl: number; r: number | null }
export function personalStats(trades: PTrade[], eventDays: Set<string>) {
  const part = (xs: PTrade[]) => {
    const rs = xs.map(t => t.r).filter((x): x is number => x != null && Number.isFinite(x));
    return {
      n: xs.length, days: new Set(xs.map(t => t.day)).size,
      winRate: xs.length ? wilson(xs.filter(t => t.pnl > 0).length, xs.length) : null,
      pnl: xs.reduce((a, t) => a + t.pnl, 0), avgPnl: xs.length ? xs.reduce((a, t) => a + t.pnl, 0) / xs.length : null,
      avgR: rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null, insufficient: xs.length < MIN_N,
    };
  };
  return { event: part(trades.filter(t => eventDays.has(t.day))), normal: part(trades.filter(t => !eventDays.has(t.day))) };
}
