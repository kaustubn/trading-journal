// News Event Analyzer: data adapters + loading + per-event statistics.
// Releases come from providers (swappable): ALFRED first-release data (built offline into econReleases.json)
// and imported consensus forecasts (econ_forecasts table, from CSV). NQ minutes come from bars_1m.
import fs from 'fs';
import path from 'path';
import pool from '../db';
import { packRows, unpackRows } from '../patterns/barPack';
import { Release, EventCode, EVENT_INFO, classify, reaction, windowStats, reversalStats, sharedWith, nyToUtc, minuteIndex,
  WINDOWS, WindowKey, Reaction, Bucket, FIRST_MIN, LAST_MIN, Grid } from './econStats';

// ------------------------------------------------------------ providers (adapter pattern)
export interface EconProvider { name: string; load(): Promise<Release[]> }

/** First-release actual / previous / revised from ALFRED vintages (see scripts/news/build_econ_releases.cjs). */
export const alfredProvider: EconProvider = {
  name: 'ALFRED (St. Louis Fed) first releases',
  async load() {
    const file = path.join(__dirname, 'econReleases.json');
    const alt = path.join(__dirname, '../../src/news/econReleases.json'); // when running from dist/
    const p = fs.existsSync(file) ? file : alt;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out = (j.releases as Release[]).map(r => ({ ...r, forecast: null }));
    // FOMC: the builder stores the rate LEVEL as `previous`; show the previous meeting's CHANGE (bp) instead,
    // so previous / forecast / actual share one unit.
    let prevChange: number | null = null;
    for (const r of out.filter(x => x.event === 'FOMC')) { r.previous = prevChange; if (r.actual != null) prevChange = r.actual; }
    return out;
  },
};

export interface ForecastRow { event: EventCode; release_date: string; release_time: string | null; forecast: number | null; source: string | null }
/** Consensus forecasts imported from CSV (the user's own licensed source). Also adds upcoming releases. */
export const csvForecastProvider = {
  name: 'Imported forecasts (CSV)',
  async load(): Promise<ForecastRow[]> {
    const r = await pool.query(`SELECT event, to_char(release_date, 'YYYY-MM-DD') AS release_date, release_time, forecast, source FROM econ_forecasts`);
    return r.rows.map(x => ({ ...x, forecast: x.forecast == null ? null : Number(x.forecast) }));
  },
};

