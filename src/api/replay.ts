import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { SYMBOLS } from '../bars/store';

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
    // Coach rules broken on this trade (practice discipline): tagged and written into the notes
    const ruleBreaks: string[] = Array.isArray(b.rule_breaks)
      ? b.rule_breaks.filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 10).map((x: string) => x.slice(0, 160))
      : [];

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
    const computed = Math.round((exit_price - entry_price) * dir * POINT_VALUE[symbol] * quantity * 100) / 100;
    const clientPnl = typeof b.pnl === 'number' && Number.isFinite(b.pnl) ? Math.round(b.pnl * 100) / 100 : null;
    // partial exits / adds: averages are rounded to the cent, so the exact P&L comes from the client
    const pnl = clientPnl !== null && Math.abs(clientPnl - computed) <= 0.01 * POINT_VALUE[symbol] * quantity + 0.01 ? clientPnl : computed;

    const risk = Math.abs(entry_price - stop_loss);
    const reward = Math.abs(target - entry_price);
    const plannedRr = risk > 0 ? '1:' + String(Number((reward / risk).toFixed(2))) : null;

    const sideLabel = side === 'long' ? 'Long' : 'Short';
    const notes =
      `Bar replay · ${sideLabel} ${quantity} ${symbol} · exit ${b.exit_reason}` +
      (timeframe ? ` · ${timeframe} chart` : '') +
      (userNotes ? `\n${userNotes}` : '') +
      (ruleBreaks.length ? `\nRule breaks: ${ruleBreaks.join(' | ')}` : '');

    // Chart picture at the close (data URL from the chart), shown in the trade's review
    const shot = typeof b.screenshot === 'string' && /^data:image\/(jpeg|png);base64,/.test(b.screenshot) && b.screenshot.length <= 3_000_000 ? b.screenshot : null;

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
         quantity, pnl, setup_tag, notes, tags, stop_loss, target, attempt_id, session, timeframe, planned_rr, screenshot)
       VALUES ($1, $2, $3, journal_utc_to_wall($4::timestamptz, $19), journal_utc_to_wall($5::timestamptz, $19), $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $20)
       ON CONFLICT (broker_trade_id) DO NOTHING
       RETURNING *`,
      [
        accountId, brokerTradeId, symbol, entryDate.toISOString(), exitDate.toISOString(), entry_price, exit_price,
        quantity, pnl, setupTag, notes, ['Bar replay', sideLabel, ...(ruleBreaks.length ? ['Rule break'] : [])], stop_loss, target, attemptId,
        sessionFor(entryDate), timeframe, plannedRr, tz, shot,
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

// ---------------------------------------------------------------------------------------------
// S1 practice set: 25 fixed replay days (a mix of day types) + the trader's replay trades.
// The client scores each trade against the S1 bot rules (utils/s1Score.ts).
// Days come from before PRACTICE_END so the set never changes as new data arrives.
const PRACTICE_END = '2026-11-14';
const PRACTICE_MIX: [string, number][] = [['trend', 8], ['range', 7], ['gapup', 3], ['gapdown', 3], ['bigrange', 2], ['smallrange', 2]];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  // avalanche, so near-identical dates do not sort next to each other
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

router.get('/practice', async (req: Request, res: Response) => {
  try {
    const d = await pool.query(
      `WITH d AS (
         SELECT (ts AT TIME ZONE 'America/New_York')::date AS day, o / 100.0 AS o, h / 100.0 AS h, l / 100.0 AS l, c / 100.0 AS c
           FROM bars_agg WHERE sym = $2 AND tf = 1441),
       x AS (
         SELECT day, o, h, l, c, lag(c) OVER (ORDER BY day) AS pc,
                avg(h - l) OVER (ORDER BY day ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING) AS atr
           FROM d)
       SELECT day::text AS day, o, h, l, c, pc, atr FROM x
        WHERE pc IS NOT NULL AND atr IS NOT NULL AND day <= $1::date ORDER BY day`,
      [PRACTICE_END, SYMBOLS.NQ]);
    const all = d.rows.map((x: any) => {
      const o = Number(x.o), h = Number(x.h), l = Number(x.l), c = Number(x.c), pc = Number(x.pc), atr = Number(x.atr);
      const range = h - l;
      return { day: x.day as string, range, atr, gapPct: ((o - pc) / pc) * 100, body: range > 0 ? (c - o) / range : 0, dir: c >= o ? 'up' : 'down' };
    });
    const is: Record<string, (x: typeof all[number]) => boolean> = {
      trend: x => Math.abs(x.body) >= 0.6 && x.range >= 0.9 * x.atr,
      range: x => Math.abs(x.body) <= 0.2 && x.range <= 1.1 * x.atr,
      gapup: x => x.gapPct >= 0.4,
      gapdown: x => x.gapPct <= -0.4,
      bigrange: x => x.range >= 1.5 * x.atr,
      smallrange: x => x.range <= 0.6 * x.atr,
    };
    const picked = new Map<string, { day: string; kind: string; dir: string; range: number; atr: number }>();
    for (const [kind, n] of PRACTICE_MIX) {
      const pool_ = all.filter(x => is[kind](x) && !picked.has(x.day)).sort((a, b) => hash(kind + a.day) - hash(kind + b.day));
      for (const x of pool_.slice(0, n)) picked.set(x.day, { day: x.day, kind, dir: x.dir, range: Math.round(x.range), atr: Math.round(x.atr) });
    }

    const t = await pool.query(
      `SELECT t.id, t.symbol, t.quantity, t.entry_price, t.exit_price, t.stop_loss, t.target, t.pnl, t.setup_tag, t.tags, t.notes,
              a.account_name,
              journal_wall_to_utc(t.entry_time, a.timezone) AS entry_utc,
              journal_wall_to_utc(t.exit_time, a.timezone)  AS exit_utc
         FROM trades t JOIN accounts a ON a.id = t.account_id
        WHERE a.user_id = $1 AND t.tags @> ARRAY['Bar replay']::text[] AND t.entry_time IS NOT NULL
        ORDER BY t.entry_time`,
      [req.userId]);
    const n = (v: any) => (v === null || v === undefined ? null : Number(v));
    const trades = t.rows.map((r: any) => ({
      id: r.id, symbol: r.symbol, quantity: n(r.quantity), entry_price: n(r.entry_price), exit_price: n(r.exit_price),
      stop_loss: n(r.stop_loss), target: n(r.target), pnl: n(r.pnl), setup_tag: r.setup_tag, tags: r.tags || [],
      account_name: r.account_name,
      side: Array.isArray(r.tags) && r.tags.includes('Short') ? 'short' : 'long',
      entry: r.entry_utc ? new Date(r.entry_utc).getTime() : null,
      exit: r.exit_utc ? new Date(r.exit_utc).getTime() : null,
    })).filter((x: any) => x.entry !== null);
    const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const tradedDays = new Map<string, number>();
    for (const x of trades) { const k = etDay.format(new Date(x.entry as number)); tradedDays.set(k, (tradedDays.get(k) || 0) + 1); }
    const days = [...picked.values()]
      .sort((a, b) => hash('order' + a.day) - hash('order' + b.day))
      .map((x, i) => ({ ...x, n: i + 1, trades: tradedDays.get(x.day) || 0 }));
    res.json({ days, trades, end: PRACTICE_END });
  } catch (e: any) {
    console.error('[replay/practice]', e.message);
    res.status(500).json({ error: 'Failed to load the practice set' });
  }
});

export default router;
