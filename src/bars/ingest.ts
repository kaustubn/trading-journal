// Adding new 1-minute bars after the one-time import:
//   - parseBarsCsv / insertBars: the chart page's "Upload bars CSV" (same format as
//     the original files: ts_utc,open,high,low,close,volume,symbol) and Databento CSV
//   - updateFromDatabento: pulls the minutes after the last stored bar from Databento's
//     historical HTTP API (needs DATABENTO_API_KEY). Render's free plan sleeps when idle,
//     so instead of a nightly timer this runs when the chart is opened (at most every
//     30 minutes) or from the chart's Data panel.
import pool from '../db';
import { rebuildAgg, clearMetaCache } from './store';

const MONTHS: Record<string, number> = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 };
const MIN = 60000;

export interface Bar { ts: number; o: number; h: number; l: number; c: number; v: number; contract: number; }

/** NQZ6 (bar in 2026) -> 2612. The year digit resolves to the bar's year or the next one. */
export function contractCode(symbol: string, ts: number): number {
  const m = /^(?:[A-Z]+:)?M?NQ([FGHJKMNQUVXZ])(\d{1,2})$/i.exec(symbol.trim());
  if (!m) return 0;
  const month = MONTHS[m[1].toUpperCase()];
  const year = new Date(ts).getUTCFullYear();
  const digits = m[2];
  for (const y of [year, year + 1]) {
    const tail = String(y).slice(-digits.length);
    if (tail === digits) return (y % 100) * 100 + month;
  }
  return 0;
}

/** Splits a CSV line, allowing double-quoted fields. */
function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "2024-03-05T14:30" / ISO with seconds or nanoseconds / epoch ns or ms -> epoch ms */
function parseTs(raw: string): number {
  const s = raw.trim();
  if (/^\d{16,19}$/.test(s)) return Math.round(Number(s.slice(0, -6)) / 1000) * 1000; // epoch ns -> ms (minute bars are whole seconds)
  if (/^\d{12,13}$/.test(s)) return Number(s);
  let iso = s.replace(' ', 'T');
  iso = iso.replace(/(\.\d{3})\d+/, '$1');                 // trim nanoseconds
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00';
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += 'Z';      // no zone means UTC
  return Date.parse(iso);
}

/** Prices may come as decimals (21345.25) or Databento fixed-point integers (1e-9 units). */
function parsePx(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.abs(n) > 1e7 && Number.isInteger(n) ? n / 1e9 : n;
}

export interface ParseResult { bars: Bar[]; bad: number; firstBad: string[]; skipped: number; }

/**
 * Parses bars from our own CSV format or Databento's ohlcv-1m CSV.
 * Needs a time column (ts_utc or ts_event) and open/high/low/close/volume;
 * symbol is optional (spreads such as NQZ6-NQH7 are skipped).
 */
export function parseBarsCsv(text: string, fallbackContract = 0): ParseResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { bars: [], bad: 0, firstBad: [], skipped: 0 };
  const head = splitCsv(lines[0]).map(h => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map(n => head.indexOf(n)).find(i => i >= 0) ?? -1;
  const iT = col('ts_utc', 'ts_event', 'timestamp', 'time'), iO = col('open'), iH = col('high'), iL = col('low');
  const iC = col('close'), iV = col('volume'), iS = col('symbol', 'raw_symbol');
  if (iT < 0 || iO < 0 || iH < 0 || iL < 0 || iC < 0) {
    throw new Error(`CSV needs columns ts_utc (or ts_event), open, high, low, close, volume — found: ${head.join(', ')}`);
  }
  const bars: Bar[] = []; const firstBad: string[] = []; let bad = 0, skipped = 0;
  for (let n = 1; n < lines.length; n++) {
    const f = splitCsv(lines[n]);
    const sym = iS >= 0 ? (f[iS] || '').trim() : '';
    if (sym.includes('-')) { skipped++; continue; }       // calendar spreads
    const ts = parseTs(f[iT] || '');
    const o = parsePx(f[iO]), h = parsePx(f[iH]), l = parsePx(f[iL]), c = parsePx(f[iC]);
    const v = iV >= 0 ? Number(f[iV]) : 0;
    const ok = Number.isFinite(ts) && ts % MIN === 0 && [o, h, l, c].every(x => Number.isFinite(x) && x > 0)
      && Number.isFinite(v) && v >= 0 && h >= Math.max(o, c) && l <= Math.min(o, c);
    if (!ok) { bad++; if (firstBad.length < 5) firstBad.push(`line ${n + 1}: ${lines[n].slice(0, 120)}`); continue; }
    const code = sym ? contractCode(sym, ts) : 0;
    bars.push({
      ts, o: Math.round(o * 100), h: Math.round(h * 100), l: Math.round(l * 100), c: Math.round(c * 100),
      v: Math.round(v), contract: code || fallbackContract,
    });
  }
  return { bars, bad, firstBad, skipped };
}

