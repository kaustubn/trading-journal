import { Router, Request, Response } from 'express';
import pool from '../db';
import { requirePro } from '../middleware/plan';

const router = Router();

// Extract the underlying instrument from a Fyers-style symbol
// "NSE:BANKNIFTY2372746000CE" -> "BANKNIFTY" ; "NSE:RELIANCE-EQ" -> "RELIANCE"
function symbolRoot(sym: string): string {
  let s = sym.replace(/^[A-Z]+:/, '');       // drop exchange prefix
  const m = s.match(/^([A-Za-z]+?)\d/);       // letters before first digit (options/futures)
  if (m) return m[1].toUpperCase();
  s = s.replace(/-(EQ|BE|BZ|GS|SG)$/i, '');   // strip equity series suffix
  return s.toUpperCase();
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Agg { trades: number; wins: number; pnl: number; }
function finalize(key: string, a: Agg) {
  return {
    key,
    trades: a.trades,
    wins: a.wins,
    winRate: a.trades > 0 ? Number(((a.wins / a.trades) * 100).toFixed(1)) : 0,
    pnl: Number(a.pnl.toFixed(2)),
  };
}

// GET /api/breakdown/:account_id[?from&to]
router.get('/breakdown/:account_id', requirePro('Breakdown analytics'), async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(String(req.params.account_id));
    const user_id = req.userId;
    const { from, to } = req.query;

    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    const params: any[] = [account_id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND DATE(entry_time) >= $${params.length}`; }
    if (to) { params.push(to); dateFilter += ` AND DATE(entry_time) <= $${params.length}`; }

    const tr = await pool.query(
      `SELECT symbol, pnl,
              EXTRACT(DOW FROM entry_time)::int AS dow,
              EXTRACT(HOUR FROM entry_time)::int AS hour
       FROM trades WHERE account_id = $1 AND pnl IS NOT NULL${dateFilter}`,
      params
    );

    const bySymbol = new Map<string, Agg>();
    const byDow = new Map<number, Agg>();
    const byHour = new Map<number, Agg>();
    const bump = (map: Map<any, Agg>, key: any, pnl: number) => {
      let a = map.get(key);
      if (!a) { a = { trades: 0, wins: 0, pnl: 0 }; map.set(key, a); }
      a.trades++; a.pnl += pnl; if (pnl > 0) a.wins++;
    };

    for (const row of tr.rows) {
      const pnl = Number(row.pnl);
      bump(bySymbol, symbolRoot(row.symbol), pnl);
      bump(byDow, row.dow, pnl);
      bump(byHour, row.hour, pnl);
    }

    const symbols = Array.from(bySymbol.entries()).map(([k, a]) => finalize(k, a)).sort((x, y) => y.pnl - x.pnl);
    const dows = Array.from({ length: 7 }, (_, i) => finalize(DOW[i], byDow.get(i) || { trades: 0, wins: 0, pnl: 0 }))
      .filter((_, i) => (byDow.get(i)?.trades || 0) > 0);
    const hours = Array.from(byHour.entries())
      .map(([h, a]) => ({ ...finalize(`${String(h).padStart(2, '0')}:00`, a), hour: h }))
      .sort((x, y) => x.hour - y.hour);

    res.json({ data: { symbols, dows, hours, totalTrades: tr.rows.length } });
  } catch (error: any) {
    console.error('Breakdown error:', error);
    res.status(500).json({ error: 'Failed to compute breakdown' });
  }
});

export default router;
