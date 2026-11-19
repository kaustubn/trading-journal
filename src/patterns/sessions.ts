// Weekday x session tendencies (and month / week-of-month), from the chart's NQ 1-minute bars, all 24h.
// Sessions (New York time; the evening belongs to the NEXT trading day, so Monday's Asia = Sunday 18:00):
//   Asia 18:00-02:00 | London 02:00-08:00 | Pre-market 08:00-09:30 | NY open hour 09:30-10:30 |
//   NY morning 10:30-12:00 | Lunch 12:00-13:30 | NY afternoon 13:30-16:00
// For each weekday x session: how often it closed up, average move (points and % of price), how often it
// trended (close-open >= half the session's range), average range. Days are split by date into an older and
// a newer half; a tendency "repeats" only if both halves lean the same way with t >= 2 in each.
// The database does the per-session summary, so only ~10k small rows leave it.
import pool from '../db';

export const SESSIONS = [
  { key: 'asia', name: 'Asia', time: '18:00-02:00' },
  { key: 'london', name: 'London', time: '02:00-08:00' },
  { key: 'pre', name: 'Pre-market', time: '08:00-09:30' },
  { key: 'open', name: 'NY open hour', time: '09:30-10:30' },
  { key: 'morning', name: 'NY morning', time: '10:30-12:00' },
  { key: 'lunch', name: 'Lunch', time: '12:00-13:30' },
  { key: 'pm', name: 'NY afternoon', time: '13:30-16:00' },
];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export interface SessRow { day: string; s: number; o: number; h: number; l: number; c: number; n: number; }

let cache: { at: number; rows: SessRow[] } | null = null;

export async function loadSessions(): Promise<SessRow[]> {
  if (cache && Date.now() - cache.at < 6 * 3600 * 1000) return cache.rows;
  const r = await pool.query(`
    WITH x AS (SELECT ts, o, h, l, c, (ts AT TIME ZONE 'America/New_York') lt FROM bars_1m WHERE sym = 1),
    y AS (SELECT CASE WHEN lt::time >= '18:00' THEN lt::date + 1 ELSE lt::date END td,
                 CASE WHEN lt::time >= '18:00' OR lt::time < '02:00' THEN 0 WHEN lt::time < '08:00' THEN 1
                      WHEN lt::time < '09:30' THEN 2 WHEN lt::time < '10:30' THEN 3 WHEN lt::time < '12:00' THEN 4
                      WHEN lt::time < '13:30' THEN 5 WHEN lt::time < '16:00' THEN 6 ELSE -1 END s, ts, o, h, l, c FROM x)
    SELECT td::text AS day, s, (array_agg(o ORDER BY ts))[1] / 100.0 AS o, max(h) / 100.0 AS h, min(l) / 100.0 AS l,
           (array_agg(c ORDER BY ts DESC))[1] / 100.0 AS c, count(*)::int AS n
      FROM y WHERE s >= 0 GROUP BY 1, 2 ORDER BY 1, 2`);
  const rows: SessRow[] = r.rows.map((x: any) => ({ day: x.day, s: Number(x.s), o: Number(x.o), h: Number(x.h), l: Number(x.l), c: Number(x.c), n: Number(x.n) }));
  cache = { at: Date.now(), rows };
  return rows;
}

const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
function stats(a: number[]) {
  const n = a.length; if (!n) return { n: 0, mean: 0, t: 0 };
  const m = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}

interface Cell { pct: number[]; pts: number[]; range: number[]; trend: number; day: string[] }

/** Sessions need a minimum number of 1m bars to count (half days, holidays and gaps are skipped). */
const MIN_BARS = [300, 240, 60, 50, 70, 70, 120];

