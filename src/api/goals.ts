// Profit goals: "make X by date D", the plan chosen to get there, and progress from the account's own trades.
// Mounted at /api/goals (own auth).
//   GET    /baseline/:account_id     -> your numbers from the last 120 days of closed trades + the account's limits
//   GET    /?account_id=             -> saved goals with progress
//   POST   /                         { account_id, title?, amount, start_date, end_date, plan? }
//   PUT    /:id                      same fields
//   DELETE /:id
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { pointValue } from '../utils/pointValue';
import { cadRates } from '../services/marketData';
import { baseline, TradeLite } from '../shared/goalPlanner';

const router = Router();
router.use(verifyToken);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (res: Response, where: string, e: unknown) => { console.error(`[goals] ${where}`, e); res.status(500).json({ error: 'Something went wrong' }); };

async function account(userId: number, id: unknown) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const r = await pool.query(
    `SELECT id, currency, cost_per_trade, prop_daily_loss_limit, prop_max_drawdown, prop_starting_balance, prop_profit_target, account_type
     FROM accounts WHERE id = $1 AND user_id = $2`, [n, userId]);
  return r.rows[0] ?? null;
}

router.get('/baseline/:account_id', async (req: Request, res: Response) => {
  try {
    const a = await account(req.userId!, req.params.account_id);
    if (!a) return res.status(404).json({ error: 'Account not found' });
    const r = await pool.query(
      `SELECT pnl, quantity, symbol, to_char(DATE(entry_time), 'YYYY-MM-DD') AS d FROM trades
       WHERE account_id = $1 AND pnl IS NOT NULL AND entry_time >= NOW() - INTERVAL '120 days'
       ORDER BY entry_time DESC LIMIT 3000`, [a.id]);
    const trades: TradeLite[] = r.rows.map(t => ({ pnl: Number(t.pnl), qty: Math.abs(Number(t.quantity)), pv: pointValue(String(t.symbol)), day: t.d }));
    const symbols = new Map<string, number>();
    for (const t of r.rows) {
      const s = String(t.symbol).replace(/^[A-Z_]+:/, '').toUpperCase().replace(/[^A-Z].*$/, '') || String(t.symbol);
      symbols.set(s, (symbols.get(s) ?? 0) + 1);
    }
    const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const fx = await cadRates();
    res.json({
      fx: { cad: fx.rates, live: fx.live, at: new Date(fx.at).toISOString() },
      baseline: baseline(trades),
      symbol: [...symbols.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      account: {
        currency: a.currency || 'INR', costPerTrade: num(a.cost_per_trade) ?? 0, type: a.account_type,
        dailyLossLimit: num(a.prop_daily_loss_limit), maxDrawdown: num(a.prop_max_drawdown),
        startingBalance: num(a.prop_starting_balance), profitTarget: num(a.prop_profit_target),
      },
    });
  } catch (e) { fail(res, 'baseline', e); }
});

/** Net P&L of the account between two dates (costs per trade taken off, like the dashboard). */
async function earned(accountId: number, from: string, to: string, cost: number): Promise<{ pnl: number; trades: number }> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(pnl), 0) AS pnl, COUNT(*)::int AS n FROM trades
     WHERE account_id = $1 AND pnl IS NOT NULL AND DATE(entry_time) BETWEEN $2::date AND $3::date`, [accountId, from, to]);
  return { pnl: Number(r.rows[0].pnl) - cost * r.rows[0].n, trades: r.rows[0].n };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const a = await account(req.userId!, req.query.account_id);
    if (!a) return res.status(404).json({ error: 'Account not found' });
    const g = await pool.query(
      `SELECT id, title, amount, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, plan, created_at
       FROM goals WHERE user_id = $1 AND account_id = $2 ORDER BY end_date DESC, id DESC LIMIT 50`, [req.userId, a.id]);
    const cost = Number(a.cost_per_trade) || 0;
    const goals = [];
    for (const row of g.rows) goals.push({ ...row, amount: Number(row.amount), ...(await earned(a.id, row.start_date, row.end_date, cost)) });
    res.json({ goals });
  } catch (e) { fail(res, 'list', e); }
});

export function checkGoal(b: any): string | null {
  const amount = Number(b?.amount);
  if (!(amount > 0 && amount < 1e9)) return 'Goal amount must be more than 0.';
  if (!DATE_RE.test(String(b?.start_date)) || !DATE_RE.test(String(b?.end_date))) return 'Dates must be YYYY-MM-DD.';
  if (b.end_date < b.start_date) return 'The end date must be after the start date.';
  if (b.plan != null && (typeof b.plan !== 'object' || Array.isArray(b.plan) || JSON.stringify(b.plan).length > 4000)) return 'Plan is too large.';
  return null;
}
const title = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);

router.post('/', async (req: Request, res: Response) => {
  try {
    const a = await account(req.userId!, req.body?.account_id);
    if (!a) return res.status(404).json({ error: 'Account not found' });
    const err = checkGoal(req.body); if (err) return res.status(400).json({ error: err });
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM goals WHERE user_id = $1', [req.userId]);
    if (n.rows[0].n >= 200) return res.status(400).json({ error: 'Too many goals; delete old ones first.' });
    const r = await pool.query(
      `INSERT INTO goals (user_id, account_id, title, amount, start_date, end_date, plan) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.userId, a.id, title(req.body.title), Number(req.body.amount), req.body.start_date, req.body.end_date, req.body.plan ?? null]);
    res.json({ id: r.rows[0].id });
  } catch (e) { fail(res, 'create', e); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const err = checkGoal(req.body); if (err) return res.status(400).json({ error: err });
    const r = await pool.query(
      `UPDATE goals SET title = $3, amount = $4, start_date = $5, end_date = $6, plan = $7 WHERE id = $1 AND user_id = $2 RETURNING id`,
      [Number(req.params.id), req.userId, title(req.body.title), Number(req.body.amount), req.body.start_date, req.body.end_date, req.body.plan ?? null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Goal not found' });
    res.json({ ok: true });
  } catch (e) { fail(res, 'update', e); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('DELETE FROM goals WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Goal not found' });
    res.json({ ok: true });
  } catch (e) { fail(res, 'delete', e); }
});

export default router;
