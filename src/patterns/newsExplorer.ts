// News explorer for Market Memory: list the high-impact USD releases in a date range (from the imported
// ForexFactory calendar, econ_events), and merge the NQ 1-minute bars around all of them
// (30 min before to 60 min after) into "what usually happens" (src/shared/newsConcepts.ts).
// Releases at the same minute (CPI m/m, CPI y/y, Core CPI...) are one event.
// Bars come from the database in one query (about 90 rows per release) and the result is cached.
import pool from '../db';
import { combineEvents, EventBars, Bar } from '../shared/newsConcepts';
import { nyToUtc } from '../shared/econCalendar';

export interface NewsItem { t: number; date: string; timeEt: string; titles: string[]; actual: string | null; forecast: string | null; previous: string | null; }

const MAX_EVENTS = 400;
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function etParts(ms: number) {
  const p = Object.fromEntries(etFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export async function listNews(p: { from?: string; to?: string; q?: string; impact?: string }): Promise<{ items: NewsItem[]; barsFrom: string | null; barsTo: string | null; truncated: boolean }> {
  const meta = await pool.query(`SELECT min(ts) AS a, max(ts) AS b FROM bars_1m WHERE sym = 1`);
  const a = meta.rows[0]?.a ? new Date(meta.rows[0].a).getTime() : null, b = meta.rows[0]?.b ? new Date(meta.rows[0].b).getTime() : null;
  if (a === null || b === null) return { items: [], barsFrom: null, barsTo: null, truncated: false };
  const from = p.from ? Date.parse(p.from + 'T00:00:00Z') - 12 * 3600e3 : a;
  const to = p.to ? Date.parse(p.to + 'T00:00:00Z') + 36 * 3600e3 : b;
  const impacts = p.impact === 'medium' ? ['high', 'medium'] : ['high'];
  const r = await pool.query(
    `SELECT extract(epoch FROM release_utc) * 1000 AS t, title, actual, forecast, previous
       FROM econ_events
      WHERE currency = 'USD' AND lower(impact) = ANY($1) AND release_utc >= to_timestamp($2 / 1000.0) AND release_utc <= to_timestamp($3 / 1000.0)
        AND release_utc >= to_timestamp($4 / 1000.0) + interval '30 minutes' AND release_utc <= to_timestamp($5 / 1000.0) - interval '60 minutes'
        ${p.q ? 'AND title ILIKE $6' : ''}
      ORDER BY release_utc`,
    p.q ? [impacts, Math.max(from, a), Math.min(to, b), a, b, `%${p.q}%`] : [impacts, Math.max(from, a), Math.min(to, b), a, b]);
  const byT = new Map<number, NewsItem>();
  for (const row of r.rows) {
    const t = Math.round(Number(row.t));
    const { date, time } = etParts(t);
    if (p.from && date < p.from) continue;
    if (p.to && date > p.to) continue;
    const it = byT.get(t);
    if (it) { if (!it.titles.includes(row.title)) it.titles.push(row.title); continue; }
    // "All Day" / holiday rows sit at midnight: no release minute to study
    if (time === '00:00') continue;
    byT.set(t, { t, date, timeEt: time, titles: [row.title], actual: row.actual, forecast: row.forecast, previous: row.previous });
  }
  const items = [...byT.values()].sort((x, y) => y.t - x.t);
  return { items: items.slice(0, MAX_EVENTS), barsFrom: etParts(a).date, barsTo: etParts(b).date, truncated: items.length > MAX_EVENTS };
}

/** 1-minute bars from 30 min before to 60 min after each release time (one query). */
export async function windowBars(times: number[]): Promise<Map<number, Bar[]>> {
  const out = new Map<number, Bar[]>(times.map(t => [t, []]));
  if (!times.length) return out;
  const r = await pool.query({
    text: `SELECT w.t AS a, extract(epoch FROM b.ts) * 1000 AS ts, b.o, b.h, b.l, b.c, b.v
             FROM unnest($1::bigint[]) AS w(t)
             JOIN bars_1m b ON b.sym = 1 AND b.ts >= to_timestamp(w.t / 1000.0) - interval '30 minutes' AND b.ts < to_timestamp(w.t / 1000.0) + interval '60 minutes'
            ORDER BY w.t, b.ts`,
    values: [times], rowMode: 'array',
  });
  for (const row of r.rows) out.get(Number(row[0]))?.push([Math.round(Number(row[1])), Number(row[2]) / 100, Number(row[3]) / 100, Number(row[4]) / 100, Number(row[5]) / 100, Number(row[6])]);
  return out;
}

const combineCache = new Map<string, { at: number; data: any }>();

export async function combineNews(p: { from?: string; to?: string; q?: string; impact?: string; times?: number[] }) {
  const list = await listNews(p);
  let items = list.items;
  if (p.times?.length) { const want = new Set(p.times); items = items.filter(i => want.has(i.t)); }
  const key = items.map(i => i.t).join(',');
  const hit = combineCache.get(key);
  if (hit && Date.now() - hit.at < 3600e3) return hit.data;
  const bars = await windowBars(items.map(i => i.t));
  const evs: EventBars[] = items.map(i => ({ anchor: i.t, date: i.date, label: primaryTitle(i.titles), bars: bars.get(i.t) ?? [] }));
  const data: any = { ...combineEvents(evs), listed: items.length, truncated: list.truncated };
  data.baseline = await baseline(items);
  combineCache.set(key, { at: Date.now(), data });
  if (combineCache.size > 30) combineCache.delete(combineCache.keys().next().value as string);
  return data;
}

/** The most recognisable title of a group released at the same minute (used to group releases). */
export function primaryTitle(titles: string[]) {
  const pri = [/non-farm|nonfarm/i, /core cpi/i, /\bcpi\b/i, /federal funds|fomc/i, /core pce/i, /gdp/i, /retail sales/i, /ppi/i, /ism/i, /jolts/i, /unemployment claims/i];
  const best = [...titles].sort((a, b) => {
    const ia = pri.findIndex(r => r.test(a)), ib = pri.findIndex(r => r.test(b));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  })[0] ?? '';
  return best;
}

/**
 * Normal-day baseline: the same New York clock time on up to 3 nearby weekdays (1 and 2 weeks before, 1 week after)
 * that had NO high-impact USD release. The same merge runs on those moments, so the page can show which numbers
 * are really about the news and which happen at that time of day anyway.
 */
async function baseline(items: NewsItem[]) {
  if (!items.length) return null;
  const dates = items.map(i => i.date).sort();
  const busy = new Set<string>((await pool.query(
    `SELECT DISTINCT to_char(release_utc AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d FROM econ_events
      WHERE currency = 'USD' AND lower(impact) = 'high' AND release_utc >= $1::date - 30 AND release_utc <= $2::date + 30`,
    [dates[0], dates[dates.length - 1]])).rows.map((r: any) => r.d));
  const anchors: { t: number; date: string }[] = [];
  const seen = new Set<number>();
  for (const it of items) {
    const [h, mi] = it.timeEt.split(':').map(Number);
    for (const shift of [-7, -14, 7]) {
      const d = new Date(Date.parse(it.date + 'T12:00:00Z') + shift * 864e5).toISOString().slice(0, 10);
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      if (wd === 0 || wd === 6 || busy.has(d)) continue;
      const t = nyToUtc(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10), h, mi);
      if (seen.has(t)) continue;
      seen.add(t); anchors.push({ t, date: d });
    }
  }
  if (!anchors.length) return null;
  const bars = await windowBars(anchors.map(a => a.t));
  const c = combineEvents(anchors.map(a => ({ anchor: a.t, date: a.date, label: 'normal day', bars: bars.get(a.t) ?? [] })));
  const peak = c.minutes.filter(m => m.off >= 0 && m.off < 5).reduce((x, m) => Math.max(x, m.range), 0);
  return { n: c.n, firstCandle: c.firstCandle, concepts: c.concepts, normalRange1m: c.normalRange1m, peakRange0to5: peak, highAt: c.highAt, lowAt: c.lowAt };
}
