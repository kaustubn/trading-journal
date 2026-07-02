import { Router, Request, Response } from 'express';
import pool from '../db';
import { StrategyService } from '../services/strategyService';

const router = Router();
const strategyService = new StrategyService();

// Create strategy
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;
    const { name, description, rules, account_id } = req.body;

    const strategy = await strategyService.createStrategy(userId, {
      user_id: userId,
      name,
      description,
      rules,
      account_id,
      enabled: true
    });

    res.json({ data: strategy });
  } catch (error) {
    console.error('Error creating strategy:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

// Get all strategies for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;
    const strategies = await strategyService.getStrategies(userId);

    res.json({ data: strategies });
  } catch (error) {
    console.error('Error fetching strategies:', error);
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
});

// Get single strategy
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM strategies WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategy = result.rows[0];
    res.json({
      data: {
        ...strategy,
        rules: JSON.parse(strategy.rules)
      }
    });
  } catch (error) {
    console.error('Error fetching strategy:', error);
    res.status(500).json({ error: 'Failed to fetch strategy' });
  }
});

// Update strategy
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;
    const id = String(req.params.id);
    const { name, description, rules, enabled } = req.body;

    const strategy = await strategyService.updateStrategy(userId, parseInt(id), {
      user_id: userId,
      name,
      description,
      rules,
      enabled,
      account_id: 0
    });

    res.json({ data: strategy });
  } catch (error: any) {
    console.error('Error updating strategy:', error);
    res.status(500).json({ error: error.message || 'Failed to update strategy' });
  }
});

// Delete strategy
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;
    const id = String(req.params.id);

    const success = await strategyService.deleteStrategy(userId, parseInt(id));

    if (!success) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting strategy:', error);
    res.status(500).json({ error: 'Failed to delete strategy' });
  }
});

// Backtest strategy
router.post('/:id/backtest', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;
    const id = String(req.params.id);
    const { account_id, from_date, to_date } = req.body;

    // Verify user owns strategy
    const strategyCheck = await pool.query(
      'SELECT id FROM strategies WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (strategyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await strategyService.backtestStrategy(
      parseInt(id),
      account_id,
      from_date,
      to_date
    );

    // Save backtest result
    await pool.query(
      `INSERT INTO strategy_backtests (strategy_id, from_date, to_date, result)
       VALUES ($1, $2, $3, $4)`,
      [id, from_date, to_date, JSON.stringify(result)]
    );

    res.json({ data: result });
  } catch (error) {
    console.error('Error backtesting strategy:', error);
    res.status(500).json({ error: 'Failed to backtest strategy' });
  }
});

// Get backtest results for strategy
router.get('/:id/backtests', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;
    const id = String(req.params.id);

    // Verify user owns strategy
    const strategyCheck = await pool.query(
      'SELECT id FROM strategies WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (strategyCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT * FROM strategy_backtests
       WHERE strategy_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({
      data: result.rows.map(row => ({
        ...row,
        result: JSON.parse(row.result)
      }))
    });
  } catch (error) {
    console.error('Error fetching backtests:', error);
    res.status(500).json({ error: 'Failed to fetch backtests' });
  }
});

export default router;
