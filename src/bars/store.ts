import pool from '../db';

// Market bars (own data, 1-minute NQ). Prices are stored as integer price x 100
// and the symbol as a small code, which roughly halves the table on a 0.5 GB plan.
//   bars_1m  : raw 1-minute bars, UTC
//   bars_agg : precomputed bars, so the higher timeframes never scan the 1-minute table
//                tf 60   = hourly, full session        tf 1440 = daily, full CME session
//                tf 61   = hourly, RTH only (:30)      tf 1441 = daily, RTH only
// Tables are created in src/db/index.ts (initializeDB).

export const SYMBOLS: Record<string, number> = { NQ: 1 };
export const TIMEFRAMES = [1, 3, 5, 15, 30, 60, 240, 1440] as const; // the buttons; any minutes < 1440 work
export type Timeframe = number;
export const validTimeframe = (n: number) => Number.isInteger(n) && ((n >= 1 && n < 1440) || n === 1440);

const ET = 'America/New_York';
const local = (col: string) => `(${col} AT TIME ZONE '${ET}')`;
// Fixed UTC origins for date_bin. 1/3/5/15/30/60-minute buckets all divide the hour,
// so UTC-aligned buckets are also ET-aligned (and session-aligned, like TradingView).
const ORIGIN = "TIMESTAMPTZ '2000-01-01 00:00:00+00'";
const ORIGIN_30 = "TIMESTAMPTZ '2000-01-01 00:30:00+00'"; // RTH hours run 9:30, 10:30, ...
// 4-hour bars anchor on the session open: 18, 22, 02, 06, 10, 14 ET (full session)
// or 9:30, 13:30 ET (RTH).
const bucket4h = (anchor: string) => (col: string) =>
  `(date_bin('4 hours', ${local(col)}, TIMESTAMP '2000-01-01 ${anchor}') AT TIME ZONE '${ET}')`;
const binMinutes = (tf: number) => (col: string) => `date_bin('${tf} minutes', ${col}, ${ORIGIN})`;
// Any other timeframe counts from each session's open (6pm ET, or 9:30am ET for RTH), like TradingView.
const binSession = (tf: number, rth: boolean) => (col: string) => {
  const origin = rth
    ? `date_trunc('day', ${local(col)}) + interval '9 hours 30 minutes'`
    : `date_trunc('day', ${local(col)} + interval '6 hours') - interval '6 hours'`;
  return `(date_bin('${tf} minutes', ${local(col)}, ${origin}) AT TIME ZONE '${ET}')`;
};
// CME session day: 6pm ET -> 5pm ET, dated by the day it ends on.
const SESSION_DATE = (col: string) => `(${local(col)} + interval '6 hours')::date`;
// Daily bars are stamped at noon ET of their date, so the date label reads the
// same whether the chart clock is set to ET or BC.
const DAILY_TS = (dateExpr: string) => `((${dateExpr} + time '12:00') AT TIME ZONE '${ET}')`;
// Regular trading hours: 9:30am-4pm ET
const RTH = (col: string) => `(${local(col)}::time >= '09:30' AND ${local(col)}::time < '16:00')`;

const OHLCV = `(array_agg(o ORDER BY ts))[1] AS o, max(h) AS h, min(l) AS l,
               (array_agg(c ORDER BY ts DESC))[1] AS c, sum(v)::int AS v`;

/**
 * Rebuild the precomputed bars from `from` onward (everything if omitted).
 * Safe to re-run: the affected range is deleted and recomputed.
 */