/** Insert bars (existing minutes are left alone), then rebuild the hourly/daily bars they touch. */
export async function insertBars(bars: Bar[], sym = 1): Promise<{ inserted: number; first: number | null; last: number | null }> {
  if (!bars.length) return { inserted: 0, first: null, last: null };
  let inserted = 0;
  for (let i = 0; i < bars.length; i += 5000) {
    const chunk = bars.slice(i, i + 5000);
    const r = await pool.query(
      `INSERT INTO bars_1m (ts, o, h, l, c, v, sym, contract)
       SELECT * FROM unnest($1::timestamptz[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::smallint[], $8::smallint[])
       ON CONFLICT (sym, ts) DO NOTHING`,
      [chunk.map(b => new Date(b.ts).toISOString()), chunk.map(b => b.o), chunk.map(b => b.h), chunk.map(b => b.l),
       chunk.map(b => b.c), chunk.map(b => b.v), chunk.map(() => sym), chunk.map(b => b.contract)]);
    inserted += r.rowCount || 0;
  }
  const first = Math.min(...bars.map(b => b.ts)), last = Math.max(...bars.map(b => b.ts));
  if (inserted > 0) await rebuildAgg(sym, new Date(first));
  clearMetaCache();
  return { inserted, first, last };
}

// ---------- Databento ----------
const DB_BASE = 'https://hist.databento.com/v0';
const DATASET = 'GLBX.MDP3';
const MAX_SPAN = 45 * 24 * 3600 * 1000; // one request covers at most 45 days

export interface UpdateResult {
  ok: boolean; message: string; inserted?: number; from?: string; to?: string; at: string;
  availEnd?: string; // how far Databento says its ohlcv-1m data goes (ISO)
}
let running: Promise<UpdateResult> | null = null;
let lastAttempt = 0;
let lastResult: UpdateResult | null = null;
let lastAvailEnd: number | null = null;

export function updateStatus() {
  return { configured: !!process.env.DATABENTO_API_KEY, lastAttempt: lastAttempt || null, lastResult };
}

