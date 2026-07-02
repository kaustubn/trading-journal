import { Router, Request, Response } from 'express';
import pool from '../db';
import { BacktestService, BacktestConfig } from '../services/backtestService';

const router = Router();
const backtestService = new BacktestService();

// Run backtest
router.post('/run', async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const { account_id, from_date, to_date, initial_capital, win_only_filter, min_win_rate } = req.body;

    // Verify user owns this account
    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, userId]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const config: BacktestConfig = {
      account_id,
      from_date,
      to_date,
      initial_capital: initial_capital || 100000,
      max_risk_per_trade: 2,
      win_only_filter: win_only_filter || false,
      min_win_rate: min_win_rate || 0
    };

    const result = await backtestService.runBacktest(config);

    // Save backtest result
    const saveResult = await pool.query(
      `INSERT INTO backtest_results (account_id, from_date, to_date, config, result)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [account_id, from_date, to_date, JSON.stringify(config), JSON.stringify(result)]
    );

    res.json({
      backtest_id: saveResult.rows[0].id,
      data: result
    });
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ error: 'Backtest failed' });
  }
});

// Get saved backtests
router.get('/results/:account_id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const { account_id } = req.params;

    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, userId]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT id, from_date, to_date, result, created_at
       FROM backtest_results
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [account_id]
    );

    res.json({
      data: result.rows.map(row => ({
        id: row.id,
        from_date: row.from_date,
        to_date: row.to_date,
        ...JSON.parse(row.result),
        created_at: row.created_at
      }))
    });
  } catch (error) {
    console.error('Error fetching backtest results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Get single backtest detail
router.get('/result/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const result = await pool.query(
      `SELECT br.* FROM backtest_results br
       JOIN accounts a ON br.account_id = a.id
       WHERE br.id = $1 AND a.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Backtest not found' });
    }

    const data = result.rows[0];
    res.json({
      data: {
        id: data.id,
        from_date: data.from_date,
        to_date: data.to_date,
        ...JSON.parse(data.result),
        created_at: data.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching backtest:', error);
    res.status(500).json({ error: 'Failed to fetch backtest' });
  }
});

// Compare multiple backtests
router.post('/compare', async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const { backtest_ids } = req.body;

    const result = await pool.query(
      `SELECT br.id, br.from_date, br.to_date, br.result FROM backtest_results br
       JOIN accounts a ON br.account_id = a.id
       WHERE br.id = ANY($1) AND a.user_id = $2`,
      [backtest_ids, userId]
    );

    const comparison = result.rows.map(row => ({
      id: row.id,
      from_date: row.from_date,
      to_date: row.to_date,
      ...JSON.parse(row.result)
    }));

    res.json({ data: comparison });
  } catch (error) {
    console.error('Error comparing backtests:', error);
    res.status(500).json({ error: 'Failed to compare backtests' });
  }
});

export default router;
