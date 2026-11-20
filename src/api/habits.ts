// Discipline tools: personal risk rules + rule breaks, post-trade debriefs, discipline score / XP / streaks.
// Mounted at /api/habits (signed in; every account route checks ownership).
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAccountParam } from '../security';
import { debriefStats, EMOTIONS } from '../shared/habits';
import { violations, score, getRules, accountToday } from '../services/habitsData';

const router = Router();
router.use(verifyToken);
const fail = (res: Response, where: string, e: unknown) => { console.error(`[habits] ${where}`, (e as Error).message); res.status(500).json({ error: 'Server error' }); };
const attemptOf = (req: Request) => (req.query.attempt ? Number(req.query.attempt) || null : null);

// ---- rules
router.get('/rules/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try { res.json({ rules: await getRules(Number(req.params.account_id)) }); } catch (e) { fail(res, 'rules', e); }
});

router.put('/rules/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  const b = req.body || {};
  const int = (v: unknown, max: number) => (v === null || v === '' || v === undefined ? null : Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= max ? Number(v) : NaN);
  const money = (v: unknown) => (v === null || v === '' || v === undefined ? null : Number(v) > 0 && Number(v) < 1e7 ? Math.round(Number(v) * 100) / 100 : NaN);
  const hhmm = (v: unknown) => (v === null || v === '' || v === undefined ? null : /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : 'bad');
  const vals = {
    max_trades_day: int(b.max_trades_day, 100), max_losses_day: int(b.max_losses_day, 50), max_contracts: int(b.max_contracts, 1000),
    max_daily_loss: money(b.max_daily_loss), start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), respect_news: !!b.respect_news,
  };
  if ([vals.max_trades_day, vals.max_losses_day, vals.max_contracts, vals.max_daily_loss].some(v => Number.isNaN(v)) || vals.start_time === 'bad' || vals.end_time === 'bad')
    return res.status(400).json({ error: 'Use whole numbers for counts, a positive dollar amount, and HH:MM times (or leave empty).' });
  try {
    await pool.query(
      `INSERT INTO account_rules (account_id, max_trades_day, max_losses_day, max_contracts, max_daily_loss, start_time, end_time, respect_news, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (account_id) DO UPDATE SET max_trades_day=$2, max_losses_day=$3, max_contracts=$4, max_daily_loss=$5, start_time=$6, end_time=$7, respect_news=$8, updated_at=NOW()`,
      [req.params.account_id, vals.max_trades_day, vals.max_losses_day, vals.max_contracts, vals.max_daily_loss, vals.start_time, vals.end_time, vals.respect_news]);
    res.json({ rules: await getRules(Number(req.params.account_id)) });
  } catch (e) { fail(res, 'rules put', e); }
});

// GET /api/habits/violations/:account_id?days=30&attempt=
router.get('/violations/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  const days = Math.min(400, Math.max(1, Number(req.query.days ?? 30) || 30));
  try {
    const v = await violations(Number(req.params.account_id), days, attemptOf(req));
    res.json({ rules: v.rules, violations: v.list.reverse(), days, today: await accountToday(Number(req.params.account_id)) });
  } catch (e) { fail(res, 'violations', e); }
});

// ---- debriefs
router.get('/debriefs/pending/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT t.id, t.symbol, to_char(t.entry_time, 'YYYY-MM-DD HH24:MI') AS entry, t.entry_price, t.exit_price, t.quantity, t.pnl, t.setup_tag
         FROM trades t LEFT JOIN trade_debriefs d ON d.trade_id = t.id
        WHERE t.account_id = $1 AND d.trade_id IS NULL AND t.pnl IS NOT NULL AND t.entry_time >= NOW() - interval '14 days'
          AND ($2::int IS NULL OR t.attempt_id = $2)
        ORDER BY t.entry_time DESC LIMIT 30`, [req.params.account_id, attemptOf(req)]);
    res.json({ trades: r.rows, emotions: EMOTIONS });
  } catch (e) { fail(res, 'pending', e); }
});

router.get('/debriefs/trade/:trade_id', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT d.* FROM trade_debriefs d JOIN trades t ON t.id = d.trade_id JOIN accounts a ON a.id = t.account_id
        WHERE d.trade_id = $1 AND a.user_id = $2`, [req.params.trade_id, req.userId]);
    res.json({ debrief: r.rows[0] ?? null });
  } catch (e) { fail(res, 'debrief get', e); }
});

router.put('/debriefs/:trade_id', async (req: Request, res: Response) => {
  const b = req.body || {};
  const bool = (v: unknown) => (v === true || v === false ? v : null);
  const emotion = b.emotion == null || b.emotion === '' ? null : (EMOTIONS as readonly string[]).includes(b.emotion) ? b.emotion : 'bad';
  const quality = b.quality == null || b.quality === '' ? null : Number.isInteger(Number(b.quality)) && Number(b.quality) >= 1 && Number(b.quality) <= 5 ? Number(b.quality) : NaN;
  if (emotion === 'bad' || Number.isNaN(quality)) return res.status(400).json({ error: 'Unknown emotion, or quality not 1-5.' });
  const lesson = typeof b.lesson === 'string' ? b.lesson.slice(0, 1000) : null;
  try {
    const own = await pool.query('SELECT 1 FROM trades t JOIN accounts a ON a.id = t.account_id WHERE t.id = $1 AND a.user_id = $2', [req.params.trade_id, req.userId]);
    if (!own.rows.length) return res.status(404).json({ error: 'Trade not found' });
    const r = await pool.query(
      `INSERT INTO trade_debriefs (trade_id, user_id, followed_plan, emotion, retake, quality, lesson) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (trade_id) DO UPDATE SET followed_plan=$3, emotion=$4, retake=$5, quality=$6, lesson=$7, updated_at=NOW() RETURNING *`,
      [req.params.trade_id, req.userId, bool(b.followed_plan), emotion, bool(b.retake), quality, lesson]);
    res.json({ debrief: r.rows[0] });
  } catch (e) { fail(res, 'debrief put', e); }
});

router.get('/debriefs/stats/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT t.pnl, d.emotion, d.followed_plan, d.retake, d.quality FROM trade_debriefs d JOIN trades t ON t.id = d.trade_id
        WHERE t.account_id = $1 AND t.pnl IS NOT NULL AND ($2::int IS NULL OR t.attempt_id = $2)`, [req.params.account_id, attemptOf(req)]);
    res.json(debriefStats(r.rows.map(x => ({ ...x, pnl: Number(x.pnl) }))));
  } catch (e) { fail(res, 'debrief stats', e); }
});

// ---- discipline score / XP / streaks / challenges
router.get('/score/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try { res.json(await score(req.userId!, Number(req.params.account_id))); } catch (e) { fail(res, 'score', e); }
});

export default router;
