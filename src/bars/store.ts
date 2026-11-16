import pool from '../db';

// Market bars (own data, 1-minute NQ). Prices are stored as integer price x 100
// and the symbol as a small code, which roughly halves the table on a 0.5 GB plan.
//   bars_1m  : raw 1-minute bars, UTC
//   bars_agg : precomputed 1-hour (tf=60) and daily (tf=1440) bars, so the higher
//              timeframes never scan the 1-minute table

export const SYMBOLS: Record<string, number> = { NQ: 1 };
export const TIMEFRAMES = [1, 3, 5, 15, 30, 60, 240, 1440] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const ET = 'America/New_York';
// Fixed UTC origin for date_bin. 1/3/5/15/30/60-minute buckets all divide the hour,
// so UTC-aligned buckets are also ET-aligned (and session-aligned, like TradingView).
const ORIGIN = "TIMESTAMPTZ '2000-01-01 00:00:00+00'";
// 4-hour bars anchor on the 6pm ET session open: 18, 22, 02, 06, 10, 14 ET.
const BUCKET_4H = (col: string) =>
  `(date_bin('4 hours', ${col} AT TIME ZONE '${ET}', TIMESTAMP '2000-01-01 02:00') AT TIME ZONE '${ET}')`;
// CME session day: 6pm ET -> 5pm ET, dated by the day it ends on.
const SESSION_DATE = (col: string) => `((${col} AT TIME ZONE '${ET}') + interval '6 hours')::date`;
// Daily bars are stamped at noon ET of the session date, so the date label reads
// the same whether the chart clock is set to ET or BC.
const DAILY_TS = (dateExpr: string) => `((${dateExpr} + time '12:00') AT TIME ZONE '${ET}')`;

// Tables are created in src/db/index.ts (initializeDB).

const OHLCV = `(array_agg(o ORDER BY ts))[1] AS o, max(h) AS h, min(l) AS l,
               (array_agg(c ORDER BY ts DESC))[1] AS c, sum(v)::int AS v`;

/**
 * Rebuild the precomputed hourly + daily bars from `from` onward (everything if
 * omitted). Safe to re-run: the affected range is deleted and recomputed.
 */
export async function rebuildAgg(sym: number, from?: Date): Promise<{ hourly: number; daily: number }> {
  const start = from ?? new Date(0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Hourly, from the start of the hour containing `from`
    await client.query(
      `DELETE FROM bars_agg WHERE sym = $1 AND tf = 60 AND ts >= date_bin('1 hour', $2::timestamptz, ${ORIGIN})`,
      [sym, start]);
    const h = await client.query(
      `INSERT INTO bars_agg (ts, o, h, l, c, v, sym, tf)
       SELECT date_bin('1 hour', ts, ${ORIGIN}) AS b, ${OHLCV}, $1, 60
         FROM bars_1m
        WHERE sym = $1 AND ts >= date_bin('1 hour', $2::timestamptz, ${ORIGIN})
        GROUP BY b`,
      [sym, start]);

    // Daily, built from the hourly bars (the session boundary is on the hour),
    // from the start of the session containing `from`
    const sessionOf = SESSION_DATE('$2::timestamptz');
    await client.query(
      `DELETE FROM bars_agg WHERE sym = $1 AND tf = 1440 AND ts >= ${DAILY_TS(sessionOf)}`,
      [sym, start]);
    const d = await client.query(
      `INSERT INTO bars_agg (ts, o, h, l, c, v, sym, tf)
       SELECT ${DAILY_TS('sd')}, o, h, l, c, v, $1, 1440 FROM (
         SELECT ${SESSION_DATE('ts')} AS sd, ${OHLCV}
           FROM bars_agg
          WHERE sym = $1 AND tf = 60 AND ${SESSION_DATE('ts')} >= ${sessionOf}
          GROUP BY sd
       ) x`,
      [sym, start]);

    await client.query('COMMIT');
    metaCache.delete(sym);
    return { hourly: h.rowCount || 0, daily: d.rowCount || 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export interface BarsQuery { sym: number; tf: Timeframe; from?: Date; to?: Date; limit: number; }
export type BarRow = [number, number, number, number, number, number]; // [ms, o, h, l, c, v]

/**
 * Latest `limit` bars in [from, to). `from` is snapped down to a bucket start, so
 * the oldest bar returned is never a partial bucket. Without `from`, only as much
 * history as `limit` bars can need is scanned.
 */
export async function getBars(q: BarsQuery): Promise<BarRow[]> {
  const { sym, tf, limit } = q;
  const to = q.to ?? new Date(Date.now() + 86400000);
  // Calendar span that `limit` bars can cover: the market is open ~23h x 5 days a
  // week, so allow 1.6x plus a few days for weekends and holidays.
  const from = q.from ?? new Date(to.getTime() - Math.ceil(limit * tf * 60000 * 1.6) - 5 * 86400000);

  let sql: string;
  if (tf === 1) {
    sql = `SELECT ts AS b, o, h, l, c, v FROM bars_1m
            WHERE sym = $1 AND ts >= $2 AND ts < $3`;
  } else if (tf === 60 || tf === 1440) {
    sql = `SELECT ts AS b, o, h, l, c, v FROM bars_agg
            WHERE sym = $1 AND tf = ${tf} AND ts >= $2 AND ts < $3`;
  } else if (tf === 240) {
    sql = `SELECT ${BUCKET_4H('ts')} AS b, ${OHLCV} FROM bars_agg
            WHERE sym = $1 AND tf = 60 AND ts >= ${BUCKET_4H('$2::timestamptz')} AND ts < $3
            GROUP BY b`;
  } else {
    const bin = (col: string) => `date_bin('${tf} minutes', ${col}, ${ORIGIN})`;
    sql = `SELECT ${bin('ts')} AS b, ${OHLCV} FROM bars_1m
            WHERE sym = $1 AND ts >= ${bin('$2::timestamptz')} AND ts < $3
            GROUP BY b`;
  }

  const r = await pool.query(`${sql} ORDER BY b DESC LIMIT $4`, [sym, from, to, limit]);
  return r.rows.reverse().map((x: any): BarRow =>
    [new Date(x.b).getTime(), x.o / 100, x.h / 100, x.l / 100, x.c / 100, Number(x.v)]);
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
