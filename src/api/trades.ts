import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// Get trades by date and account
router.get('/trades', async (req: Request, res: Response) => {
  try {
    const { date, account_id } = req.query;
    const user_id = req.userId;

    let query = `
      SELECT t.* FROM trades t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.user_id = $1
    `;
    const params: any[] = [user_id];

    if (date) {
      query += ` AND DATE(t.entry_time) = $${params.length + 1}`;
      params.push(date);
    }

    if (account_id) {
      query += ` AND t.account_id = $${params.length + 1}`;
      params.push(account_id);
    }

    query += ` ORDER BY t.entry_time DESC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// Get daily summary for calendar
router.get('/daily-summary', async (req: Request, res: Response) => {
  try {
    const { month, year } = req.query;
    const user_id = req.userId;

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0);

    const result = await pool.query(
      `SELECT ds.* FROM daily_summaries ds
       JOIN accounts a ON ds.account_id = a.id
       WHERE a.user_id = $1 AND ds.trade_date BETWEEN $2 AND $3
       ORDER BY ds.trade_date`,
      [user_id, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching daily summary:', error);
    res.status(500).json({ error: 'Failed to fetch daily summary' });
  }
});

// Create manual trade entry
router.post('/trades', async (req: Request, res: Response) => {
  try {
    const { account_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, setup_tag, notes } = req.body;
    const user_id = req.userId;

    // Verify user owns this account
    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Calculate PnL if exit_price exists
    let pnl = null;
    if (exit_price) {
      pnl = (exit_price - entry_price) * quantity;
    }

    const result = await pool.query(
      `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
       entry_price, exit_price, quantity, pnl, setup_tag, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [account_id, `manual_${Date.now()}`, symbol, entry_time, exit_time, entry_price, exit_price, quantity, pnl, setup_tag, notes]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating trade:', error);
    res.status(500).json({ error: 'Failed to create trade' });
  }
});

// Update trade (notes, setup_tag)
router.put('/trades/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { setup_tag, notes } = req.body;
    const user_id = req.userId;

    // Verify user owns this trade
    const tradeCheck = await pool.query(
      `SELECT t.id FROM trades t
       JOIN accounts a ON t.account_id = a.id
       WHERE t.id = $1 AND a.user_id = $2`,
      [id, user_id]
    );

    if (tradeCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      'UPDATE trades SET setup_tag = COALESCE($1, setup_tag), notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3 RETURNING *',
      [setup_tag, notes, id]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error updating trade:', error);
    res.status(500).json({ error: 'Failed to update trade' });
  }
});

export default router;
