// Footprint (order flow) data for the chart: every NQ trade of one New York session from
// Databento's `trades` schema (aggressor side included), summed per 1-minute bar and price.
//   - One session (9:30-16:00 ET) per request, for the same contract as the chart's bars,
//     so the footprint prices line up with the candles (bars are not back-adjusted).
//   - Before anything is bought the cost is asked from Databento (metadata.get_cost is free)
//     and capped: FOOTPRINT_MAX_USD per day of data (default 1.00) and FOOTPRINT_DAY_USD
//     spent per 24 hours (default 5.00).
//   - Results are cached in footprint_days (about 0.2-0.5 MB of JSON per session), so a day
//     is paid for once. Exchange data: owner-only, like the rest of the chart.
// FOOTPRINT_FAKE=1 (local testing only, never on the server) builds made-up trades from the
// stored 1-minute bars instead of calling Databento.
import pool from '../db';
import { dbGet } from './ingest';

const DATASET = 'GLBX.MDP3';
const TICK = 0.25;
const MONTH_LETTER = ['', 'F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const MAX_USD = () => Number(process.env.FOOTPRINT_MAX_USD) || 1.0;
const DAY_USD = () => Number(process.env.FOOTPRINT_DAY_USD) || 5.0;
const fake = () => process.env.FOOTPRINT_FAKE === '1';
export const footprintConfigured = () => fake() || !!process.env.DATABENTO_API_KEY;

/** [minute start ms, [[price in ticks, buy volume, sell volume], ...]] */
export type FpMinute = [number, [number, number, number][]];
export interface FpDay { day: string; contract: string; tick: number; start: number; end: number; minutes: FpMinute[]; trades: number; volume: number; cost: number; fake?: boolean; }

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS footprint_days (
        sym SMALLINT NOT NULL,
        day DATE NOT NULL,
        contract TEXT NOT NULL,
        cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
        trades INTEGER NOT NULL DEFAULT 0,
        data JSONB NOT NULL,
        fake BOOLEAN NOT NULL DEFAULT FALSE,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (sym, day)
      )`).then(() => undefined).catch(e => { tableReady = null; throw e; });
  }
  return tableReady;
}

/** 9:30 and 16:00 ET of `day` as UTC ms (DST handled by Postgres). */
async function sessionWindow(day: string): Promise<{ start: number; end: number }> {
  const r = await pool.query(
    `SELECT extract(epoch FROM (($1::date + time '09:30') AT TIME ZONE 'America/New_York')) * 1000 AS s,
            extract(epoch FROM (($1::date + time '16:00') AT TIME ZONE 'America/New_York')) * 1000 AS e`, [day]);
  return { start: Number(r.rows[0].s), end: Number(r.rows[0].e) };
}

/** The contract the chart's bars use in that session, as a Databento raw symbol (NQZ6). */
async function contractFor(start: number, end: number): Promise<string | null> {
  const r = await pool.query(
    `SELECT contract, count(*) AS n FROM bars_1m WHERE sym = 1 AND ts >= to_timestamp($1 / 1000.0) AND ts < to_timestamp($2 / 1000.0)
      GROUP BY contract ORDER BY n DESC LIMIT 1`, [start, end]);
  const c = Number(r.rows[0]?.contract) || 0;
  if (!c) return null;
  const yy = Math.floor(c / 100), mm = c % 100;
  if (mm < 1 || mm > 12) return null;
  return `NQ${MONTH_LETTER[mm]}${yy % 10}`;
}

function requestParams(symbol: string | null, start: number, end: number): Record<string, string> {
  return {
    dataset: DATASET, schema: 'trades',
    symbols: symbol || 'NQ.v.0', stype_in: symbol ? 'raw_symbol' : 'continuous',
    start: new Date(start).toISOString(), end: new Date(end).toISOString(),
  };
}

export interface FpStatus {
  day: string; configured: boolean; cached: boolean; contract: string | null; start: number; end: number;
  cost?: number | null; maxUsd: number; spent24h: number; dayUsd: number; message?: string; fake?: boolean;
}

async function spent24h(): Promise<number> {
  const r = await pool.query(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM footprint_days WHERE fetched_at > NOW() - interval '24 hours'`);
  return Number(r.rows[0].s);
}

