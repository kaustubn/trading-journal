import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import pool from '../db';

const router = Router();

router.use(verifyToken);

async function isAdmin(userId: number): Promise<boolean> {
  try {
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.role === 'admin';
  } catch {
    return false;
  }
}

// Dashboard stats
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    if (!await isAdmin(req.userId || 0)) return res.status(403).json({ error: 'Admin only' });

    const users = await pool.query('SELECT COUNT(*) as count FROM users');
    const accounts = await pool.query('SELECT COUNT(*) as count FROM accounts');
    const trades = await pool.query('SELECT COUNT(*) as count FROM trades');
    const volume = await pool.query('SELECT SUM(COALESCE(pnl, 0)) as total FROM trades');
    const active = await pool.query("SELECT COUNT(DISTINCT user_id) as count FROM trades WHERE created_at > NOW() - INTERVAL '24 hours'");

    res.json({
      stats: {
        totalUsers: Number(users.rows[0]?.count),
        totalAccounts: Number(accounts.rows[0]?.count),
        totalTrades: Number(trades.rows[0]?.count),
        totalVolume: Number(volume.rows[0]?.total || 0),
        activeUsersLast24h: Number(active.rows[0]?.count)
      }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// List users
router.get('/users', async (req: Request, res: Response) => {
  try {
    if (!await isAdmin(req.userId || 0)) return res.status(403).json({ error: 'Admin only' });

    const page = Math.max(1, parseInt(String(req.query.page) || '1'));
    const limit = Math.min(parseInt(String(req.query.limit) || '50'), 500);
    const offset = (page - 1) * limit;

    const result = await pool.query(
      'SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    const total = await pool.query('SELECT COUNT(*) as count FROM users');

    res.json({
      data: result.rows,
      pagination: { page, limit, total: Number(total.rows[0]?.count) }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get user details
router.get('/users/:userId', async (req: Request, res: Response) => {
  try {
    if (!await isAdmin(req.userId || 0)) return res.status(403).json({ error: 'Admin only' });

    // @ts-ignore
    const userId = parseInt(req.params.userId);
    const user = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) return res.status(404).json({ error: 'Not found' });

    const accounts = await pool.query('SELECT id, name, broker, equity FROM accounts WHERE user_id = $1', [userId]);
    const stats = await pool.query('SELECT COUNT(*) as count, SUM(COALESCE(pnl, 0)) as pnl FROM trades WHERE user_id = $1', [userId]);

    res.json({
      user: user.rows[0],
      accounts: accounts.rows,
      stats: { trades: Number(stats.rows[0]?.count), pnl: Number(stats.rows[0]?.pnl || 0) }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Trading analytics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    if (!await isAdmin(req.userId || 0)) return res.status(403).json({ error: 'Admin only' });

    // @ts-ignore
    const days = Math.max(1, parseInt(req.query.days || '30'));

    // @ts-ignore
    const daily = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(COALESCE(pnl, 0)) as pnl
      FROM trades WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at) ORDER BY date DESC
    `);

    res.json({ period: days, data: daily.rows });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Broker distribution
router.get('/brokers', async (req: Request, res: Response) => {
  try {
    if (!await isAdmin(req.userId || 0)) return res.status(403).json({ error: 'Admin only' });

    const result = await pool.query(`
      SELECT broker, COUNT(*) as accounts, COUNT(DISTINCT user_id) as users,
      SUM(COALESCE(equity, 0)) as equity FROM accounts GROUP BY broker
    `);

    res.json({ brokers: result.rows });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
