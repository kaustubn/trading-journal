// News Reaction: how NQ moves around high-impact US releases (CPI 8:30, jobs report 8:30, FOMC 14:00 +
// press conference 14:30, all New York time), using the chart's 1-minute bars.
// Per release: the 5 minutes before, the first minute and first 5 minutes after (direction + size + range),
// then 30 min / 1 h / to 16:00 measured from the end of those first 5 minutes: did it keep going or reverse?
// "Follow" = enter at the close of the 5th minute in the direction of the first 5 minutes, exit 30 min later;
// "Fade" = the opposite. Costs: NQ $3.50 + 0.5 pt per trade. Releases are split by date (older / newer half);
// a rule repeats only if it is positive after costs in both halves with t >= 2 in each.
// Each release day is also checked in the data: a real release shows a volume spike (>= 1.5x the prior 30 min) in its minute.
import pool from '../db';
import { packRows, unpackRows } from './barPack';
import { CPI_DATES, NFP_DATES } from './newsCalendar';
import { FOMC_DATES } from './edgeHunter';

const COST_PTS = 3.5 / 20 + 0.5;
export const FIRST_MIN = 450;            // 07:30 ET
export const LAST_MIN = 959;             // 15:59 ET (bar closing at 16:00)
const SPAN = LAST_MIN - FIRST_MIN + 1;   // 510 minutes per day

export type NewsType = 'CPI' | 'NFP' | 'FOMC' | 'FOMC_PRESSER';
export const NEWS_TYPES: Record<NewsType, { name: string; time: string }> = {
  CPI: { name: 'CPI (inflation)', time: '8:30' },
  NFP: { name: 'Jobs report (NFP)', time: '8:30' },
  FOMC: { name: 'FOMC rate decision', time: '14:00' },
  FOMC_PRESSER: { name: 'Fed press conference', time: '14:30' },
};
export interface NewsEvent { type: NewsType; date: string; min: number; } // min = minute of day ET

export function allEvents(): NewsEvent[] {
  const ev: NewsEvent[] = [];
  for (const d of CPI_DATES) ev.push({ type: 'CPI', date: d, min: 510 });
  for (const d of NFP_DATES) ev.push({ type: 'NFP', date: d, min: 510 });
  for (const d of FOMC_DATES) { ev.push({ type: 'FOMC', date: d, min: 840 }); ev.push({ type: 'FOMC_PRESSER', date: d, min: 870 }); }
  return ev.sort((a, b) => (a.date + a.min).localeCompare(b.date + b.min));
}

export interface DayGrid { O: Float64Array; H: Float64Array; L: Float64Array; C: Float64Array; V: Float64Array; }

// ------------------------------------------------------------------ data (packed + cached in scan_cache)
let cache: { key: string; days: Map<string, DayGrid>; normal: Map<string, { m830: number; m1400: number; m1430: number }> } | null = null;