export async function getReleases(): Promise<Release[]> {
  const [base, fc] = await Promise.all([alfredProvider.load(), csvForecastProvider.load()]);
  const key = (e: string, d: string) => `${e} ${d}`;
  const byKey = new Map(base.map(r => [key(r.event, r.date), r]));
  for (const f of fc) {
    const hit = byKey.get(key(f.event, f.release_date));
    if (hit) hit.forecast = f.forecast;
    else byKey.set(key(f.event, f.release_date), {
      event: f.event, date: f.release_date, time: f.release_time || EVENT_INFO[f.event].time, period: f.release_date.slice(0, 7),
      actual: null, previous: null, revised: null, unit: '', forecast: f.forecast,
    });
  }
  return [...byKey.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** CSV: event,date,time?,forecast[,source]   event = CPI|NFP|PPI|RETAIL|FOMC; date YYYY-MM-DD; time HH:MM New York. */
export function parseForecastCsv(text: string): { rows: ForecastRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: ForecastRow[] = [], errors: string[] = [];
  const head = (lines[0] || '').toLowerCase();
  const start = /event/.test(head) && /date/.test(head) ? 1 : 0;
  const cols = start ? head.split(',').map(s => s.trim()) : ['event', 'date', 'time', 'forecast', 'source'];
  const at = (name: string) => cols.indexOf(name);
  for (let i = start; i < lines.length; i++) {
    const f = lines[i].split(',').map(s => s.trim());
    const ev = (f[at('event')] || '').toUpperCase() as EventCode;
    const date = f[at('date')] || '', time = at('time') >= 0 ? f[at('time')] || null : null;
    const fRaw = f[at('forecast')];
    if (!(ev in EVENT_INFO)) { errors.push(`line ${i + 1}: unknown event "${f[at('event')]}"`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`line ${i + 1}: date must be YYYY-MM-DD`); continue; }
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) { errors.push(`line ${i + 1}: time must be HH:MM (New York)`); continue; }
    const fc = fRaw === undefined || fRaw === '' ? null : Number(fRaw.replace(/[%k,]/gi, ''));
    if (fc !== null && !Number.isFinite(fc)) { errors.push(`line ${i + 1}: forecast is not a number`); continue; }
    rows.push({ event: ev, release_date: date, release_time: time ? time.padStart(5, '0') : null, forecast: fc, source: at('source') >= 0 ? (f[at('source')] || null) : null });
  }
  return { rows, errors };
}

// ------------------------------------------------------------ NQ minutes around releases (cached, packed)
type DayGrid = Grid & { V: Float64Array };
const SPAN = LAST_MIN - FIRST_MIN + 1;
let gridCache: { key: string; days: Map<string, DayGrid>; next: Map<string, { close: number; sameContract: boolean }>; ranges: Map<string, { r830: number | null; r1400: number | null }> } | null = null;

async function loadGrids(dates: string[]) {
  const key = `${dates.length}|${dates[0]}|${dates[dates.length - 1]}|e1`;
  if (gridCache && gridCache.key === key) return gridCache;
  const have = await pool.query(`SELECT ver, data FROM scan_cache WHERE key = 'econ1m'`);
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
    await pool.query(`INSERT INTO scan_cache (key, ver, data, updated_at) VALUES ('econ1m', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET ver = EXCLUDED.ver, data = EXCLUDED.data, updated_at = NOW()`, [key, packRows(rows)]);
  }
  const days = new Map<string, DayGrid>();
  for (const r of rows) {
    const d = String(r[6]), m = Number(r[8]) - FIRST_MIN;
    if (m < 0 || m >= SPAN) continue;
    let g = days.get(d);
    if (!g) { g = { O: new Float64Array(SPAN).fill(NaN), H: new Float64Array(SPAN).fill(NaN), L: new Float64Array(SPAN).fill(NaN), C: new Float64Array(SPAN).fill(NaN), V: new Float64Array(SPAN) }; days.set(d, g); }
    (g.O as Float64Array)[m] = Number(r[1]) / 100; (g.H as Float64Array)[m] = Number(r[2]) / 100; (g.L as Float64Array)[m] = Number(r[3]) / 100; (g.C as Float64Array)[m] = Number(r[4]) / 100; g.V[m] = Number(r[5]);
  }
  for (const g of days.values()) fillForward(g);
  // next trading day's 16:00 close, and whether it is still the same contract (no roll in between)
  const nx = await pool.query(`
    WITH ev AS (SELECT unnest($1::date[]) AS d),
    x AS (
      SELECT ev.d,
        (SELECT contract FROM bars_1m WHERE sym = 1 AND ts < ((ev.d + time '16:00') AT TIME ZONE 'America/New_York')
            AND ts >= ((ev.d + time '07:30') AT TIME ZONE 'America/New_York') ORDER BY ts DESC LIMIT 1) AS c0,
        (SELECT (ts AT TIME ZONE 'America/New_York')::date FROM bars_1m WHERE sym = 1
            AND ts >= (((ev.d + 1) + time '09:30') AT TIME ZONE 'America/New_York') ORDER BY ts LIMIT 1) AS d1
      FROM ev)
    SELECT to_char(x.d, 'YYYY-MM-DD') AS d, x.c0, y.c / 100.0 AS close, y.contract AS c1
      FROM x LEFT JOIN LATERAL (SELECT c, contract FROM bars_1m WHERE sym = 1 AND x.d1 IS NOT NULL
            AND ts < ((x.d1 + time '16:00') AT TIME ZONE 'America/New_York')
            AND ts >= ((x.d1 + time '09:30') AT TIME ZONE 'America/New_York') ORDER BY ts DESC LIMIT 1) y ON true`, [dates]);
  const next = new Map(nx.rows.filter((r: any) => r.close != null).map((r: any) => [r.d, { close: Number(r.close), sameContract: r.c0 === r.c1 }]));
  // 15-minute high-low at 8:30 and 14:00 on every day (for the 20-day average of the same clock window)
  const rq = await pool.query(`
    SELECT to_char(ts AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d,
           (max(h) FILTER (WHERE tm >= '08:30' AND tm < '08:45') - min(l) FILTER (WHERE tm >= '08:30' AND tm < '08:45')) / 100.0 AS r830,
           (max(h) FILTER (WHERE tm >= '14:00' AND tm < '14:15') - min(l) FILTER (WHERE tm >= '14:00' AND tm < '14:15')) / 100.0 AS r1400
      FROM (SELECT ts, h, l, (ts AT TIME ZONE 'America/New_York')::time AS tm FROM bars_1m WHERE sym = 1) x
     WHERE (tm >= '08:30' AND tm < '08:45') OR (tm >= '14:00' AND tm < '14:15')
     GROUP BY 1 ORDER BY 1`);
  const ranges = new Map(rq.rows.map((r: any) => [r.d, { r830: r.r830 == null ? null : Number(r.r830), r1400: r.r1400 == null ? null : Number(r.r1400) }]));
  gridCache = { key, days, next, ranges };
  return gridCache;
}

function fillForward(g: DayGrid) {
  const C = g.C as Float64Array, O = g.O as Float64Array, H = g.H as Float64Array, L = g.L as Float64Array;
  let first = -1;
  for (let i = 0; i < SPAN; i++) if (isFinite(C[i])) { first = i; break; }
  if (first < 0) return;
  for (let i = 0; i < SPAN; i++) {
    if (isFinite(C[i])) continue;
    const p = i < first ? O[first] : C[i - 1];
    O[i] = H[i] = L[i] = C[i] = p; g.V[i] = 0;
  }
}

