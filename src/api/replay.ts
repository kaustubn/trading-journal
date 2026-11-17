import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(verifyToken, requireAdmin);

const POINT_VALUE: Record<string, number> = { NQ: 20, MNQ: 2 };
const EXIT_REASONS = ['target', 'stop', 'manual', 'end'];

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function sessionFor(entry: Date): string | null {
  const parts = nyClock.formatToParts(entry);
  const hour = Number(parts.find(p => p.type === 'hour')?.value) % 24;
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  const m = hour * 60 + minute;
  if (m >= 1080 || m < 120) return 'Asia';
  if (m < 570) return 'London';
  if (m < 720) return 'NY AM';
  if (m < 960) return 'NY PM';
  return null;
}

function positive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

// Optional string: undefined/null/'' -> null; wrong type or too long -> undefined (invalid)
function optString(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) return undefined;
  return v;
}

// POST /api/replay/trades — log a finished bar-replay practice trade (idempotent on client_id)
router.post('/trades', async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const bad = (error: string) => res.status(400).json({ error });

    if (!Number.isInteger(b.account_id)) return bad('account_id must be an integer');
    if (typeof b.client_id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.client_id)) {
      return bad('client_id must be 8-64 characters (letters, digits, hyphens)');
    }
    if (b.symbol !== 'NQ' && b.symbol !== 'MNQ') return bad("symbol must be 'NQ' or 'MNQ'");
    if (b.side !== 'long' && b.side !== 'short') return bad("side must be 'long' or 'short'");
    if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 100) {
      return bad('quantity must be an integer from 1 to 100');
    }
    for (const f of ['entry_price', 'exit_price', 'stop_loss', 'target']) {
      if (!positive(b[f])) return bad(`${f} must be a finite number greater than 0`);
    }
    for (const f of ['entry_time', 'exit_time']) {
      if (typeof b[f] !== 'string' || Number.isNaN(new Date(b[f]).getTime())) {
        return bad(`${f} must be a valid date-time string`);
      }
    }
    const entryDate = new Date(b.entry_time);
    const exitDate = new Date(b.exit_time);
    if (exitDate.getTime() < entryDate.getTime()) return bad('exit_time must not be before entry_time');
    if (!EXIT_REASONS.includes(b.exit_reason)) {
      return bad("exit_reason must be one of 'target', 'stop', 'manual', 'end'");
    }
    const timeframe = optString(b.timeframe, 10);
    if (timeframe === undefined) return bad('timeframe must be a string of at most 10 characters');
    const setupTag = optString(b.setup_tag, 100);
    if (setupTag === undefined) return bad('setup_tag must be a string of at most 100 characters');
    const userNotes = optString(b.notes, 2000);
    if (userNotes === undefined) return bad('notes must be a string of at most 2000 characters');

    const accountId: number = b.account_id;
    const symbol: string = b.symbol;
    const side: string = b.side;
    const quantity: number = b.quantity;
    const { entry_price, exit_price, stop_loss, target } = b as Record<string, number>;

    const acct = await pool.query(
      `SELECT id, timezone AS tz FROM accounts WHERE id = $1 AND user_id = $2`,
      [accountId, req.userId]
    );
    if (acct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    const tz: string | null = acct.rows[0].tz;

    const dir = side === 'long' ? 1 : -1;
    const pnl = Math.round((exit_price - entry_price) * dir * POINT_VALUE[symbol] * quantity * 100) / 100;

    const risk = Math.abs(entry_price - stop_loss);
    const reward = Math.abs(target - entry_price);
    const plannedRr = risk > 0 ? '1:' + String(Number((reward / risk).toFixed(2))) : null;

    const sideLabel = side === 'long' ? 'Long' : 'Short';
    const notes =
      `Bar replay · ${sideLabel} ${quantity} ${symbol} · exit ${b.exit_reason}` +
      (timeframe ? ` · ${timeframe} chart` : '') +
      (userNotes ? `\n${userNotes}` : '');

    const brokerTradeId = `replay_${b.client_id}`;

    // The account's 'Bar replay' attempt (created on first use)
    let attemptId: number;
    const att = await pool.query(
      `SELECT id FROM account_attempts WHERE account_id = $1 AND label = 'Bar replay' ORDER BY seq DESC LIMIT 1`,
      [accountId]
    );
    if (att.rows.length > 0) {
      attemptId = att.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO account_attempts (account_id, seq, label, status)
         SELECT $1, COALESCE(MAX(seq), 0) + 1, 'Bar replay', 'active' FROM account_attempts WHERE account_id = $1
         RETURNING id`,
        [accountId]
      );
      attemptId = ins.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time, entry_price, exit_price,
         quantity, pnl, setup_tag, notes, tags, stop_loss, target, attempt_id, session, timeframe, planned_rr)
       VALUES ($1, $2, $3, journal_utc_to_wall($4::timestamptz, $19), journal_utc_to_wall($5::timestamptz, $19), $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (broker_trade_id) DO NOTHING
       RETURNING *`,
      [
        accountId, brokerTradeId, symbol, entryDate.toISOString(), exitDate.toISOString(), entry_price, exit_price,
        quantity, pnl, setupTag, notes, ['Bar replay', sideLabel], stop_loss, target, attemptId,
        sessionFor(entryDate), timeframe, plannedRr, tz,
      ]
    );

    if (result.rows.length === 0) {
      const existing = await pool.query(
        'SELECT * FROM trades WHERE broker_trade_id = $1 AND account_id = $2',
        [brokerTradeId, accountId]
      );
      return res.json({ trade: existing.rows[0] ?? null, duplicate: true });
    }
    res.json({ trade: result.rows[0] });
  } catch (e: any) {
    console.error('[replay/trades]', e.message);
    res.status(500).json({ error: 'Failed to save the replay trade' });
  }
});

export default router;
