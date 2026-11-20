import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { encrypt } from '../utils/crypto';
import { getPlan, FREE_MAX_ACCOUNTS } from '../middleware/plan';
import { drawdownFloor, bufferLevel, DdType } from '../shared/propRules';

const router = Router();

// Get all accounts for user
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;

    // Never send credential secrets to the client — expose only whether creds exist
    const result = await pool.query(
      `SELECT a.*, (bc.api_key IS NOT NULL) AS has_credentials FROM accounts a
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
    const { broker, account_number, account_name, api_key, api_secret, access_token, account_type, currency } = req.body;
    const user_id = req.userId;
    const webhookToken = crypto.randomBytes(24).toString('hex');
    const type = ['paper', 'simulation', 'live'].includes(account_type) ? account_type : 'live';
    const cur = ['INR', 'USD'].includes(currency) ? currency : 'INR';

    // Free tier: cap number of accounts
    const plan = await getPlan(user_id);
    if (plan !== 'pro') {
      const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM accounts WHERE user_id = $1', [user_id]);
      if (cnt.rows[0].n >= FREE_MAX_ACCOUNTS) {
        return res.status(402).json({ error: `Free plan is limited to ${FREE_MAX_ACCOUNTS} account. Upgrade to Pro for unlimited accounts.`, upgrade: true });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create account
      const accountResult = await client.query(
        `INSERT INTO accounts (user_id, broker, account_number, account_name, status, webhook_token, account_type, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [user_id, broker, account_number, account_name || account_number, 'active', webhookToken, type, cur]
      );

      const account = accountResult.rows[0];

      // Every account starts with "Attempt 1" so trades have somewhere to land
      await client.query(
        `INSERT INTO account_attempts (account_id, seq, label, status) VALUES ($1, 1, 'Attempt 1', 'active')`,
        [account.id]
      );

      // Store credentials (only if provided — webhook/manual accounts need none)
      if (api_key || api_secret || access_token) {
        await client.query(
          `INSERT INTO broker_credentials (account_id, api_key, api_secret, access_token)
           VALUES ($1, $2, $3, $4)`,
          [account.id, encrypt(api_key) || null, encrypt(api_secret) || null, encrypt(access_token) || null]
        );
      }

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

// Rename an account
router.put('/accounts/:id/name', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const name = String(req.body?.account_name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    await pool.query('UPDATE accounts SET account_name = $1 WHERE id = $2', [name.slice(0, 100), id]);
    res.json({ success: true, account_name: name });
  } catch (error: any) {
    console.error('Rename account error:', error);
    res.status(500).json({ error: 'Failed to rename account' });
  }
});

// Delete an entire account (cascades to its trades, attempts, events, credentials, notes)
router.delete('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const own = await pool.query('SELECT id, account_name FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    await pool.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    res.json({ success: true, deleted: own.rows[0].account_name });
  } catch (error: any) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Clear ALL trades for an account (wipe & re-import)
router.delete('/accounts/:id/trades', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    const del = await pool.query('DELETE FROM trades WHERE account_id = $1', [id]);
    res.json({ success: true, deleted: del.rowCount });
  } catch (error: any) {
    console.error('Clear trades error:', error);
    res.status(500).json({ error: 'Failed to clear trades' });
  }
});

// Mark / unmark a day as a blow-up (or other account event) on the prop account
router.post('/accounts/:id/events', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const { date, type = 'blown', note } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    await pool.query(
      `INSERT INTO account_events (account_id, event_date, type, note) VALUES ($1,$2,$3,$4)
       ON CONFLICT (account_id, event_date, type) DO UPDATE SET note = EXCLUDED.note`,
      [id, date, type, note ?? null]
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error('Add event error:', error);
    res.status(500).json({ error: 'Failed to add event' });
  }
});

router.delete('/accounts/:id/events', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const { date, type = 'blown' } = req.query;
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    await pool.query('DELETE FROM account_events WHERE account_id = $1 AND event_date = $2 AND type = $3', [id, date, type]);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Set the account's "trading day starts at" hour (futures session roll). 0 = normal midnight.
router.put('/accounts/:id/day-boundary', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    let hour = parseInt(String(req.body?.hour));
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) hour = 0;
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    await pool.query('UPDATE accounts SET day_boundary_hour = $1 WHERE id = $2', [hour, id]);
    res.json({ success: true, hour });
  } catch (error: any) {
    console.error('Set day boundary error:', error);
    res.status(500).json({ error: 'Failed to set day boundary' });
  }
});

