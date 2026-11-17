import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { SYMBOLS, TIMEFRAMES, Timeframe, getBars, getMeta, getLevels } from '../bars/store';
import { parseBarsCsv, insertBars, updateFromDatabento, maybeAutoUpdate, updateStatus, liveTick } from '../bars/ingest';

const router = Router();
router.use(verifyToken, requireAdmin);

const MAX_BARS = 5000;
const DEFAULT_BARS = 1500;

function parseTf(raw: unknown): Timeframe | null {
  const s = String(raw ?? '5').trim().toUpperCase();
  const n = s === 'D' || s === '1D' ? 1440 : Number(s);
  return (TIMEFRAMES as readonly number[]).includes(n) ? (n as Timeframe) : null;
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
    if (!tf) return res.status(400).json({ error: 'tf must be one of 1, 3, 5, 15, 30, 60, 240, D' });
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
