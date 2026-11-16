import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { SYMBOLS, TIMEFRAMES, Timeframe, getBars, getMeta } from '../bars/store';

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

// GET /api/bars?symbol=NQ&tf=5&from=<iso|ms>&to=<iso|ms>&limit=1500
// Returns the latest `limit` bars in [from, to), oldest first, as compact rows
// [timeMs, open, high, low, close, volume]. To page back, call again with
// `to` = the time of the oldest bar received; `more` is false at the start of the data.
router.get('/', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol || 'NQ').toUpperCase();
    const sym = SYMBOLS[symbol];
    if (!sym) return res.status(400).json({ error: `Unknown symbol ${symbol}` });
    const tf = parseTf(req.query.tf);
    if (!tf) return res.status(400).json({ error: 'tf must be one of 1, 3, 5, 15, 30, 60, 240, D' });
    const from = parseTime(req.query.from);
    const to = parseTime(req.query.to);
    if (from === null || to === null) return res.status(400).json({ error: 'from/to must be ISO dates or epoch ms' });
    const limit = Math.min(MAX_BARS, Math.max(1, Number(req.query.limit) || DEFAULT_BARS));

    const [bars, meta] = await Promise.all([
      getBars({ sym, tf, from, to, limit }),
      getMeta(symbol, sym),
    ]);
    // Older data exists if the oldest bar returned starts after the first stored bar.
    // (A daily bar is stamped at noon of its session, i.e. after that session's first bar.)
    const more = bars.length > 0 && meta.first !== null &&
      bars[0][0] - (tf === 1440 ? 18 * 3600000 : 0) > meta.first;
    res.json({ symbol, tf: tf === 1440 ? 'D' : tf, bars, more });
  } catch (e: any) {
    console.error('[bars]', e.message);
    res.status(500).json({ error: 'Failed to load bars' });
  }
});

// GET /api/bars/meta?symbol=NQ — data range, row count, contract roll dates
router.get('/meta', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol || 'NQ').toUpperCase();
    const sym = SYMBOLS[symbol];
    if (!sym) return res.status(400).json({ error: `Unknown symbol ${symbol}` });
    res.json(await getMeta(symbol, sym));
  } catch (e: any) {
    console.error('[bars/meta]', e.message);
    res.status(500).json({ error: 'Failed to load bar info' });
  }
});

export default router;
