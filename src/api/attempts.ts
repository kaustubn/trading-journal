import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// Returns the current (latest) attempt id for an account, creating "Attempt 1" if none exists.
// Any pool or client with .query works (used inside import transactions too).
export async function getCurrentAttemptId(db: { query: Function }, accountId: number): Promise<number | null> {
  const r = await db.query(
    `SELECT id FROM account_attempts WHERE account_id = $1 ORDER BY seq DESC LIMIT 1`,
    [accountId]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await db.query(
    `INSERT INTO account_attempts (account_id, seq, label, status) VALUES ($1, 1, 'Attempt 1', 'active') RETURNING id`,
    [accountId]
  );
  return ins.rows[0].id;
}

async function ownsAccount(userId: number, accountId: any) {
  const r = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId]);
  return r.rows.length > 0;
}

// List all attempts for an account, each with computed stats (for the Challenges page)
router.get('/accounts/:id/attempts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId!;
    if (!(await ownsAccount(user_id, id))) return res.status(403).json({ error: 'Account not found' });

    const stats = await pool.query(
      `SELECT aa.id, aa.seq, aa.label, aa.status, aa.note,
              to_char(aa.started_at,'YYYY-MM-DD') AS started_at,
              to_char(aa.ended_at,'YYYY-MM-DD')   AS ended_at,
              COUNT(t.id)::int AS trades,
              COALESCE(SUM(t.pnl),0)::decimal(14,2) AS net_pnl,
              SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
              SUM(CASE WHEN t.pnl < 0 THEN 1 ELSE 0 END)::int AS losses,
              COALESCE(SUM(CASE WHEN t.pnl > 0 THEN t.pnl ELSE 0 END),0)::decimal(14,2) AS gross_win,
              COALESCE(SUM(CASE WHEN t.pnl < 0 THEN t.pnl ELSE 0 END),0)::decimal(14,2) AS gross_loss,
              MAX(t.pnl) AS best, MIN(t.pnl) AS worst,
              COUNT(DISTINCT DATE(t.entry_time))::int AS days,
              to_char(MIN(t.entry_time),'YYYY-MM-DD') AS first_trade,
              to_char(MAX(t.entry_time),'YYYY-MM-DD') AS last_trade
       FROM account_attempts aa
       LEFT JOIN trades t ON t.attempt_id = aa.id
       WHERE aa.account_id = $1
       GROUP BY aa.id
       ORDER BY aa.seq ASC`,
      [id]
    );

    // Grade mix per attempt (A/B/C discipline)
    const grades = await pool.query(
      `SELECT t.attempt_id, t.grade, COUNT(*)::int AS n
       FROM trades t JOIN account_attempts aa ON t.attempt_id = aa.id
       WHERE aa.account_id = $1 AND t.grade IS NOT NULL AND t.grade <> ''
       GROUP BY t.attempt_id, t.grade`,
      [id]
    );
    const gradeMap: Record<number, Record<string, number>> = {};
    for (const g of grades.rows) {
      (gradeMap[g.attempt_id] ||= {})[g.grade] = g.n;
    }

    const attempts = stats.rows.map((a: any) => {
      const trades = a.trades;
      const wins = a.wins, losses = a.losses;
      const netPnl = Number(a.net_pnl);
      const grossWin = Number(a.gross_win);
      const grossLoss = Number(a.gross_loss); // negative
      const winRate = trades > 0 ? (wins / trades) * 100 : 0;
      const profitFactor = grossLoss !== 0 ? grossWin / Math.abs(grossLoss) : (grossWin > 0 ? Infinity : 0);
      const expectancy = trades > 0 ? netPnl / trades : 0;
      const avgWin = wins > 0 ? grossWin / wins : 0;
      const avgLoss = losses > 0 ? grossLoss / losses : 0; // negative
      const tradesPerDay = a.days > 0 ? trades / a.days : 0;
      return {
        id: a.id, seq: a.seq, label: a.label, status: a.status, note: a.note,
        startedAt: a.started_at, endedAt: a.ended_at,
        firstTrade: a.first_trade, lastTrade: a.last_trade,
        trades, wins, losses, netPnl,
        winRate, profitFactor: profitFactor === Infinity ? null : profitFactor,
        expectancy, avgWin, avgLoss,
        best: a.best != null ? Number(a.best) : null,
        worst: a.worst != null ? Number(a.worst) : null,
        days: a.days, tradesPerDay,
        grades: gradeMap[a.id] || {},
      };
    });

    res.json({ data: attempts });
  } catch (error: any) {
    console.error('List attempts error:', error);
    res.status(500).json({ error: 'Failed to load attempts' });
  }
});

// Start a NEW attempt (the "Reset / new challenge" button). Becomes the current attempt.
router.post('/accounts/:id/attempts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId!;
    const { label } = req.body || {};
    if (!(await ownsAccount(user_id, id))) return res.status(403).json({ error: 'Account not found' });

    const seqRes = await pool.query('SELECT COALESCE(MAX(seq),0)+1 AS next FROM account_attempts WHERE account_id = $1', [id]);
    const seq = seqRes.rows[0].next;
    const finalLabel = (label && String(label).trim()) || `Attempt ${seq}`;
    const ins = await pool.query(
      `INSERT INTO account_attempts (account_id, seq, label, status) VALUES ($1, $2, $3, 'active') RETURNING *`,
      [id, seq, finalLabel]
    );
    res.json({ data: ins.rows[0] });
  } catch (error: any) {
    console.error('Create attempt error:', error);
    res.status(500).json({ error: 'Failed to start new attempt' });
  }
});

// Update an attempt: status (active|passed|blown), label, note
router.put('/attempts/:aid', async (req: Request, res: Response) => {
  try {
    const { aid } = req.params;
    const user_id = req.userId!;
    const { status, label, note } = req.body || {};

    const own = await pool.query(
      `SELECT aa.id FROM account_attempts aa JOIN accounts a ON aa.account_id = a.id
       WHERE aa.id = $1 AND a.user_id = $2`, [aid, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Attempt not found' });

    const validStatus = ['active', 'passed', 'blown'].includes(status) ? status : null;
    // ended_at set when passed/blown, cleared when back to active
    await pool.query(
      `UPDATE account_attempts SET
         status = COALESCE($1, status),
         label  = COALESCE($2, label),
         note   = COALESCE($3, note),
         ended_at = CASE
             WHEN $1 = 'active' THEN NULL
             WHEN $1 IN ('passed','blown') THEN NOW()
             ELSE ended_at END
       WHERE id = $4`,
      [validStatus, label ?? null, note ?? null, aid]
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error('Update attempt error:', error);
    res.status(500).json({ error: 'Failed to update attempt' });
  }
});

// Delete an attempt (its trades detach via ON DELETE SET NULL). Blocks deleting the last one.
router.delete('/attempts/:aid', async (req: Request, res: Response) => {
  try {
    const { aid } = req.params;
    const user_id = req.userId!;
    const own = await pool.query(
      `SELECT aa.account_id FROM account_attempts aa JOIN accounts a ON aa.account_id = a.id
       WHERE aa.id = $1 AND a.user_id = $2`, [aid, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Attempt not found' });
    const accId = own.rows[0].account_id;
    const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM account_attempts WHERE account_id = $1', [accId]);
    if (cnt.rows[0].n <= 1) return res.status(400).json({ error: 'Cannot delete the only attempt' });
    await pool.query('DELETE FROM account_attempts WHERE id = $1', [aid]);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete attempt error:', error);
    res.status(500).json({ error: 'Failed to delete attempt' });
  }
});

export default router;
