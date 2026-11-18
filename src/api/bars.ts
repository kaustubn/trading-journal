import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import pool from '../db';
import { requireAdmin } from '../middleware/admin';
import { SYMBOLS, Timeframe, validTimeframe, getBars, getMeta, getLevels } from '../bars/store';
import { parseBarsCsv, insertBars, updateFromDatabento, maybeAutoUpdate, updateStatus, liveTick } from '../bars/ingest';

const router = Router();
router.use(verifyToken, requireAdmin);

const MAX_BARS = 5000;
const DEFAULT_BARS = 1500;

function parseTf(raw: unknown): Timeframe | null {
  const s = String(raw ?? '5').trim().toUpperCase();
  const n = s === 'D' || s === '1D' ? 1440 : Number(s);
  return validTimeframe(n) ? n : null;
}

function parseTime(raw: unknown): Date | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  const s = String(raw);
  const d = /^\d+$/.test(s) ? new Date(Number(s)) : new Date(s); // epoch ms or ISO
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSymbol(req: Request, res: Response): { symbol: string; sym: number } | null {
  const symbol = String(req.query.symbol || 'NQ').toUpperCase();
  const sym = SYMBOLS[symbol];
  if (!sym) { res.status(400).json({ error: `Unknown symbol ${symbol}` }); return null; }
  return { symbol, sym };
}

// GET /api/bars?symbol=NQ&tf=5&from=&to=&after=&limit=1500&rth=1
// Bars come back oldest first as compact rows [timeMs, open, high, low, close, volume].
//   default  : the latest `limit` bars in [from, to)
//   after=<t>: the earliest `limit` bars starting after t (forward paging)
// Times are ISO dates or epoch ms. `rth=1` keeps regular trading hours only (9:30am-4pm ET).
// To page back, call again with `to` = the time of the oldest bar received.
// `older` / `newer` say whether more data exists on each side.
router.get('/', async (req: Request, res: Response) => {
  try {
    const s = parseSymbol(req, res);
    if (!s) return;
    const tf = parseTf(req.query.tf);
    if (!tf) return res.status(400).json({ error: 'tf must be whole minutes from 1 to 1439, or D' });
    const from = parseTime(req.query.from), to = parseTime(req.query.to), after = parseTime(req.query.after);
    if (from === null || to === null || after === null) {
      return res.status(400).json({ error: 'from/to/after must be ISO dates or epoch ms' });
    }
    const limit = Math.min(MAX_BARS, Math.max(1, Number(req.query.limit) || DEFAULT_BARS));
    const rth = req.query.rth === '1' || req.query.rth === 'true';

    const [bars, meta] = await Promise.all([
      getBars({ sym: s.sym, tf, from, to, after, limit, rth }),
      getMeta(s.symbol, s.sym),
    ]);
    // A bar's time is its bucket start; a daily bar is stamped at noon of its day,
    // i.e. up to 18h after the session's first bar and 5h before its last.
    // An empty page means that side is exhausted (data gaps are far shorter than a page).
    let older = false, newer = false;
    if (bars.length && meta.first !== null && meta.last !== null) {
      const firstStart = bars[0][0] - (tf === 1440 ? 18 * 3600000 : 0);
      const lastEnd = bars[bars.length - 1][0] + (tf === 1440 ? 5 * 3600000 : tf * 60000);
      older = firstStart > meta.first;
      newer = lastEnd <= meta.last;
    }
    res.json({ symbol: s.symbol, tf: tf === 1440 ? 'D' : tf, rth, bars, older, newer });
  } catch (e: any) {
    console.error('[bars]', e.message);
    res.status(500).json({ error: 'Failed to load bars' });
  }
});

// GET /api/bars/meta?symbol=NQ — data range, row count, contract roll dates.
// Opening the chart also starts a background Databento update (at most every 30 min).
router.get('/meta', async (req: Request, res: Response) => {
  try {
    const s = parseSymbol(req, res);
    if (!s) return;
    maybeAutoUpdate();
    res.json(await getMeta(s.symbol, s.sym));
  } catch (e: any) {
    console.error('[bars/meta]', e.message);
    res.status(500).json({ error: 'Failed to load bar info' });
  }
});