// Change an account's currency (INR/USD)
router.put('/accounts/:id/currency', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const cur = ['INR', 'USD'].includes(req.body.currency) ? req.body.currency : 'INR';
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    await pool.query('UPDATE accounts SET currency = $1 WHERE id = $2', [cur, id]);
    res.json({ success: true, currency: cur });
  } catch (error: any) {
    console.error('Set currency error:', error);
    res.status(500).json({ error: 'Failed to set currency' });
  }
});

// Clock zones an account's trade times can be recorded in (NULL = New York)
export const ACCOUNT_TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'BC', label: 'BC (UTC-7, no DST since Mar 2026)' },
  { value: 'America/Vancouver', label: 'Vancouver (Pacific)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'UTC', label: 'UTC' },
];

// Set the clock zone an account's trade times are recorded in
router.put('/accounts/:id/timezone', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const raw = req.body?.timezone;
    let timezone: string | null;
    if (raw === null || raw === undefined || raw === '') {
      timezone = null;
    } else if (typeof raw === 'string' && ACCOUNT_TIMEZONES.some(z => z.value === raw)) {
      timezone = raw;
    } else {
      return res.status(400).json({ error: 'Unsupported timezone' });
    }
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    await pool.query('UPDATE accounts SET timezone = $1 WHERE id = $2', [timezone, id]);
    res.json({ ok: true, timezone });
  } catch (error: any) {
    console.error('Set timezone error:', error);
    res.status(500).json({ error: 'Failed to set timezone' });
  }
});

// Set estimated cost/charges per round-trip trade (for true net P&L)
router.put('/accounts/:id/cost', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const { cost_per_trade, micro_cost_per_trade } = req.body;
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    if (micro_cost_per_trade !== undefined) {
      await pool.query('UPDATE accounts SET cost_per_trade = $1, micro_cost_per_trade = $2 WHERE id = $3',
        [Number(cost_per_trade) || 0, Number(micro_cost_per_trade) || 0, id]);
    } else {
      await pool.query('UPDATE accounts SET cost_per_trade = $1 WHERE id = $2', [Number(cost_per_trade) || 0, id]);
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Set cost error:', error);
    res.status(500).json({ error: 'Failed to set cost' });
  }
});

// Set prop-firm rules for an account
router.put('/accounts/:id/prop-rules', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    const { starting_balance, profit_target, max_drawdown, daily_loss_limit, trailing, consistency_pct, min_trading_days, dd_type, lock_at_start, preset } = req.body;
    const ddType: DdType = dd_type === 'eod' || dd_type === 'intraday' || dd_type === 'static' ? dd_type : (trailing === false ? 'static' : 'intraday');
    const presetId = typeof preset === 'string' && /^[a-z0-9-]{1,40}$/.test(preset) ? preset : null;

    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    await pool.query(
      `UPDATE accounts SET prop_starting_balance=$1, prop_profit_target=$2,
         prop_max_drawdown=$3, prop_daily_loss_limit=$4, prop_trailing=$5,
         prop_consistency_pct=$6, prop_min_trading_days=$7, prop_dd_type=$9, prop_lock_at_start=$10, prop_preset=$11 WHERE id=$8`,
      [starting_balance ?? null, profit_target ?? null, max_drawdown ?? null,
       daily_loss_limit ?? null, ddType !== 'static',
       consistency_pct ?? null, min_trading_days ?? null, id, ddType, lock_at_start === true, presetId]
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error('Set prop rules error:', error);
    res.status(500).json({ error: 'Failed to save prop rules' });
  }
});

