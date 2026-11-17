import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(verifyToken, requireAdmin);

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function sideOf(tags: unknown, entry: number | null, exit: number | null, pnl: number | null): 'long' | 'short' | null {
  const list = Array.isArray(tags) ? tags : [];
  if (list.includes('Long')) return 'long';
  if (list.includes('Short')) return 'short';
  if (entry !== null && exit !== null && pnl !== null && exit !== entry && pnl !== 0) {
    return Math.sign(exit - entry) === Math.sign(pnl) ? 'long' : 'short';
  }
  return null;
}

// GET /api/chart/trade/:id — one of the caller's journal trades, with times as UTC epoch ms for the chart
router.get('/:id', async (req: Request, res: Response) => {
  const idStr = String(req.params.id);
  if (!/^\d+$/.test(idStr) || !Number.isSafeInteger(Number(idStr))) {
    return res.status(400).json({ error: 'id must be an integer' });
  }
  try {
    const r = await pool.query(
      `SELECT t.id, t.symbol, t.quantity, t.entry_price, t.exit_price, t.stop_loss, t.target, t.pnl,
              t.setup_tag, t.tags, a.account_name, a.currency, a.timezone,
              journal_wall_to_utc(t.entry_time, a.timezone) AS entry_utc,
              journal_wall_to_utc(t.exit_time, a.timezone)  AS exit_utc
         FROM trades t JOIN accounts a ON a.id = t.account_id
        WHERE t.id = $1 AND a.user_id = $2`,
      [Number(idStr), req.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Trade not found' });
    const t = r.rows[0];
    const entryPrice = num(t.entry_price);
    const exitPrice = num(t.exit_price);
    const pnl = num(t.pnl);
    const symbol: string = t.symbol ?? '';
    res.json({
      trade: {
        id: t.id,
        symbol: t.symbol,
        quantity: num(t.quantity),
        entry_price: entryPrice,
        exit_price: exitPrice,
        stop_loss: num(t.stop_loss),
        target: num(t.target),
        pnl,
        setup_tag: t.setup_tag,
        account_name: t.account_name,
        currency: t.currency,
        timezone: t.timezone,
        entry: t.entry_utc ? new Date(t.entry_utc).getTime() : null,
        exit: t.exit_utc ? new Date(t.exit_utc).getTime() : null,
        side: sideOf(t.tags, entryPrice, exitPrice, pnl),
        chartable: /(^|[^A-Z])M?NQ/i.test(symbol),
      },
    });
  } catch (e: any) {
    console.error('[chart/trade]', e.message);
    res.status(500).json({ error: 'Failed to load the trade' });
  }
});

export default router;