// GET /api/bars/levels?symbol=NQ&at=<time> — previous-day high/low/close, overnight
// high/low and opens for the session containing `at`, using only bars up to `at`.
// GET /api/bars/days?symbol=NQ&type=trend|range|gapup|gapdown|bigrange|smallrange|losing
// Day finder for replay: New York sessions (9:30-4pm ET) of a kind, newest first.
// Range and body come from the RTH daily bars; ATR = average range of the 14 days before.
const DAY_TYPES = ['trend', 'range', 'gapup', 'gapdown', 'bigrange', 'smallrange', 'losing'] as const;
router.get('/days', async (req: Request, res: Response) => {
  try {
    const s = parseSymbol(req, res);
    if (!s) return;
    const type = String(req.query.type || 'trend');
    if (!(DAY_TYPES as readonly string[]).includes(type)) return res.status(400).json({ error: `type must be one of ${DAY_TYPES.join(', ')}` });
    const r = await pool.query(
      `WITH d AS (
         SELECT (ts AT TIME ZONE 'America/New_York')::date AS day, o / 100.0 AS o, h / 100.0 AS h, l / 100.0 AS l, c / 100.0 AS c
           FROM bars_agg WHERE sym = $1 AND tf = 1441),
       x AS (
         SELECT day, o, h, l, c, lag(c) OVER (ORDER BY day) AS pc,
                avg(h - l) OVER (ORDER BY day ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING) AS atr
           FROM d)
       SELECT day::text AS day, o, h, l, c, pc, atr FROM x WHERE pc IS NOT NULL AND atr IS NOT NULL ORDER BY day DESC`,
      [s.sym]);
    let losing: Map<string, number> | null = null;
    if (type === 'losing') {
      // the trader's own losing days (real / sim accounts; backtest accounts left out)
      const t = await pool.query(
        `SELECT DATE(t.entry_time)::text AS day, SUM(t.pnl) AS pnl
           FROM trades t JOIN accounts a ON a.id = t.account_id
          WHERE a.user_id = $1 AND t.pnl IS NOT NULL AND a.account_name NOT ILIKE '%backtest%'
          GROUP BY 1 HAVING SUM(t.pnl) < 0`, [req.userId]);
      losing = new Map(t.rows.map((x: any) => [x.day, Number(x.pnl)]));
    }
    const days = r.rows.map((x: any) => {
      const o = Number(x.o), h = Number(x.h), l = Number(x.l), c = Number(x.c), pc = Number(x.pc), atr = Number(x.atr);
      const range = h - l;
      return { day: x.day, o, h, l, c, range, atr, gap: o - pc, gapPct: ((o - pc) / pc) * 100, body: range > 0 ? (c - o) / range : 0 };
    }).filter(d => {
      switch (type) {
        case 'trend': return Math.abs(d.body) >= 0.6 && d.range >= 0.9 * d.atr;
        case 'range': return Math.abs(d.body) <= 0.2 && d.range <= 1.1 * d.atr;
        case 'gapup': return d.gapPct >= 0.4;
        case 'gapdown': return d.gapPct <= -0.4;
        case 'bigrange': return d.range >= 1.5 * d.atr;
        case 'smallrange': return d.range <= 0.6 * d.atr;
        case 'losing': return losing!.has(d.day);
      }
      return false;
    }).slice(0, 400).map(d => ({
      day: d.day, range: Math.round(d.range * 100) / 100, atr: Math.round(d.atr * 100) / 100,
      gapPct: Math.round(d.gapPct * 100) / 100, body: Math.round(d.body * 100) / 100,
      dir: d.c >= d.o ? 'up' : 'down', pnl: losing?.get(d.day) ?? null,
    }));
    res.json({ type, days });
  } catch (e: any) {
    console.error('[bars/days]', e.message);
    res.status(500).json({ error: 'Failed to find days' });
  }
});

router.get('/levels', async (req: Request, res: Response) => {
  try {
    const s = parseSymbol(req, res);
    if (!s) return;
    const at = parseTime(req.query.at);
    if (!at) return res.status(400).json({ error: 'at must be an ISO date or epoch ms' });
    res.json({ levels: await getLevels(s.sym, at) });
  } catch (e: any) {
    console.error('[bars/levels]', e.message);
    res.status(500).json({ error: 'Failed to load levels' });
  }
});

// GET /api/bars/update — is Databento set up, and how did the last update go
router.get('/update', (_req: Request, res: Response) => {
  res.json(updateStatus());
});

// POST /api/bars/update — fetch the minutes after the last stored bar from Databento now
router.post('/update', async (_req: Request, res: Response) => {
  const r = await updateFromDatabento();
  res.status(r.ok ? 200 : 502).json(r);
});

// GET /api/bars/live — polled about once a minute by the open chart: fetches new bars
// from Databento when the last attempt was 50+ s ago, and reports how current the data is.
router.get('/live', async (_req: Request, res: Response) => {
  try {
    res.json(await liveTick());
  } catch (e: any) {
    console.error('[bars/live]', e.message);
    res.status(500).json({ error: 'Live update failed' });
  }
});

// POST /api/bars/upload { csv } — add bars from a CSV (ts_utc,open,high,low,close,volume,symbol,
// or Databento's ohlcv-1m CSV). Minutes already stored are left unchanged.
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const csv = req.body?.csv;
    if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'Send the file contents as { csv: "..." }' });
    let parsed;
    try { parsed = parseBarsCsv(csv); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    if (!parsed.bars.length) {
      return res.status(400).json({ error: 'No valid bars found in the file.', bad: parsed.bad, firstBad: parsed.firstBad });
    }
    const r = await insertBars(parsed.bars, SYMBOLS.NQ);
    res.json({
      rows: parsed.bars.length, inserted: r.inserted, alreadyStored: parsed.bars.length - r.inserted,
      bad: parsed.bad, firstBad: parsed.firstBad, skippedSpreads: parsed.skipped,
      first: r.first, last: r.last,
    });
  } catch (e: any) {
    console.error('[bars/upload]', e.message);
    res.status(500).json({ error: 'Failed to store the uploaded bars' });
  }
});

export default router;