export function sessionStats(rows: SessRow[]) {
  const days = [...new Set(rows.map(r => r.day))].sort();
  const split = days[Math.floor(days.length / 2)];
  const cells: Cell[][] = WD.map(() => SESSIONS.map(() => ({ pct: [], pts: [], range: [], trend: 0, day: [] })));
  for (const r of rows) {
    const wd = new Date(`${r.day}T12:00:00Z`).getUTCDay() - 1;
    if (wd < 0 || wd > 4 || r.n < MIN_BARS[r.s] || !(r.o > 0)) continue;
    const c = cells[wd][r.s], mv = r.c - r.o, rg = r.h - r.l;
    c.pct.push((mv / r.o) * 100); c.pts.push(mv); c.range.push(rg); c.day.push(r.day);
    if (rg > 0 && Math.abs(mv) >= 0.5 * rg) c.trend++;
  }
  let tested = 0, repeating = 0;
  const grid = WD.map((w, wi) => SESSIONS.map((s, si) => {
    const c = cells[wi][si], n = c.pct.length;
    const older = c.pct.filter((_, i) => c.day[i] < split), newer = c.pct.filter((_, i) => c.day[i] >= split);
    const so = stats(older), sn = stats(newer), sa = stats(c.pct);
    const upO = older.length ? older.filter(x => x > 0).length / older.length : 0, upN = newer.length ? newer.filter(x => x > 0).length / newer.length : 0;
    const repeats = older.length >= 30 && newer.length >= 30 && Math.sign(so.mean) === Math.sign(sn.mean) && Math.abs(so.t) >= 2 && Math.abs(sn.t) >= 2 ? Math.sign(sn.mean) : 0;
    if (older.length >= 30 && newer.length >= 30) tested++;
    if (repeats) repeating++;
    return {
      weekday: w, session: s.name, n, up: r3(n ? c.pct.filter(x => x > 0).length / n : 0),
      avgPts: r1(c.pts.reduce((a, x) => a + x, 0) / (n || 1)), avgPct: r3(sa.mean), t: r2(sa.t),
      trendShare: r3(n ? c.trend / n : 0), avgRange: r1(c.range.reduce((a, x) => a + x, 0) / (n || 1)),
      upOlder: r3(upO), upNewer: r3(upN), avgPctOlder: r3(so.mean), avgPctNewer: r3(sn.mean), tOlder: r2(so.t), tNewer: r2(sn.t), repeats,
    };
  }));
  // month x week-of-month, New York day session (9:30-16:00 = sessions 3..6)
  const rth = new Map<string, { o: number; c: number; h: number; l: number; k: number }>();
  for (const r of rows) {
    if (r.s < 3 || r.n < MIN_BARS[r.s]) continue;
    const x = rth.get(r.day);
    if (!x) rth.set(r.day, { o: r.s === 3 ? r.o : NaN, c: r.s === 6 ? r.c : NaN, h: r.h, l: r.l, k: 1 });
    else { if (r.s === 3) x.o = r.o; if (r.s === 6) x.c = r.c; x.h = Math.max(x.h, r.h); x.l = Math.min(x.l, r.l); x.k++; }
  }
  const cal: { up: number[]; trend: number; range: number[]; n: number; years: Set<string> }[][] =
    Array.from({ length: 12 }, () => Array.from({ length: 5 }, () => ({ up: [], trend: 0, range: [], n: 0, years: new Set<string>() })));
  for (const [d, x] of rth) {
    if (x.k < 4 || !isFinite(x.o) || !isFinite(x.c)) continue;
    const m = Number(d.slice(5, 7)) - 1, wk = Math.min(4, Math.floor((Number(d.slice(8, 10)) - 1) / 7));
    const c = cal[m][wk], rg = x.h - x.l;
    c.n++; c.up.push(x.c > x.o ? 1 : 0); c.range.push(rg); c.years.add(d.slice(0, 4));
    if (rg > 0 && Math.abs(x.c - x.o) >= 0.5 * rg) c.trend++;
  }
  const calendar = cal.map((weeks, m) => weeks.map((c, wk) => ({
    month: m + 1, week: wk + 1, days: c.n, years: c.years.size,
    up: r3(c.n ? c.up.reduce((a, x) => a + x, 0) / c.n : 0), trendDays: r3(c.n ? c.trend / c.n : 0),
    avgRange: r1(c.range.reduce((a, x) => a + x, 0) / (c.n || 1)),
  })));
  const allTrend = [...rth.values()].filter(x => x.k >= 4 && isFinite(x.o) && isFinite(x.c));
  return {
    sessions: SESSIONS, weekdays: WD, grid, tested, repeating,
    luckExpected: r2(tested * 0.0013), // two independent halves each |t| >= 2 in the same direction by chance ~0.13%
    from: days[0], to: days[days.length - 1], splitDate: split,
    calendar,
    baseline: { days: allTrend.length, up: r3(allTrend.filter(x => x.c > x.o).length / (allTrend.length || 1)),
      trendDays: r3(allTrend.filter(x => x.h - x.l > 0 && Math.abs(x.c - x.o) >= 0.5 * (x.h - x.l)).length / (allTrend.length || 1)) },
    note: 'Month / week-of-month cells have only ~20-25 days over 5 years (about 5 of each week): treat them as anecdotes, not edges.',
  };
}