export async function getCached(day: string): Promise<FpDay | null> {
  await ensureTable();
  const r = await pool.query('SELECT data FROM footprint_days WHERE sym = 1 AND day = $1 AND fake = $2', [day, fake()]);
  return r.rows[0]?.data ?? null;
}

/** Is the day cached; if not, what would it cost (free question to Databento). */
export async function status(day: string, withCost: boolean): Promise<FpStatus> {
  await ensureTable();
  const { start, end } = await sessionWindow(day);
  const cached = !!(await pool.query('SELECT 1 FROM footprint_days WHERE sym = 1 AND day = $1 AND fake = $2', [day, fake()])).rows.length;
  const contract = await contractFor(start, end);
  const base: FpStatus = { day, configured: footprintConfigured(), cached, contract, start, end, maxUsd: MAX_USD(), spent24h: await spent24h(), dayUsd: DAY_USD(), fake: fake() };
  if (cached || !withCost || !base.configured) return base;
  if (!contract) return { ...base, message: 'The chart has no bars for that session.' };
  if (fake()) return { ...base, cost: 0 };
  try {
    const r = await dbGet('metadata.get_cost', requestParams(contract, start, end));
    const cost = Number(await r.text());
    return { ...base, cost: Number.isFinite(cost) ? cost : null };
  } catch (e: any) {
    return { ...base, cost: null, message: e?.message || 'Databento did not give a price.' };
  }
}

/** Sum trades into minutes x price levels. */
class Acc {
  private m = new Map<number, Map<number, [number, number]>>();
  trades = 0; volume = 0;
  add(ms: number, px: number, size: number, side: string) {
    if (!(size > 0) || !Number.isFinite(px)) return;
    const minute = Math.floor(ms / 60000) * 60000, tick = Math.round(px / TICK);
    let lv = this.m.get(minute);
    if (!lv) { lv = new Map(); this.m.set(minute, lv); }
    let c = lv.get(tick);
    if (!c) { c = [0, 0]; lv.set(tick, c); }
    if (side === 'B') c[0] += size; else if (side === 'A') c[1] += size;
    else { c[0] += size / 2; c[1] += size / 2; } // no aggressor (e.g. opening auction): split
    this.trades++; this.volume += size;
  }
  minutes(): FpMinute[] {
    return [...this.m.entries()].sort((a, b) => a[0] - b[0])
      .map(([t, lv]) => [t, [...lv.entries()].sort((a, b) => b[0] - a[0]).map(([p, [b, s]]) => [p, Math.round(b), Math.round(s)] as [number, number, number])]);
  }
}

/** Stream Databento's CSV and feed each trade to the accumulator (a session is ~0.3-1M rows). */
async function readTradesCsv(res: Response, acc: Acc) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', head: string[] | null = null, iTs = -1, iPx = -1, iSz = -1, iSide = -1, iAct = -1;
  const line = (l: string) => {
    if (!l) return;
    const v = l.split(',');
    if (!head) {
      head = v.map(x => x.trim());
      iTs = head.indexOf('ts_event'); iPx = head.indexOf('price'); iSz = head.indexOf('size'); iSide = head.indexOf('side'); iAct = head.indexOf('action');
      if (iTs < 0 || iPx < 0 || iSz < 0 || iSide < 0) throw new Error('Unexpected Databento columns: ' + head.join(','));
      return;
    }
    if (iAct >= 0 && v[iAct] && v[iAct] !== 'T') return;
    const ts = v[iTs];
    const ms = /^\d{16,19}$/.test(ts) ? Number(ts.slice(0, -6)) : Date.parse(ts);
    let px = Number(v[iPx]);
    if (Math.abs(px) > 1e7 && Number.isInteger(px)) px /= 1e9; // fixed-point prices
    acc.add(ms, px, Number(v[iSz]), v[iSide]);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  }
  buf += dec.decode();
  if (buf.trim()) line(buf.trim());
}

