// Size & Pass Lab trade lists, one per user (market_cache key "sizelab:<user id>").
// The research trades are private: they are uploaded from the page, never stored in the (public) code.
//   GET /api/sizelab/trades  -> { doc } or { doc: null }
//   PUT /api/sizelab/trades  { doc: { name, source?, trades: [[date, entryMinEt, dir, riskPts, grossR, adversePts, news], ...] } }
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';

const router = Router();
router.use(verifyToken);
const MAX_TRADES = 20000;
const key = (req: Request) => `sizelab:${req.userId}`;

/** Checks the uploaded list; returns an error message or null. */
export function checkTrades(trades: unknown): string | null {
  if (!Array.isArray(trades) || !trades.length) return 'trades must be a non-empty list';
  if (trades.length > MAX_TRADES) return `at most ${MAX_TRADES} trades`;
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const ok = Array.isArray(t) && (t.length === 7 || t.length === 10) && typeof t[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t[0])
      && t.slice(1).every((x: unknown) => typeof x === 'number' && Number.isFinite(x))
      && t[1] >= 0 && t[1] < 1440 && (t[2] === 1 || t[2] === -1) && t[3] > 0 && t[5] >= 0 && (t[6] === 0 || t[6] === 1)
      && (t.length === 7 || ([-1, 0, 1, 2].includes(t[7]) && t[8] >= 0 && t[8] <= 1440 && t[9] >= 0));
    if (!ok) return `trade ${i + 1} is not [YYYY-MM-DD, minute 0-1439, 1 or -1, stop pts > 0, R, adverse pts >= 0, 0 or 1 (, exit kind, exit minute, favourable pts)]`;
  }
  return null;
}

router.get('/trades', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT data FROM market_cache WHERE key = $1', [key(req)]);
    res.json({ doc: r.rows[0]?.data ?? null });
  } catch (e) { console.error('[sizelab/get]', (e as Error).message); res.status(500).json({ error: 'Could not load the trades.' }); }
});

router.put('/trades', async (req: Request, res: Response) => {
  const doc = req.body?.doc;
  const err = checkTrades(doc?.trades);
  if (err) return res.status(400).json({ error: err });
  const sortT = (l: any[]) => [...l].sort((a: any[], b: any[]) => (a[0] + String(a[1]).padStart(4, '0')).localeCompare(b[0] + String(b[1]).padStart(4, '0')));
  if (doc.tradesStrict !== undefined) { const e2 = checkTrades(doc.tradesStrict); if (e2) return res.status(400).json({ error: `tradesStrict: ${e2}` }); }
  const clean: any = { name: String(doc.name || 'Trades').slice(0, 80), source: String(doc.source || '').slice(0, 300), uploaded: new Date().toISOString(), trades: sortT(doc.trades) };
  if (doc.tradesStrict) clean.tradesStrict = sortT(doc.tradesStrict);
  try {
    await pool.query(`INSERT INTO market_cache (key, data, fetched_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()`, [key(req), clean]);
    res.json({ ok: true, trades: clean.trades.length });
  } catch (e) { console.error('[sizelab/put]', (e as Error).message); res.status(500).json({ error: 'Could not save the trades.' }); }
});

export default router;
