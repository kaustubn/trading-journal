import { Router, Request, Response } from 'express';
import pool from '../db';
import { getCurrentAttemptId } from './attempts';

const router = Router();

// Returns the SQL expression for an account's "session day" timestamp.
// If the account rolls its trading day at hour H (day_boundary_hour, e.g. 15 = 3 PM),
// shift by (24-H) hours so the roll lands on midnight; DATE() then buckets by session.
async function sessionExpr(account_id: any, user_id: any): Promise<string> {
  if (!account_id) return 't.entry_time';
  const r = await pool.query('SELECT day_boundary_hour FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
  const b = Number(r.rows[0]?.day_boundary_hour) || 0;
  if (b > 0 && b < 24) return `(t.entry_time + interval '${24 - b} hours')`;
  return 't.entry_time';
}

// Get trades by date and account
router.get('/trades', async (req: Request, res: Response) => {
  try {
    const { date, account_id, attempt } = req.query;
    const user_id = req.userId;

    // Exclude the heavy screenshot blob from the list; expose a flag instead
    let query = `
      SELECT t.id, t.account_id, t.broker_trade_id, t.symbol, t.entry_time, t.exit_time,
             t.entry_price, t.exit_price, t.quantity, t.pnl, t.setup_tag, t.notes,
             t.tags, t.stop_loss, t.target, t.rating, t.grade, t.attempt_id,
             t.session, t.test_type, t.timeframe, t.tf_align, t.planned_rr,
             (t.screenshot IS NOT NULL OR t.screenshots IS NOT NULL) AS has_screenshot
      FROM trades t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.user_id = $1
    `;
    const params: any[] = [user_id];

    if (date) {
      const sess = await sessionExpr(account_id, user_id);
      query += ` AND DATE(${sess}) = $${params.length + 1}`;
      params.push(date);
    }

    if (account_id) {
      query += ` AND t.account_id = $${params.length + 1}`;
      params.push(account_id);
    }

    if (attempt) {
      query += ` AND t.attempt_id = $${params.length + 1}`;
      params.push(attempt);
    }

    query += ` ORDER BY t.entry_time DESC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// Get a single full trade (incl. screenshot) — for the detail modal
router.get('/trades/:id', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const { id } = req.params;
    const r = await pool.query(
      `SELECT t.* FROM trades t JOIN accounts a ON t.account_id = a.id
       WHERE t.id = $1 AND a.user_id = $2`,
      [id, user_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: r.rows[0] });
  } catch (error) {
    console.error('Error fetching trade:', error);
    res.status(500).json({ error: 'Failed to fetch trade' });
  }
});

// Get daily summary for calendar — computed live from trades so any trade
// (webhook, manual, or synced) shows up immediately without a separate table.
router.get('/daily-summary', async (req: Request, res: Response) => {
  try {
    const { month, year, account_id, attempt } = req.query;
    const user_id = req.userId;

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0);

    const params: any[] = [
      user_id,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
    ];
    let accountFilter = '';
    if (account_id) {
      params.push(account_id);
      accountFilter = ` AND t.account_id = $${params.length}`;
    }
    if (attempt) {
      params.push(attempt);
      accountFilter += ` AND t.attempt_id = $${params.length}`;
    }

    // Futures "session day": if the account rolls its trading day at hour H (e.g. 15:00),
    // shift times by (24-H) so the boundary lands on midnight, then group by that date.
    const sess = await sessionExpr(account_id, user_id);

    // Per-instrument commissions → net daily P&L (micros e.g. MNQ cost less than minis e.g. NQ).
    // Only applied when the account has a mini rate set; otherwise daily P&L stays gross.
    let commExpr = '';
    if (account_id) {
      const acc = await pool.query('SELECT cost_per_trade, micro_cost_per_trade FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
      const miniRate = Number(acc.rows[0]?.cost_per_trade) || 0;
      const microRate = Number(acc.rows[0]?.micro_cost_per_trade) || miniRate;
      if (miniRate > 0) {
        const microPat = '^M(NQ|ES|YM|2K|CL|GC|BT|ET|CD|BP|JY|6E)';
        commExpr = ` - SUM(CASE WHEN upper(regexp_replace(t.symbol,'^[A-Z_]+:','')) ~ '${microPat}' THEN ${microRate} ELSE ${miniRate} END)`;
      }
    }

    const result = await pool.query(
      `SELECT
         t.account_id,
         to_char(DATE(${sess}), 'YYYY-MM-DD') AS trade_date,
         (COALESCE(SUM(t.pnl), 0)${commExpr})::DECIMAL(12,2) AS daily_pnl,
         COUNT(*)::INT AS trade_count,
         SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END)::INT AS wins,
         SUM(CASE WHEN t.pnl < 0 THEN 1 ELSE 0 END)::INT AS losses
       FROM trades t
       JOIN accounts a ON t.account_id = a.id
       WHERE a.user_id = $1
         AND DATE(${sess}) BETWEEN $2 AND $3${accountFilter}
       GROUP BY t.account_id, DATE(${sess})
       ORDER BY trade_date`,
      params
    );

    // Merge in "blown" (and other) account events for this month
    const evParams: any[] = [user_id, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
    let evAccFilter = '';
    if (account_id) { evParams.push(account_id); evAccFilter = ` AND ae.account_id = $${evParams.length}`; }
    const events = await pool.query(
      `SELECT ae.account_id, to_char(ae.event_date,'YYYY-MM-DD') AS trade_date, ae.type
       FROM account_events ae JOIN accounts a ON ae.account_id = a.id
       WHERE a.user_id = $1 AND ae.event_date BETWEEN $2 AND $3${evAccFilter}`,
      evParams
    );

    const rows = result.rows;
    const byDate = new Map(rows.map((r: any) => [r.trade_date, r]));
    for (const ev of events.rows) {
      const existing: any = byDate.get(ev.trade_date);
      if (existing) { existing.blown = ev.type === 'blown'; existing.event = ev.type; }
      else {
        const synthetic = { account_id: ev.account_id, trade_date: ev.trade_date, daily_pnl: 0, trade_count: 0, wins: 0, losses: 0, blown: ev.type === 'blown', event: ev.type };
        rows.push(synthetic); byDate.set(ev.trade_date, synthetic);
      }
    }

    res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching daily summary:', error);
    res.status(500).json({ error: 'Failed to fetch daily summary' });
  }
});

// Create manual trade entry
router.post('/trades', async (req: Request, res: Response) => {
  try {
    const { account_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, setup_tag, notes, stop_loss, target } = req.body;
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

    const attemptId = await getCurrentAttemptId(pool, Number(account_id));

    const result = await pool.query(
      `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
       entry_price, exit_price, quantity, pnl, setup_tag, notes, stop_loss, target, attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [account_id, `manual_${Date.now()}`, symbol, entry_time, exit_time, entry_price, exit_price, quantity, pnl, setup_tag, notes, stop_loss ?? null, target ?? null, attemptId]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating trade:', error);
    res.status(500).json({ error: 'Failed to create trade' });
  }
});

