// Economic calendar storage (econ_events) + the "what NQ usually does" table. Shared by /api/calendar,
// the news blackout banner and the Telegram alerts.
import fs from 'fs';
import path from 'path';
import pool from '../db';
import { EconEvent, ReactionTable, reactionFor, reactionLine, movePts, surpriseSign, utcToNy, Impact } from '../shared/econCalendar';

let table: ReactionTable | null = null;
export function reactions(): ReactionTable | null {
  if (table) return table;
  for (const p of [path.join(__dirname, 'nqReactions.json'), path.join(__dirname, '../../src/news/nqReactions.json')]) {
    if (fs.existsSync(p)) { table = JSON.parse(fs.readFileSync(p, 'utf8')); return table; }
  }
  return null;
}

// ForexFactory's weekly export has no "actual" column. For the biggest releases the first-release value from FRED
// (src/news/econReleases.json, rebuilt monthly by scripts/news/build_econ_releases.cjs) fills the gap.
const FRED_TITLE: Record<string, { event: string; fmt: (v: number) => string }> = {
  'CPI m/m': { event: 'CPI', fmt: v => `${v.toFixed(1)}%` },
  'PPI m/m': { event: 'PPI', fmt: v => `${v.toFixed(1)}%` },
  'Retail Sales m/m': { event: 'RETAIL', fmt: v => `${v.toFixed(1)}%` },
  'Non-Farm Employment Change': { event: 'NFP', fmt: v => `${Math.round(v)}K` },
};
let fred: Map<string, number> | null = null;
function fredActual(title: string, nyDate: string): string | null {
  const m = FRED_TITLE[title];
  if (!m) return null;
  if (!fred) {
    fred = new Map();
    for (const p of [path.join(__dirname, 'econReleases.json'), path.join(__dirname, '../../src/news/econReleases.json')]) {
      if (!fs.existsSync(p)) continue;
      for (const r of JSON.parse(fs.readFileSync(p, 'utf8')).releases ?? []) if (r.actual != null) fred.set(`${r.event} ${r.date}`, Number(r.actual));
      break;
    }
  }
  const v = fred.get(`${m.event} ${nyDate}`);
  return v == null ? null : m.fmt(v);
}

export interface EventOut extends EconEvent {
  id: number; ny_date: string; ny_time: string; surprise: 'above' | 'below' | 'inline' | null;
  actual_source: 'file' | 'FRED' | null;
  nq: { n: number; absMed1: number; absMed15: number; up15: number; line: string } | null;
}

// latest NQ close in the journal's bars, to turn "% of price" move sizes into today's points (refreshed hourly)
let ref: { price: number | null; at: number } = { price: null, at: 0 };
async function refPrice(): Promise<number | null> {
  if (Date.now() - ref.at < 3600000) return ref.price;
  try {
    const r = await pool.query('SELECT c FROM bars_1m WHERE sym = 1 ORDER BY ts DESC LIMIT 1');
    const c = r.rows[0] ? Number(r.rows[0].c) / 100 : null;
    ref = { price: c && c > 1000 ? c : null, at: Date.now() };
  } catch { ref = { price: null, at: Date.now() }; }
  return ref.price;
}

export async function listEvents(fromMs: number, toMs: number, impacts: Impact[] = ['high', 'medium']): Promise<EventOut[]> {
  const r = await pool.query(
    `SELECT id, release_utc, title, currency, impact, actual, forecast, previous FROM econ_events
      WHERE release_utc >= $1 AND release_utc < $2 AND impact = ANY($3) ORDER BY release_utc, title`,
    [new Date(fromMs).toISOString(), new Date(toMs).toISOString(), impacts]);
  const t = reactions();
  const px = await refPrice();
  return r.rows.map(x => {
    const ms = new Date(x.release_utc).getTime();
    const ny = utcToNy(ms);
    const fill = x.actual == null && ms < Date.now() ? fredActual(x.title, ny.date) : null;
    const actual = x.actual ?? fill;
    const s = surpriseSign(actual, x.forecast);
    const re = reactionFor(t, x.title);
    return {
      id: x.id, release_utc: new Date(ms).toISOString(), title: x.title, currency: x.currency, impact: x.impact,
      actual, actual_source: x.actual != null ? 'file' : fill ? 'FRED' : null,
      forecast: x.forecast, previous: x.previous, ny_date: ny.date, ny_time: ny.time, surprise: s,
      nq: re ? { n: re.n, absMed1: movePts(re, 1, px), absMed15: movePts(re, 15, px), up15: re.up15, line: reactionLine(re, s, px) } : null,
    };
  });
}

/** Upsert parsed events in batches. Returns rows written. */
export async function saveEvents(events: EconEvent[], source: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < events.length; i += 1000) {
    const b = events.slice(i, i + 1000);
    // one row per (time, title, currency): the last copy in the file wins
    const seen = new Map<string, EconEvent>();
    for (const e of b) seen.set(`${e.release_utc}|${e.title}|${e.currency}`, e);
    const rows = [...seen.values()];
    await pool.query(
      `INSERT INTO econ_events (release_utc, title, currency, impact, actual, forecast, previous, source, updated_at)
       SELECT u.t, u.ti, u.cu, u.im, u.ac, u.fo, u.pr, $8, NOW()
         FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS u(t, ti, cu, im, ac, fo, pr)
       ON CONFLICT (release_utc, title, currency) DO UPDATE SET impact = EXCLUDED.impact,
         actual = COALESCE(EXCLUDED.actual, econ_events.actual), forecast = COALESCE(EXCLUDED.forecast, econ_events.forecast),
         previous = COALESCE(EXCLUDED.previous, econ_events.previous), source = EXCLUDED.source, updated_at = NOW()`,
      [rows.map(e => e.release_utc), rows.map(e => e.title), rows.map(e => e.currency), rows.map(e => e.impact),
        rows.map(e => e.actual), rows.map(e => e.forecast), rows.map(e => e.previous), source]);
    n += rows.length;
  }
  return n;
}

export async function coverage() {
  const r = await pool.query(`SELECT count(*)::int AS n, min(release_utc) AS first, max(release_utc) AS last,
    count(*) FILTER (WHERE release_utc > NOW())::int AS upcoming FROM econ_events`);
  return r.rows[0];
}
