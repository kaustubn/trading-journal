import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// Test endpoint
router.get('/test', (req: Request, res: Response) => {
  res.json({ message: 'analytics router is working' });
});

// Get account statistics
router.get('/stats/:account_id', async (req: Request, res: Response) => {
  try {
    const { account_id } = req.params;
    const user_id = req.userId;

    // Verify user owns this account
    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN pnl > 0 THEN 1 END) as wins,
        COUNT(CASE WHEN pnl < 0 THEN 1 END) as losses,
        COUNT(CASE WHEN pnl = 0 THEN 1 END) as breakeven,
        SUM(pnl) as total_pnl,
        AVG(pnl) as avg_pnl,
        MAX(pnl) as best_trade,
        MIN(pnl) as worst_trade,
        STDDEV(pnl) as pnl_stddev
       FROM trades
       WHERE account_id = $1 AND exit_time IS NOT NULL`,
      [account_id]
    );

    const stats = result.rows[0];
    const winRate = stats.total_trades > 0 ? (stats.wins / stats.total_trades * 100).toFixed(2) : '0';

    const winSum = await pool.query(
      'SELECT SUM(pnl) as sum FROM trades WHERE account_id = $1 AND pnl > 0',
      [account_id]
    );
    const lossSum = await pool.query(
      'SELECT ABS(SUM(pnl)) as sum FROM trades WHERE account_id = $1 AND pnl < 0',
      [account_id]
    );

    const totalWins = parseFloat(winSum.rows[0].sum || 0);
    const totalLosses = parseFloat(lossSum.rows[0].sum || 0);
    const profitFactor = totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : totalWins > 0 ? '∞' : '0';

    res.json({
      data: {
        total_trades: stats.total_trades,
        wins: stats.wins,
        losses: stats.losses,
        breakeven: stats.breakeven,
        win_rate: `${winRate}%`,
        total_pnl: parseFloat(stats.total_pnl || 0).toFixed(2),
        avg_pnl: parseFloat(stats.avg_pnl || 0).toFixed(2),
        best_trade: parseFloat(stats.best_trade || 0).toFixed(2),
        worst_trade: parseFloat(stats.worst_trade || 0).toFixed(2),
        profit_factor: profitFactor,
        avg_win: stats.wins > 0 ? (totalWins / stats.wins).toFixed(2) : '0',
        avg_loss: stats.losses > 0 ? (totalLosses / stats.losses).toFixed(2) : '0'
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get monthly performance
router.get('/monthly/:account_id', async (req: Request, res: Response) => {
  try {
    const { account_id } = req.params;
    const user_id = req.userId;

    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT
        TO_CHAR(entry_time, 'YYYY-MM') as month,
        COUNT(*) as trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
        SUM(pnl) as monthly_pnl
       FROM trades
       WHERE account_id = $1 AND exit_time IS NOT NULL
       GROUP BY TO_CHAR(entry_time, 'YYYY-MM')
       ORDER BY month DESC
       LIMIT 12`,
      [account_id]
    );

    res.json({
      data: result.rows.map(row => ({
        month: row.month,
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
        win_rate: row.trades > 0 ? `${(row.wins / row.trades * 100).toFixed(2)}%` : '0%',
        pnl: parseFloat(row.monthly_pnl || 0).toFixed(2)
      }))
    });
  } catch (error) {
    console.error('Error fetching monthly stats:', error);
    res.status(500).json({ error: 'Failed to fetch monthly statistics' });
  }
});

// Get daily performance
router.get('/daily/:account_id', async (req: Request, res: Response) => {
  try {
    const { account_id } = req.params;
    const user_id = req.userId;

    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT
        DATE(entry_time) as trade_date,
        COUNT(*) as trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
        SUM(pnl) as daily_pnl
       FROM trades
       WHERE account_id = $1 AND exit_time IS NOT NULL
       GROUP BY DATE(entry_time)
       ORDER BY trade_date DESC
       LIMIT 30`,
      [account_id]
    );

    res.json({
      data: result.rows.map(row => ({
        date: row.trade_date,
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
        win_rate: row.trades > 0 ? `${(row.wins / row.trades * 100).toFixed(2)}%` : '0%',
        pnl: parseFloat(row.daily_pnl || 0).toFixed(2)
      }))
    });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    res.status(500).json({ error: 'Failed to fetch daily statistics' });
  }
});

export default router;