export async function rebuildAgg(sym: number, from?: Date): Promise<Record<string, number>> {
  const start = from ?? new Date(0);
  const client = await pool.connect();
  const out: Record<string, number> = {};
  try {
    await client.query('BEGIN');
    const run = async (label: string, tf: number, cutoff: string, select: string) => {
      await client.query(`DELETE FROM bars_agg WHERE sym = $1 AND tf = ${tf} AND ts >= ${cutoff}`, [sym, start]);
      const r = await client.query(
        `INSERT INTO bars_agg (ts, o, h, l, c, v, sym, tf) SELECT b, o, h, l, c, v, $1, ${tf} FROM (${select}) x`,
        [sym, start]);
      out[label] = r.rowCount || 0;
    };

    // Hourly, from the start of the hour containing `from`
    const hourOf = `date_bin('1 hour', $2::timestamptz, ${ORIGIN})`;
    await run('hourly', 60, hourOf,
      `SELECT date_bin('1 hour', ts, ${ORIGIN}) AS b, ${OHLCV}
         FROM bars_1m WHERE sym = $1 AND ts >= ${hourOf} GROUP BY b`);

    // Daily, built from the hourly bars (the session boundary is on the hour),
    // from the start of the session containing `from`
    const sessionOf = SESSION_DATE('$2::timestamptz');
    await run('daily', 1440, DAILY_TS(sessionOf),
      `SELECT ${DAILY_TS('sd')} AS b, o, h, l, c, v FROM (
         SELECT ${SESSION_DATE('ts')} AS sd, ${OHLCV} FROM bars_agg
          WHERE sym = $1 AND tf = 60 AND ${SESSION_DATE('ts')} >= ${sessionOf} GROUP BY sd) d`);

    // RTH hourly (9:30, 10:30, ... 15:30) straight from the 1-minute bars
    const rthHourOf = `date_bin('1 hour', $2::timestamptz, ${ORIGIN_30})`;
    await run('rthHourly', 61, rthHourOf,
      `SELECT date_bin('1 hour', ts, ${ORIGIN_30}) AS b, ${OHLCV}
         FROM bars_1m WHERE sym = $1 AND ts >= ${rthHourOf} AND ${RTH('ts')} GROUP BY b`);

    // RTH daily, from the RTH hourly bars
    const dayOf = `${local('$2::timestamptz')}::date`;
    await run('rthDaily', 1441, DAILY_TS(dayOf),
      `SELECT ${DAILY_TS('sd')} AS b, o, h, l, c, v FROM (
         SELECT ${local('ts')}::date AS sd, ${OHLCV} FROM bars_agg
          WHERE sym = $1 AND tf = 61 AND ${local('ts')}::date >= ${dayOf} GROUP BY sd) d`);

    await client.query('COMMIT');
    metaCache.delete(sym);
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export interface BarsQuery {
  sym: number; tf: Timeframe; limit: number;
  rth?: boolean;   // regular trading hours only
  from?: Date;     // inclusive lower bound (snapped down to a bucket start)
  to?: Date;       // exclusive upper bound
  after?: Date;    // forward paging: the earliest `limit` bars that start after this time
}
export type BarRow = [number, number, number, number, number, number]; // [ms, o, h, l, c, v]

// Where a timeframe's bars come from, and how raw rows are grouped into buckets.
function source(tf: Timeframe, rth: boolean) {
  const rthCond = rth ? `AND ${RTH('ts')}` : '';
  if (tf === 1) return { table: 'bars_1m', cond: rthCond, bucket: null };
  if (tf === 60) return { table: 'bars_agg', cond: `AND tf = ${rth ? 61 : 60}`, bucket: null };
  if (tf === 1440) return { table: 'bars_agg', cond: `AND tf = ${rth ? 1441 : 1440}`, bucket: null };
  if (tf === 240) return { table: 'bars_agg', cond: `AND tf = ${rth ? 61 : 60}`, bucket: bucket4h(rth ? '09:30' : '02:00') };
  if (tf % 60 === 0) return { table: 'bars_agg', cond: `AND tf = ${rth ? 61 : 60}`, bucket: binSession(tf, rth) };
  if (60 % tf === 0) return { table: 'bars_1m', cond: rthCond, bucket: binMinutes(tf) };
  return { table: 'bars_1m', cond: rthCond, bucket: binSession(tf, rth) };
}

/**
 * Bars for a timeframe, oldest first.
 *  - default: the latest `limit` bars in [from, to)
 *  - with `after`: the earliest `limit` bars that start after it (forward paging)
 * Bounds are snapped to bucket starts, so no bar returned is built from part of a
 * bucket (except a `to` the caller sets mid-bucket on purpose). When a bound is
 * missing, only as much history as `limit` bars can need is scanned.
 */
export async function getBars(q: BarsQuery): Promise<BarRow[]> {
  const { sym, tf, limit } = q;
  const rth = !!q.rth;
  const src = source(tf, rth);
  // Calendar span `limit` bars can cover. The market is open ~23h x 5 days a week
  // (6.5h x 5 for RTH), so scale up and add a few days for weekends and holidays.
  const span = Math.ceil(limit * tf * 60000 * (rth ? 5.7 : 1.6)) + 5 * 86400000;
  const snap = (p: string) => (src.bucket ? src.bucket(`${p}::timestamptz`) : p);
  const cols = src.bucket ? `${src.bucket('ts')} AS b, ${OHLCV}` : 'ts AS b, o, h, l, c, v';
  const group = src.bucket ? 'GROUP BY b' : '';

  let sql: string, params: unknown[];
  if (q.after) {
    const to = q.to ?? new Date(q.after.getTime() + span);
    sql = `SELECT * FROM (
             SELECT ${cols} FROM ${src.table}
              WHERE sym = $1 ${src.cond} AND ts >= ${snap('$2')} AND ts < ${q.to ? '$3' : snap('$3')} ${group}
           ) x WHERE b > $2 ORDER BY b ASC LIMIT $4`;
    params = [sym, q.after, to, limit];
  } else {
    const to = q.to ?? new Date(Date.now() + 86400000);
    const from = q.from ?? new Date(to.getTime() - span);
    sql = `SELECT * FROM (
             SELECT ${cols} FROM ${src.table}
              WHERE sym = $1 ${src.cond} AND ts >= ${snap('$2')} AND ts < $3 ${group}
           ) x ORDER BY b DESC LIMIT $4`;
    params = [sym, from, to, limit];
  }

  const r = await pool.query(sql, params);
  const rows = q.after ? r.rows : r.rows.reverse();
  return rows.map((x: any): BarRow =>
    [new Date(x.b).getTime(), x.o / 100, x.h / 100, x.l / 100, x.c / 100, Number(x.v)]);
}

export interface Levels {
  session: string;            // session date (YYYY-MM-DD), the day the session ends on
  start: number;              // 6pm ET open
  nyStart: number;            // 9:30am ET
  end: number;                // 5pm ET close
  prev: { date: string; o: number; h: number; l: number; c: number } | null; // previous full session
  /** The previous session split into Asia (6pm-2am ET), London (2-9:30am) and New York (9:30am-4pm): open, high, low, close. */
  prevSessions: Partial<Record<'asia' | 'london' | 'ny', { o: number; h: number; l: number; c: number }>> | null;
  open: number | null;        // session open (6pm ET)
  nyOpen: number | null;      // 9:30am ET open
  overnight: { h: number; l: number } | null; // 6pm -> 9:30am ET
}

/**
 * Key levels for the session containing `at`, using only bars up to `at` — so
 * the values are safe to show during replay (nothing from the future).
 */
export async function getLevels(sym: number, at: Date): Promise<Levels | null> {
  const r = await pool.query(
    `WITH p AS (
       SELECT sd,
              ((sd - 1) + time '18:00') AT TIME ZONE '${ET}' AS s0,
              (sd + time '09:30') AT TIME ZONE '${ET}' AS ny,
              (sd + time '17:00') AT TIME ZONE '${ET}' AS s1
         FROM (SELECT ${SESSION_DATE('$2::timestamptz')} AS sd) q)
     SELECT p.sd::text AS sd, p.s0, p.ny, p.s1,
            (SELECT o FROM bars_1m WHERE sym = $1 AND ts >= p.s0 AND ts <= $2 ORDER BY ts LIMIT 1) AS open,
            (SELECT o FROM bars_1m WHERE sym = $1 AND ts >= p.ny AND ts < p.s1 AND ts <= $2 ORDER BY ts LIMIT 1) AS ny_open,
            (SELECT max(h) FROM bars_1m WHERE sym = $1 AND ts >= p.s0 AND ts < p.ny AND ts <= $2) AS on_h,
            (SELECT min(l) FROM bars_1m WHERE sym = $1 AND ts >= p.s0 AND ts < p.ny AND ts <= $2) AS on_l,
            d.o AS pd_o, d.h AS pd_h, d.l AS pd_l, d.c AS pd_c, ${local('d.ts')}::date::text AS pd_date
       FROM p
       LEFT JOIN LATERAL (
         SELECT ts, o, h, l, c FROM bars_agg
          WHERE sym = $1 AND tf = 1440 AND ts < ${DAILY_TS('p.sd')} ORDER BY ts DESC LIMIT 1) d ON true`,
    [sym, at]);
  const x = r.rows[0];
  if (!x) return null;
  const px = (v: any) => (v === null || v === undefined ? null : Number(v) / 100);
  const ms = (d: any) => new Date(d).getTime();
  // previous session by part (one small grouped read of that day's 1-minute bars)
  let prevSessions: Levels['prevSessions'] = null;
  if (x.pd_date) {
    const s = await pool.query(
      `SELECT k, (array_agg(o ORDER BY ts))[1] AS o, max(h) AS h, min(l) AS l, (array_agg(c ORDER BY ts DESC))[1] AS c FROM (
         SELECT ts, o, h, l, c,
                CASE WHEN ts < ($2::date + time '02:00') AT TIME ZONE '${ET}' THEN 'asia'
                     WHEN ts < ($2::date + time '09:30') AT TIME ZONE '${ET}' THEN 'london' ELSE 'ny' END AS k
           FROM bars_1m
          WHERE sym = $1 AND ts >= (($2::date - 1) + time '18:00') AT TIME ZONE '${ET}' AND ts < ($2::date + time '16:00') AT TIME ZONE '${ET}') q
       GROUP BY k`, [sym, x.pd_date]);
    prevSessions = {};
    for (const r2 of s.rows) prevSessions[r2.k as 'asia' | 'london' | 'ny'] = { o: px(r2.o)!, h: px(r2.h)!, l: px(r2.l)!, c: px(r2.c)! };
  }
  return {
    session: x.sd, start: ms(x.s0), nyStart: ms(x.ny), end: ms(x.s1),
    prev: x.pd_h === null ? null : { date: x.pd_date, o: px(x.pd_o)!, h: px(x.pd_h)!, l: px(x.pd_l)!, c: px(x.pd_c)! },
    prevSessions,
    open: px(x.open), nyOpen: px(x.ny_open),
    overnight: x.on_h === null ? null : { h: px(x.on_h)!, l: px(x.on_l)! },
  };
}

const MONTH_CODES = 'FGHJKMNQUVXZ';
/** Contract stored as expiry YYMM (2403) -> ticker (NQH4). */
export function contractTicker(root: string, yymm: number): string {
  const yy = Math.floor(yymm / 100), mm = yymm % 100;
  return `${root}${MONTH_CODES[mm - 1] || '?'}${yy % 10}`;
}

export interface BarsMeta {
  symbol: string; first: number | null; last: number | null; count: number;
  rolls: { contract: string; from: number }[];
}
const metaCache = new Map<number, { at: number; meta: BarsMeta }>();

/** Data range, row count and contract roll dates. Cached: the roll scan reads the whole table. */
export async function getMeta(symbol: string, sym: number): Promise<BarsMeta> {
  const hit = metaCache.get(sym);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.meta;
  const r = await pool.query(
    `SELECT contract, MIN(ts) AS first, MAX(ts) AS last, COUNT(*)::int AS n
       FROM bars_1m WHERE sym = $1 GROUP BY contract ORDER BY MIN(ts)`, [sym]);
  const ms = (d: any) => new Date(d).getTime();
  const meta: BarsMeta = {
    symbol,
    first: r.rows.length ? ms(r.rows[0].first) : null,
    last: r.rows.length ? Math.max(...r.rows.map((x: any) => ms(x.last))) : null,
    count: r.rows.reduce((s: number, x: any) => s + x.n, 0),
    rolls: r.rows.map((x: any) => ({ contract: contractTicker(symbol, x.contract), from: ms(x.first) })),
  };
  metaCache.set(sym, { at: Date.now(), meta });
  return meta;
}

export function clearMetaCache() { metaCache.clear(); }
