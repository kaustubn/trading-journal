import { Router, Request, Response } from 'express';
import pool from '../db';
import { SyncService } from '../services/syncService';

const router = Router();
const syncService = new SyncService();

// Get all accounts for user
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;

    const result = await pool.query(
      `SELECT a.*, bc.api_key FROM accounts a
       LEFT JOIN broker_credentials bc ON a.id = bc.account_id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [user_id]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Link new broker account
router.post('/accounts', async (req: Request, res: Response) => {
  try {
    const { broker, account_number, account_name, api_key, api_secret, access_token } = req.body;
    const user_id = req.userId;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create account
      const accountResult = await client.query(
        `INSERT INTO accounts (user_id, broker, account_number, account_name, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [user_id, broker, account_number, account_name || account_number, 'active']
      );

      const account = accountResult.rows[0];

      // Store credentials
      await client.query(
        `INSERT INTO broker_credentials (account_id, api_key, api_secret, access_token)
         VALUES ($1, $2, $3, $4)`,
        [account.id, api_key, api_secret, access_token]
      );

      await client.query('COMMIT');

      res.json({ data: account });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Manual sync trigger
router.post('/accounts/:id/sync', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;

    // Verify user owns this account
    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Sync last 7 days
    const from_date = new Date();
    from_date.setDate(from_date.getDate() - 7);

    const result = await syncService.syncAccount(Number(id), from_date, new Date());

    res.json({ data: result });
  } catch (error) {
    console.error('Error syncing account:', error);
    res.status(500).json({ error: 'Failed to sync account' });
  }
});

// Get account stats
router.get('/accounts/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;

    // Verify user owns this account
    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
        SUM(pnl) as total_pnl,
        AVG(pnl) as avg_pnl,
        MAX(pnl) as max_win,
        MIN(pnl) as max_loss
       FROM trades
       WHERE account_id = $1`,
      [id]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
