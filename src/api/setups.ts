import { Router, Request, Response } from 'express';
import pool from '../db';
import { requirePro } from '../middleware/plan';

const router = Router();

interface Agg {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number; // positive magnitude
  totalPnl: number;
  rSum: number;
  rCount: number;
}

function finalize(a: Agg) {
  const winRate = a.trades > 0 ? (a.wins / a.trades) * 100 : 0;
  const profitFactor = a.grossLoss > 0 ? a.grossProfit / a.grossLoss : (a.grossProfit > 0 ? 999 : 0);
  const avgWin = a.wins > 0 ? a.grossProfit / a.wins : 0;
  const avgLoss = a.losses > 0 ? a.grossLoss / a.losses : 0;
  // Expectancy per trade in $: (winRate*avgWin) - (lossRate*avgLoss)
  const lossRate = a.trades > 0 ? a.losses / a.trades : 0;
  const winRateFrac = a.trades > 0 ? a.wins / a.trades : 0;
  const expectancy = winRateFrac * avgWin - lossRate * avgLoss;
  const avgR = a.rCount > 0 ? a.rSum / a.rCount : null;
  return {
    key: a.key,
    trades: a.trades,
    wins: a.wins,
    losses: a.losses,
    winRate: Number(winRate.toFixed(1)),
    totalPnl: Number(a.totalPnl.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    expectancy: Number(expectancy.toFixed(2)),
    avgR: avgR !== null ? Number(avgR.toFixed(2)) : null,
  };
}

// GET /api/setups/:account_id?groupBy=setup|tag
router.get('/setups/:account_id', requirePro('Setup Performance'), async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(String(req.params.account_id));
    const user_id = req.userId;
    const gb = String(req.query.groupBy || 'setup');
    const groupBy: 'setup' | 'tag' | 'grade' = gb === 'tag' ? 'tag' : gb === 'grade' ? 'grade' : 'setup';
    const { from, to } = req.query;

    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    const params: any[] = [account_id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND DATE(entry_time) >= $${params.length}`; }
    if (to) { params.push(to); dateFilter += ` AND DATE(entry_time) <= $${params.length}`; }

    const tr = await pool.query(
      `SELECT setup_tag, tags, grade, pnl, entry_price, stop_loss, quantity
       FROM trades WHERE account_id = $1 AND pnl IS NOT NULL${dateFilter}`,
      params
    );

    const groups = new Map<string, Agg>();
    const bump = (key: string, pnl: number, r: number | null) => {
      if (!key) key = 'Untagged';
      let a = groups.get(key);
      if (!a) { a = { key, trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, totalPnl: 0, rSum: 0, rCount: 0 }; groups.set(key, a); }
      a.trades++; a.totalPnl += pnl;
      if (pnl > 0) { a.wins++; a.grossProfit += pnl; }
      else if (pnl < 0) { a.losses++; a.grossLoss += Math.abs(pnl); }
      if (r !== null && Number.isFinite(r)) { a.rSum += r; a.rCount++; }
    };

    for (const row of tr.rows) {
      const pnl = Number(row.pnl);
      // R-multiple = pnl / risk, risk = |entry - stop| * qty
      let r: number | null = null;
      if (row.stop_loss !== null && row.entry_price !== null && row.quantity) {
        const risk = Math.abs(Number(row.entry_price) - Number(row.stop_loss)) * Number(row.quantity);
        if (risk > 0) r = pnl / risk;
      }
      if (groupBy === 'tag') {
        const tags: string[] = Array.isArray(row.tags) && row.tags.length ? row.tags : ['Untagged'];
        for (const t of tags) bump(t, pnl, r);
      } else if (groupBy === 'grade') {
        bump(row.grade ? `${row.grade}-grade` : 'Ungraded', pnl, r);
      } else {
        bump(row.setup_tag || 'Untagged', pnl, r);
      }
    }

    // Grade order A→B→C→Ungraded; otherwise by P&L
    const gradeOrder: Record<string, number> = { 'A-grade': 0, 'B-grade': 1, 'C-grade': 2, 'Ungraded': 3 };
    const result = Array.from(groups.values())
      .map(finalize)
      .sort((a, b) => groupBy === 'grade'
        ? (gradeOrder[a.key] ?? 9) - (gradeOrder[b.key] ?? 9)
        : b.totalPnl - a.totalPnl);

    res.json({ data: result, groupBy });
  } catch (error: any) {
    console.error('Setups analytics error:', error);
    res.status(500).json({ error: 'Failed to compute setup analytics' });
  }
});

export default router;
