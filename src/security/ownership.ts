import { Request, Response, NextFunction } from 'express';

type Query = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

/** Positive whole number from a route param / query value, else null. */
export function toId(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  return Number(s);
}

export function makeOwnsAccount(query: Query) {
  return async (userId: number | undefined, accountId: unknown): Promise<boolean> => {
    const uid = toId(userId), aid = toId(accountId);
    if (uid === null || aid === null) return false;
    const r = await query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [aid, uid]);
    return r.rows.length > 0;
  };
}

/** Express middleware: 403 unless the logged-in user owns the account named by `pick(req)`. */
export function makeRequireAccount(owns: (u: number | undefined, a: unknown) => Promise<boolean>, pick: (req: Request) => unknown) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await owns((req as Request & { userId?: number }).userId, pick(req)))) return res.status(403).json({ error: 'Account not found' });
      next();
    } catch (e) {
      console.error('[ownership] check failed:', e);
      res.status(500).json({ error: 'Server error' });
    }
  };
}