/** Made-up trades from the stored 1-minute bars (FOOTPRINT_FAKE=1, local tests only). */
async function fakeTrades(start: number, end: number, acc: Acc) {
  const r = await pool.query(
    `SELECT extract(epoch FROM ts) * 1000 AS t, o / 100.0 AS o, h / 100.0 AS h, l / 100.0 AS l, c / 100.0 AS c, v
       FROM bars_1m WHERE sym = 1 AND ts >= to_timestamp($1 / 1000.0) AND ts < to_timestamp($2 / 1000.0) ORDER BY ts`, [start, end]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const b of r.rows) {
    const o = Number(b.o), h = Number(b.h), l = Number(b.l), c = Number(b.c), v = Number(b.v), t = Number(b.t);
    const levels = Math.max(1, Math.round((h - l) / TICK) + 1);
    const up = c >= o;
    for (let k = 0; k < levels; k++) {
      const px = l + k * TICK;
      const near = 1 - Math.abs(px - (o + c) / 2) / Math.max(TICK, h - l);
      const vol = Math.max(1, Math.round((v / levels) * (0.5 + near) * (0.6 + rnd() * 0.8)));
      const buyShare = Math.min(0.95, Math.max(0.05, (up ? 0.58 : 0.42) + (rnd() - 0.5) * 0.4));
      acc.add(t + 1000, px, Math.round(vol * buyShare), 'B');
      acc.add(t + 2000, px, Math.round(vol * (1 - buyShare)), 'A');
    }
  }
}

/** Buy (with the cost guard) and cache one session. */
export async function load(day: string, confirmUsd: number): Promise<FpDay> {
  const st = await status(day, true);
  if (st.cached) return (await getCached(day))!;
  if (!st.configured) throw Object.assign(new Error('DATABENTO_API_KEY is not set on the server.'), { status: 409 });
  if (!st.contract) throw Object.assign(new Error(st.message || 'No chart bars for that session.'), { status: 404 });
  if (st.cost == null) throw Object.assign(new Error(st.message || 'Could not get the price from Databento.'), { status: 502 });
  if (st.cost > st.maxUsd) throw Object.assign(new Error(`This session costs $${st.cost.toFixed(2)}, above the $${st.maxUsd.toFixed(2)} limit per day (FOOTPRINT_MAX_USD).`), { status: 402 });
  if (st.spent24h + st.cost > st.dayUsd) throw Object.assign(new Error(`Daily footprint budget reached: $${st.spent24h.toFixed(2)} spent in the last 24 hours (limit $${st.dayUsd.toFixed(2)}, FOOTPRINT_DAY_USD).`), { status: 402 });
  if (st.cost > confirmUsd + 0.005) throw Object.assign(new Error(`The price changed to $${st.cost.toFixed(2)}. Check it again.`), { status: 409 });

  const acc = new Acc();
  if (fake()) await fakeTrades(st.start, st.end, acc);
  else {
    const res = await dbGet('timeseries.get_range', { ...requestParams(st.contract, st.start, st.end), encoding: 'csv', compression: 'none', pretty_px: 'true', pretty_ts: 'false' });
    await readTradesCsv(res, acc);
  }
  const data: FpDay = { day, contract: st.contract, tick: TICK, start: st.start, end: st.end, minutes: acc.minutes(), trades: acc.trades, volume: Math.round(acc.volume), cost: st.cost, ...(fake() ? { fake: true } : {}) };
  if (!data.minutes.length) throw Object.assign(new Error('Databento returned no trades for that session.'), { status: 404 });
  await pool.query(
    `INSERT INTO footprint_days (sym, day, contract, cost_usd, trades, data, fake) VALUES (1, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (sym, day) DO NOTHING`, [day, st.contract, st.cost, acc.trades, JSON.stringify(data), fake()]);
  return data;
}

/** Days already bought (newest first). */
export async function listDays(): Promise<{ day: string; contract: string; cost: number; trades: number; fake: boolean }[]> {
  await ensureTable();
  const r = await pool.query(`SELECT day::text AS day, contract, cost_usd, trades, fake FROM footprint_days WHERE sym = 1 AND fake = $1 ORDER BY day DESC`, [fake()]);
  return r.rows.map((x: any) => ({ day: x.day, contract: x.contract, cost: Number(x.cost_usd), trades: x.trades, fake: x.fake }));
}