// Bulk-tag many trades at once (fast setup/grade for scalpers)
router.post('/trades/bulk-tag', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const { ids, setup_tag, grade, session, test_type, timeframe, tf_align, planned_rr } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    // Journal fields clear on '' (chip toggled off) — see PUT /trades/:id
    const vals: any[] = [setup_tag ?? null, grade ?? null];
    const extra: string[] = [];
    const setClearable = (col: string, v: any, num = false) => {
      if (v === undefined) return;
      const clean = v === '' || v === null ? null : (num ? Number(v) : v);
      vals.push(Number.isNaN(clean as number) ? null : clean);
      extra.push(`${col} = $${vals.length}`);
    };
    setClearable('session', session);
    setClearable('test_type', test_type);
    setClearable('timeframe', timeframe);
    setClearable('tf_align', tf_align, true);
    setClearable('planned_rr', planned_rr);

    vals.push(user_id, ids);
    const result = await pool.query(
      `UPDATE trades t SET
         setup_tag = COALESCE($1, setup_tag),
         grade = COALESCE($2, grade)${extra.length ? ', ' + extra.join(', ') : ''},
         updated_at = NOW()
       FROM accounts a
       WHERE t.account_id = a.id AND a.user_id = $${vals.length - 1} AND t.id = ANY($${vals.length}::int[])`,
      vals
    );
    res.json({ success: true, updated: result.rowCount });
  } catch (error: any) {
    console.error('Bulk tag error:', error);
    res.status(500).json({ error: 'Failed to bulk-tag' });
  }
});

// Update trade (notes, setup_tag, tags, stop_loss, target, rating)
router.put('/trades/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { setup_tag, notes, tags, stop_loss, target, rating, grade, screenshot, screenshots,
            session, test_type, timeframe, tf_align, planned_rr } = req.body;
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

    // Normalize tags: accept array or comma-separated string
    let tagArr: string[] | null = null;
    if (Array.isArray(tags)) tagArr = tags.map((t: any) => String(t).trim()).filter(Boolean);
    else if (typeof tags === 'string') tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);

    // Journal fields (session/test type/timeframe/TF align/RR) are chip toggles, so an
    // empty value must CLEAR them — unlike the COALESCE fields above, where null = leave alone.
    const vals: any[] = [setup_tag ?? null, notes ?? null, tagArr, stop_loss ?? null, target ?? null,
      rating ?? null, grade ?? null, screenshot ?? null, screenshots ? JSON.stringify(screenshots) : null];
    const extra: string[] = [];
    const setClearable = (col: string, v: any, num = false) => {
      if (v === undefined) return;                       // key absent → leave as-is
      const clean = v === '' || v === null ? null : (num ? Number(v) : v);
      vals.push(Number.isNaN(clean as number) ? null : clean);
      extra.push(`${col} = $${vals.length}`);
    };
    setClearable('session', session);
    setClearable('test_type', test_type);
    setClearable('timeframe', timeframe);
    setClearable('tf_align', tf_align, true);
    setClearable('planned_rr', planned_rr);

    vals.push(id);
    const result = await pool.query(
      `UPDATE trades SET
         setup_tag = COALESCE($1, setup_tag),
         notes = COALESCE($2, notes),
         tags = COALESCE($3, tags),
         stop_loss = COALESCE($4, stop_loss),
         target = COALESCE($5, target),
         rating = COALESCE($6, rating),
         grade = COALESCE($7, grade),
         screenshot = COALESCE($8, screenshot),
         screenshots = COALESCE($9, screenshots)${extra.length ? ', ' + extra.join(', ') : ''},
         updated_at = NOW()
       WHERE id = $${vals.length} RETURNING id`,
      vals
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error updating trade:', error);
    res.status(500).json({ error: 'Failed to update trade' });
  }
});

export default router;