export async function loadNewsData() {
  const evs = allEvents();
  const dates = [...new Set(evs.map(e => e.date))].sort();
  const key = `${dates.length}|${dates[0]}|${dates[dates.length - 1]}|v1`;
  if (cache && cache.key === key) return cache;
  const have = await pool.query(`SELECT ver, data FROM scan_cache WHERE key = 'news1m'`);
  let rows: any[][];
  if (have.rows.length && have.rows[0].ver === key) {
    const b = unpackRows(have.rows[0].data);
    rows = Array.from({ length: b.n }, (_, i) => [b.t[i], b.o[i], b.h[i], b.l[i], b.c[i], b.v[i], b.d[i], b.wd[i], b.mod[i]]);
  } else {
    const r = await pool.query({
      text: `SELECT extract(epoch FROM ts) * 1000 AS t, o, h, l, c, v,
                    to_char(ts AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d,
                    extract(isodow FROM ts AT TIME ZONE 'America/New_York')::int AS wd,
                    (extract(hour FROM ts AT TIME ZONE 'America/New_York') * 60 + extract(minute FROM ts AT TIME ZONE 'America/New_York'))::int AS mod
               FROM bars_1m
              WHERE sym = 1 AND (ts AT TIME ZONE 'America/New_York')::date = ANY($1::date[])
                AND (ts AT TIME ZONE 'America/New_York')::time >= '07:30' AND (ts AT TIME ZONE 'America/New_York')::time < '16:00'
              ORDER BY ts`,
      values: [dates], rowMode: 'array',
    });
    rows = r.rows;
    await pool.query(`INSERT INTO scan_cache (key, ver, data, updated_at) VALUES ('news1m', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET ver = EXCLUDED.ver, data = EXCLUDED.data, updated_at = NOW()`, [key, packRows(rows)]);
  }
  const days = new Map<string, DayGrid>();
  for (const r of rows) {
    const d = String(r[6]), m = Number(r[8]) - FIRST_MIN;
    if (m < 0 || m >= SPAN) continue;
    let g = days.get(d);
    if (!g) { g = { O: new Float64Array(SPAN).fill(NaN), H: new Float64Array(SPAN).fill(NaN), L: new Float64Array(SPAN).fill(NaN), C: new Float64Array(SPAN).fill(NaN), V: new Float64Array(SPAN) }; days.set(d, g); }
    g.O[m] = Number(r[1]) / 100; g.H[m] = Number(r[2]) / 100; g.L[m] = Number(r[3]) / 100; g.C[m] = Number(r[4]) / 100; g.V[m] = Number(r[5]);
  }
  for (const g of days.values()) fillForward(g);
  // normal days: size of the 5-minute move at the same clock times on every day (computed in the database, tiny result)
  const nq = await pool.query(`
    SELECT d, max(CASE WHEN w = 830 THEN mv END) m830, max(CASE WHEN w = 1400 THEN mv END) m1400, max(CASE WHEN w = 1430 THEN mv END) m1430 FROM (
      SELECT to_char(ts AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') d,
             CASE WHEN tm >= '08:30' AND tm < '08:35' THEN 830 WHEN tm >= '14:00' AND tm < '14:05' THEN 1400 ELSE 1430 END w,
             abs((array_agg(c ORDER BY ts DESC))[1] - (array_agg(o ORDER BY ts))[1]) / 100.0 mv
        FROM (SELECT ts, o, c, (ts AT TIME ZONE 'America/New_York')::time tm FROM bars_1m WHERE sym = 1) x
       WHERE (tm >= '08:30' AND tm < '08:35') OR (tm >= '14:00' AND tm < '14:05') OR (tm >= '14:30' AND tm < '14:35')
       GROUP BY 1, 2) y GROUP BY d`);
  const normal = new Map<string, { m830: number; m1400: number; m1430: number }>(
    nq.rows.map((r: any) => [r.d, { m830: Number(r.m830), m1400: Number(r.m1400), m1430: Number(r.m1430) }]));
  cache = { key, days, normal };
  return cache;
}

export function fillForward(g: DayGrid) {
  let first = -1;
  for (let i = 0; i < SPAN; i++) if (isFinite(g.C[i])) { first = i; break; }
  if (first < 0) return;
  for (let i = 0; i < SPAN; i++) {
    if (isFinite(g.C[i])) continue;
    const p = i < first ? g.O[first] : g.C[i - 1];
    g.O[i] = g.H[i] = g.L[i] = g.C[i] = p; g.V[i] = 0;
  }
}

// ------------------------------------------------------------------ stats
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
function tstat(a: number[]) {
  const n = a.length; if (n < 2) return 0;
  const m = a.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / (sd / Math.sqrt(n)) : 0;
}
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };

export interface EventRow {
  type: NewsType; date: string; wd: number; pre5: number; first1: number; first5: number; range5: number;
  after30: number | null; after60: number | null; toClose: number | null; volSpike: number; dataOk: boolean;
}

export function eventRow(e: NewsEvent, g: DayGrid): EventRow | null {
  const i = e.min - FIRST_MIN;
  if (i - 5 < 0 || i + 4 >= SPAN) return null;
  const pre5 = g.C[i - 1] - g.O[i - 5];
  const first1 = g.C[i] - g.O[i], first5 = g.C[i + 4] - g.O[i];
  let hi = -Infinity, lo = Infinity; for (let j = i; j <= i + 4; j++) { hi = Math.max(hi, g.H[j]); lo = Math.min(lo, g.L[j]); }
  const e5 = g.C[i + 4];
  const at = (k: number) => (i + 4 + k < SPAN ? g.C[i + 4 + k] - e5 : null);
  let vb = 0, vn = 0; for (let j = Math.max(0, i - 30); j < i; j++) { vb += g.V[j]; vn++; }
  const spike = vn && vb > 0 ? g.V[i] / (vb / vn) : 0;
  return { type: e.type, date: e.date, wd: new Date(`${e.date}T12:00:00Z`).getUTCDay(), pre5: r2(pre5), first1: r2(first1), first5: r2(first5), range5: r2(hi - lo),
    after30: at(30), after60: at(60), toClose: at(SPAN - 1 - i - 4), volSpike: r1(spike),
    // a real release shows a volume spike in its minute; the press conference follows the 14:00 spike, so its date is trusted from the FOMC day
    dataOk: e.type === 'FOMC_PRESSER' || spike >= 1.5 };
}