/** Average 15-min range of the same clock window over the 20 trading days BEFORE `date`. */
function avg20(ranges: Map<string, { r830: number | null; r1400: number | null }>, sortedDays: string[], date: string, time: string): number | null {
  const k = time === '14:00' ? 'r1400' : 'r830';
  let i = sortedDays.findIndex(d => d >= date) - 1;
  const vals: number[] = [];
  for (; i >= 0 && vals.length < 20; i--) { const v = ranges.get(sortedDays[i])?.[k]; if (v != null && v > 0) vals.push(v); }
  return vals.length >= 10 ? vals.reduce((a, x) => a + x, 0) / vals.length : null;
}

// ------------------------------------------------------------ per-event statistics
export interface EventRow {
  date: string; time: string; utc: string; period: string; actual: number | null; forecast: number | null; previous: number | null; revised: number | null;
  surprise: number | null; z: number | null; bucket: Bucket; shared: string[]; rollExcluded: boolean;
  m5: number | null; m60: number | null; first15VsAvg: number | null; reversal: boolean | null;
}

export async function eventStudy(event: EventCode, opts: { sigma: number; includeShared: boolean }) {
  const all = await getReleases();
  const shared = sharedWith(all);
  const today = new Date().toISOString().slice(0, 10);
  const classified = classify(all.filter(r => r.event === event), opts.sigma);
  const past = classified.filter(r => r.date < today && r.actual != null);
  const g = await loadGrids([...new Set(past.map(r => r.date))].sort());
  const sortedDays = [...g.ranges.keys()].sort();
  const rows: EventRow[] = [];
  const reacts: { bucket: Bucket; r: Reaction; shared: boolean }[] = [];
  let noData = 0, rollExcluded = 0;
  for (const r of past) {
    const grid = g.days.get(r.date);
    const sh = shared.get(`${r.event} ${r.date}`) ?? [];
    const nxt = g.next.get(r.date);
    const roll = !!nxt && !nxt.sameContract;
    if (roll) rollExcluded++;
    const re = grid ? reaction(grid, minuteIndex(r.time), nxt && nxt.sameContract ? nxt.close : null, avg20(g.ranges, sortedDays, r.date, r.time)) : null;
    if (!re) noData++;
    else reacts.push({ bucket: r.bucket, r: re, shared: sh.length > 0 });
    rows.push({ date: r.date, time: r.time, utc: nyToUtc(r.date, r.time).toISOString(), period: r.period, actual: r.actual, forecast: r.forecast ?? null,
      previous: r.previous, revised: r.revised, surprise: r.surprise, z: r.z, bucket: r.bucket, shared: sh, rollExcluded: roll,
      m5: re?.windows.m5?.pts ?? null, m60: re?.windows.m60?.pts ?? null, first15VsAvg: re?.first15VsAvg ?? null, reversal: re?.reversal ?? null });
  }
  const use = reacts.filter(x => opts.includeShared || !x.shared);
  const summarize = (xs: typeof use) => ({
    windows: Object.fromEntries(WINDOWS.map(w => [w, windowStats(xs.map(x => x.r.windows[w]).filter(Boolean) as any)])) as Record<WindowKey, ReturnType<typeof windowStats>>,
    reversal: reversalStats(xs.map(x => x.r)),
    first15VsAvg: (() => { const v = xs.map(x => x.r.first15VsAvg).filter((x): x is number => x != null); return v.length >= 10 ? v.reduce((a, x) => a + x, 0) / v.length : null; })(),
  });
  const buckets: Record<string, ReturnType<typeof summarize> & { n: number }> = {};
  for (const b of ['all', 'above', 'inline', 'below'] as const) {
    const xs = b === 'all' ? use : use.filter(x => x.bucket === b);
    buckets[b] = { n: xs.length, ...summarize(xs) };
  }
  const withForecast = past.filter(r => r.forecast != null).length;
  return {
    event, info: EVENT_INFO[event], sigma: opts.sigma, includeShared: opts.includeShared,
    counts: { releases: past.length, withForecast, used: use.length, sharedExcluded: opts.includeShared ? 0 : reacts.filter(x => x.shared).length, noData, rollExcluded },
    lessPrecise: event === 'FOMC', buckets, rows: rows.reverse(),
    method: 'Prices: NQ continuous front month, 1-minute bars (rolls by volume at the 6 pm session change, so intraday windows never cross a roll). '
      + 'Next-day windows that cross a contract roll are left out (no back-adjustment applied). Move = close of the window minus the close of the minute before the release. '
      + 'Actuals are first releases from ALFRED vintages; z-scores use only earlier releases of the same event.',
  };
}

/** Releases for the calendar page: past (with values) and upcoming (known dates only). */
export async function calendar() {
  const all = await getReleases();
  const shared = sharedWith(all);
  return all.map(r => ({ ...r, utc: nyToUtc(r.date, r.time).toISOString(), shared: shared.get(`${r.event} ${r.date}`) ?? [], impact: 'high', currency: 'USD' }));
}

export function eventDays(rels: Release[]): Set<string> { return new Set(rels.map(r => r.date)); }