async function dbGet(path: string, params: Record<string, string>): Promise<Response> {
  const key = process.env.DATABENTO_API_KEY!;
  const url = `${DB_BASE}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`Databento ${path} answered ${res.status}: ${body}`);
  }
  return res;
}

/** Contract (YYMM) in force on each UTC day, from Databento's symbology for NQ.v.0. */
async function contractsByDay(start: Date, end: Date): Promise<(ts: number) => number> {
  try {
    const res = await dbGet('symbology.resolve', {
      dataset: DATASET, symbols: 'NQ.v.0', stype_in: 'continuous', stype_out: 'raw_symbol',
      start_date: start.toISOString().slice(0, 10), end_date: new Date(end.getTime() + 86400000).toISOString().slice(0, 10),
    });
    const j: any = await res.json();
    const spans: { d0: string; d1: string; s: string }[] = j?.result?.['NQ.v.0'] || [];
    return (ts: number) => {
      const day = new Date(ts).toISOString().slice(0, 10);
      const hit = spans.find(x => x.d0 <= day && day < x.d1);
      return hit ? contractCode(String(hit.s), ts) : 0;
    };
  } catch (e: any) {
    console.warn('[bars/update] symbology lookup failed, keeping the last contract:', e.message);
    return () => 0;
  }
}

async function runUpdate(): Promise<UpdateResult> {
  const at = new Date().toISOString();
  const last = await pool.query('SELECT MAX(ts) AS ts, (array_agg(contract ORDER BY ts DESC))[1] AS contract FROM bars_1m WHERE sym = 1');
  const lastTs: Date | null = last.rows[0]?.ts ? new Date(last.rows[0].ts) : null;
  if (!lastTs) return { ok: false, message: 'No bars stored yet — import the history first.', at };
  const lastContract: number = Number(last.rows[0].contract) || 0;

  const rangeRes = await dbGet('metadata.get_dataset_range', { dataset: DATASET });
  const range: any = await rangeRes.json();
  const availEnd = new Date(range?.schema?.['ohlcv-1m']?.end || range?.end);
  if (Number.isNaN(availEnd.getTime())) throw new Error('Databento did not report how far its data goes.');

  const start = new Date(lastTs.getTime() + MIN);
  let end = new Date(Math.floor(Math.min(availEnd.getTime(), Date.now()) / MIN) * MIN);
  if (end.getTime() - start.getTime() < MIN) {
    return { ok: true, message: `Up to date (Databento has data to ${availEnd.toISOString().slice(0, 16)}Z).`, inserted: 0, at, availEnd: availEnd.toISOString() };
  }
  if (end.getTime() - start.getTime() > MAX_SPAN) end = new Date(start.getTime() + MAX_SPAN);

  const contractAt = await contractsByDay(start, end);
  const res = await dbGet('timeseries.get_range', {
    dataset: DATASET, schema: 'ohlcv-1m', symbols: 'NQ.v.0', stype_in: 'continuous',
    start: start.toISOString(), end: end.toISOString(),
    encoding: 'csv', compression: 'none', pretty_px: 'true', pretty_ts: 'true', map_symbols: 'true',
  });
  const parsed = parseBarsCsv(await res.text(), 0);
  let carry = lastContract;
  for (const b of parsed.bars) {
    const c = b.contract || contractAt(b.ts) || carry;
    b.contract = c; carry = c;
  }
  const r = await insertBars(parsed.bars, 1);
  const more = end.getTime() < Math.min(availEnd.getTime(), Date.now()) - MIN ? ' More remains — run the update again.' : '';
  return {
    ok: true, inserted: r.inserted, from: start.toISOString(), to: end.toISOString(), at, availEnd: availEnd.toISOString(),
    message: `Added ${r.inserted.toLocaleString('en-US')} bars (${start.toISOString().slice(0, 16)}Z → ${end.toISOString().slice(0, 16)}Z)` +
      (parsed.bad ? `, ${parsed.bad} unreadable rows skipped` : '') + '.' + more,
  };
}

/** Fetch new bars from Databento. Concurrent callers share one run. */
export function updateFromDatabento(): Promise<UpdateResult> {
  if (!process.env.DATABENTO_API_KEY) {
    return Promise.resolve({ ok: false, message: 'DATABENTO_API_KEY is not set on the server.', at: new Date().toISOString() });
  }
  if (running) return running;
  lastAttempt = Date.now();
  running = runUpdate()
    .catch((e: any): UpdateResult => ({ ok: false, message: e?.message || 'Update failed', at: new Date().toISOString() }))
    .then(r => { lastResult = r; if (r.ok && r.availEnd) lastAvailEnd = Date.parse(r.availEnd); console.log('[bars/update]', r.message); return r; })
    .finally(() => { running = null; });
  return running;
}

/** Called when the chart loads: start an update in the background at most every 30 minutes. */
export function maybeAutoUpdate() {
  if (!process.env.DATABENTO_API_KEY || running) return;
  if (Date.now() - lastAttempt < 30 * MIN) return;
  void updateFromDatabento();
}

/**
 * Called by the open chart about once a minute: pull new bars if the last attempt was
 * 50+ seconds ago (sharing the single-flight lock), and report how current the data is.
 */
export async function liveTick(): Promise<{
  configured: boolean; last: number | null; availEnd: number | null; delayMin: number | null; updated: boolean; message?: string;
}> {
  const readLast = async (): Promise<number | null> => {
    const r = await pool.query('SELECT MAX(ts) AS ts FROM bars_1m WHERE sym = 1');
    return r.rows[0]?.ts ? new Date(r.rows[0].ts).getTime() : null;
  };
  if (!process.env.DATABENTO_API_KEY) {
    return { configured: false, last: await readLast(), availEnd: null, delayMin: null, updated: false };
  }
  let updated = false;
  if (running) {
    await running;
  } else if (Date.now() - lastAttempt >= 50 * 1000) {
    const r = await updateFromDatabento();
    updated = r.ok && (r.inserted || 0) > 0;
  }
  const last = await readLast();
  return {
    configured: true, last, availEnd: lastAvailEnd,
    delayMin: lastAvailEnd ? Math.max(0, Math.round((Date.now() - lastAvailEnd) / 60000)) : null,
    updated, message: lastResult?.message,
  };
}
