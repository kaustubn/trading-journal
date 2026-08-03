import { Request, Response, NextFunction } from 'express';
import pool from '../db';

export async function getPlan(userId?: number): Promise<'free' | 'pro'> {
  if (!userId) return 'free';
  const r = await pool.query("SELECT COALESCE(plan,'free') AS p FROM users WHERE id = $1", [userId]);
  return r.rows[0]?.p === 'pro' ? 'pro' : 'free';
}

// Gate a route/router to Pro users. Returns 402 with { upgrade: true } for free users.
export function requirePro(feature = 'this feature') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const plan = await getPlan(req.userId);
      if (plan !== 'pro') {
        return res.status(402).json({ error: `Upgrade to Pro to use ${feature}.`, upgrade: true, feature });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: 'Plan check failed' });
    }
  };
}

// Free-tier limits
export const FREE_MAX_ACCOUNTS = 1;
export const FREE_MAX_TRADES = 50;