export function summarize(rows: EventRow[], normalAbs: number[]) {
  const ok = rows.filter(r => r.dataOk);
  const n = ok.length, half = Math.floor(n / 2);
  const dir = (r: EventRow) => Math.sign(r.first5) || 1;
  const cont = (k: 'after30' | 'after60' | 'toClose') => { const v = ok.filter(r => r[k] != null && r.first5 !== 0); return v.length ? v.filter(r => Math.sign(r[k]!) === dir(r)).length / v.length : 0; };
  const follow = ok.filter(r => r.after30 != null).map(r => dir(r) * r.after30! - COST_PTS);
  const fade = ok.filter(r => r.after30 != null).map(r => -dir(r) * r.after30! - COST_PTS);
  const halves = (a: number[]) => ({ older: r2(avg(a.slice(0, half))), newer: r2(avg(a.slice(half))), tOlder: r2(tstat(a.slice(0, half))), tNewer: r2(tstat(a.slice(half))) });
  const rule = (a: number[]) => {
    const h = halves(a);
    const repeats = a.length >= 20 && h.older > 0 && h.newer > 0 && h.tOlder >= 2 && h.tNewer >= 2;
    return { n: a.length, avgPts: r2(avg(a)), winRate: r3(a.length ? a.filter(x => x > 0).length / a.length : 0), tStat: r2(tstat(a)), ...h, repeats };
  };
  const absFirst5 = ok.map(r => Math.abs(r.first5));
  const normal = normalAbs.filter(x => isFinite(x));
  return {
    n, dropped: rows.length - n,
    firstUp: r3(n ? ok.filter(r => r.first5 > 0).length / n : 0),
    firstDown: r3(n ? ok.filter(r => r.first5 < 0).length / n : 0),
    avgAbsFirst5: r1(avg(absFirst5)), medianAbsFirst5: r1(median(absFirst5)), avgRange5: r1(avg(ok.map(r => r.range5))),
    normalAbs5: r1(avg(normal)), timesNormal: r1(avg(normal) > 0 ? avg(absFirst5) / avg(normal) : 0),
    preSameDir: r3(n ? ok.filter(r => r.pre5 !== 0 && Math.sign(r.pre5) === dir(r)).length / n : 0),
    keepsGoing: { after30: r3(cont('after30')), after60: r3(cont('after60')), toClose: r3(cont('toClose')) },
    follow: rule(follow), fade: rule(fade),
  };
}

export async function newsStudy() {
  const { days, normal } = await loadNewsData();
  const evs = allEvents();
  const rows: EventRow[] = [];
  for (const e of evs) { const g = days.get(e.date); if (!g) continue; const r = eventRow(e, g); if (r) rows.push(r); }
  const types = (Object.keys(NEWS_TYPES) as NewsType[]).map(t => {
    const rs = rows.filter(r => r.type === t);
    const key = t === 'FOMC' ? 'm1400' : t === 'FOMC_PRESSER' ? 'm1430' : 'm830';
    const evDates = new Set(rs.map(r => r.date));
    const normalAbs = [...normal.entries()].filter(([d]) => !evDates.has(d)).map(([, v]) => (v as any)[key] as number);
    return { type: t, ...NEWS_TYPES[t], ...summarize(rs, normalAbs), events: rs };
  });
  return { types, from: rows[0]?.date, to: rows[rows.length - 1]?.date, costPts: r3(COST_PTS),
    sources: 'CPI / jobs report dates: St. Louis Fed ALFRED vintage dates; FOMC: federalreserve.gov calendar. Times New York.' };
}