// Live prop-firm standing: computes equity curve from trades vs the account's rules
router.get('/accounts/:id/prop-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;

    const { attempt } = req.query;

    const acc = await pool.query(
      `SELECT prop_starting_balance, prop_profit_target, prop_max_drawdown,
              prop_daily_loss_limit, prop_trailing, prop_consistency_pct, prop_min_trading_days,
              day_boundary_hour, cost_per_trade, micro_cost_per_trade, prop_dd_type, prop_lock_at_start, prop_preset
       FROM accounts WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );
    if (acc.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    const rules = acc.rows[0];

    if (rules.prop_starting_balance === null) {
      return res.json({ data: { configured: false } });
    }

    // Match the calendar exactly: net-of-commission P&L, grouped by the account's session day.
    const boundary = Number(rules.day_boundary_hour) || 0;
    const shiftHrs = (boundary > 0 && boundary < 24) ? 24 - boundary : 0;
    const dateExpr = shiftHrs > 0 ? `DATE(entry_time + interval '${shiftHrs} hours')` : `DATE(entry_time)`;
    const miniRate = Number(rules.cost_per_trade) || 0;
    const microRate = Number(rules.micro_cost_per_trade) || miniRate;
    const microPat = '^M(NQ|ES|YM|2K|CL|GC|BT|ET|CD|BP|JY|6E)';
    const commExpr = miniRate > 0
      ? ` - (CASE WHEN upper(regexp_replace(symbol,'^[A-Z_]+:','')) ~ '${microPat}' THEN ${microRate} ELSE ${miniRate} END)`
      : '';

    // Optionally scope to one challenge run (attempt)
    const trParams: any[] = [id];
    let attemptFilter = '';
    if (attempt) { trParams.push(attempt); attemptFilter = ` AND attempt_id = $${trParams.length}`; }

    // Ordered net-P&L trades → equity curve, bucketed by session day
    const tr = await pool.query(
      `SELECT (pnl${commExpr}) AS pnl, to_char(${dateExpr},'YYYY-MM-DD') AS d FROM trades
       WHERE account_id = $1 AND pnl IS NOT NULL${attemptFilter}
       ORDER BY entry_time ASC, id ASC`,
      trParams
    );

    const start = Number(rules.prop_starting_balance);
    let equity = start;
    let peak = start;
    const dayMap = new Map<string, number>();
    for (const row of tr.rows) {
      equity += Number(row.pnl);
      if (equity > peak) peak = equity;
      dayMap.set(row.d, (dayMap.get(row.d) || 0) + Number(row.pnl));
    }
    const netPnl = equity - start;

    // Today's P&L (net, same session-day + attempt scope)
    const todayRes = await pool.query(
      `SELECT COALESCE(SUM(pnl${commExpr}),0) AS today FROM trades
       WHERE account_id = $1 AND pnl IS NOT NULL AND ${dateExpr} = CURRENT_DATE${attemptFilter}`,
      trParams
    );
    const todayPnl = Number(todayRes.rows[0].today);

    const target = rules.prop_profit_target !== null ? Number(rules.prop_profit_target) : null;
    const maxDd = rules.prop_max_drawdown !== null ? Number(rules.prop_max_drawdown) : null;
    const dailyLimit = rules.prop_daily_loss_limit !== null ? Number(rules.prop_daily_loss_limit) : null;
    const trailing = rules.prop_trailing;

    // Drawdown floor by type (src/shared/propRules.ts): EOD trails end-of-day highs, intraday trails every
    // closed-trade high, static never moves; lockAtStart stops a trailing floor at the starting balance.
    const ddType: DdType = rules.prop_dd_type === 'eod' || rules.prop_dd_type === 'static' || rules.prop_dd_type === 'intraday'
      ? rules.prop_dd_type : (trailing === false ? 'static' : 'intraday');
    const lockAtStart = rules.prop_lock_at_start === true;
    const fl = maxDd !== null ? drawdownFloor(tr.rows.map((r: any) => ({ day: r.d, pnl: Number(r.pnl) })), start, maxDd, ddType, lockAtStart) : null;
    const ddFloor = fl ? fl.floor : null;
    const ddHeadroom = ddFloor !== null ? equity - ddFloor : null; // $ left before breach
    const losses = tr.rows.map((r: any) => Number(r.pnl)).filter((x: number) => x < 0);
    const avgLoss = losses.length ? losses.reduce((a: number, x: number) => a + x, 0) / losses.length : null;
    const level = ddHeadroom !== null && maxDd ? bufferLevel(ddHeadroom, maxDd) : null;
    const ddBreached = ddHeadroom !== null ? ddHeadroom <= 0 : false;

    const targetProgress = target !== null && target !== 0 ? (netPnl / target) * 100 : null;
    const distanceToTarget = target !== null ? target - netPnl : null;
    const targetReached = target !== null ? netPnl >= target : false;

    const dailyHeadroom = dailyLimit !== null ? dailyLimit + todayPnl : null; // limit is positive $; breach if todayPnl <= -limit
    const dailyBreached = dailyLimit !== null ? todayPnl <= -dailyLimit : false;

    // --- Consistency rule: no single day may be more than X% of total profit ---
    const consistencyPct = rules.prop_consistency_pct !== null ? Number(rules.prop_consistency_pct) : null;
    // Best (largest) winning day
    let bestDayProfit = 0, bestDayDate: string | null = null;
    for (const [d, p] of dayMap) { if (p > bestDayProfit) { bestDayProfit = p; bestDayDate = d; } }
    const profitDays = Array.from(dayMap.values()).filter(p => p > 0).length;
    const totalProfit = netPnl > 0 ? netPnl : 0;

    let consistency: any = null;
    if (consistencyPct !== null) {
      const bestDayShare = totalProfit > 0 ? (bestDayProfit / totalProfit) * 100 : null;
      const consistencyPass = bestDayShare !== null ? bestDayShare <= consistencyPct : null;
      // Total profit you'd need so the best day is within the limit (best stays fixed)
      const minTotalForRule = consistencyPct > 0 ? bestDayProfit / (consistencyPct / 100) : null;
      const extraProfitNeeded = minTotalForRule !== null ? Math.max(0, minTotalForRule - totalProfit) : null;
      // Max a single day is allowed to contribute at current total
      const maxDayAllowedNow = (consistencyPct / 100) * totalProfit;
      // The check that actually gates passing: at the profit target, best day must be
      // ≤ X% of the target (since total profit ≈ target when you pass).
      const maxDayAtTarget = target !== null ? (consistencyPct / 100) * target : null;
      const targetCapPass = maxDayAtTarget !== null && bestDayProfit > 0 ? bestDayProfit <= maxDayAtTarget : null;
      consistency = {
        rulePct: consistencyPct,
        bestDayProfit: Number(bestDayProfit.toFixed(2)),
        bestDayDate,
        totalProfit: Number(totalProfit.toFixed(2)),
        bestDayShare: bestDayShare !== null ? Number(bestDayShare.toFixed(1)) : null,
        pass: consistencyPass,
        maxDayAllowedNow: Number(maxDayAllowedNow.toFixed(2)),
        minTotalForRule: minTotalForRule !== null ? Number(minTotalForRule.toFixed(2)) : null,
        extraProfitNeeded: extraProfitNeeded !== null ? Number(extraProfitNeeded.toFixed(2)) : null,
        target: target,
        maxDayAtTarget: maxDayAtTarget !== null ? Number(maxDayAtTarget.toFixed(2)) : null,
        targetCapPass,
      };
    }

    // --- Minimum trading days ---
    const minDays = rules.prop_min_trading_days !== null ? Number(rules.prop_min_trading_days) : null;
    const tradingDays = dayMap.size;
    const minDaysBlock = minDays !== null ? {
      required: minDays,
      tradedSoFar: tradingDays,
      remaining: Math.max(0, minDays - tradingDays),
      pass: tradingDays >= minDays,
    } : null;

    res.json({
      data: {
        configured: true,
        trailing,
        ddType,
        lockAtStart,
        floorLocked: fl ? fl.locked : false,
        preset: rules.prop_preset ?? null,
        avgLoss,
        bufferLevel: level,
        startingBalance: start,
        equity,
        peak,
        netPnl,
        todayPnl,
        target,
        targetProgress,
        distanceToTarget,
        targetReached,
        maxDrawdown: maxDd,
        drawdownFloor: ddFloor,
        drawdownHeadroom: ddHeadroom,
        drawdownBreached: ddBreached,
        dailyLossLimit: dailyLimit,
        dailyHeadroom,
        dailyBreached,
        tradeCount: tr.rows.length,
        tradingDays,
        profitDays,
        consistency,
        minDays: minDaysBlock,
      },
    });
  } catch (error: any) {
    console.error('Prop status error:', error);
    res.status(500).json({ error: 'Failed to compute prop status' });
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
