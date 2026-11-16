import { Request, Response, NextFunction } from 'express';
import pool from '../db';

// Gate a route to admins (users.role = 'admin'). Used for the market chart: its
// exchange data is licensed for the owner's own use and must not be served to others.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const r = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId || 0]);
    if (r.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  } catch {
    res.status(500).json({ error: 'Admin check failed' });
  }
}
