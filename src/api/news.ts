// News Event Analyzer API (owner-only research): /api/news
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { requireAccountParam } from '../security';
import { eventStudy, calendar, parseForecastCsv, getReleases } from '../news/econData';
import { EVENT_INFO, EventCode, personalStats, PTrade } from '../news/econStats';
import { summarize } from '../news/summary';

const router = Router();
router.use(verifyToken);

const fail = (res: Response, where: string, e: unknown) => { console.error(`[news] ${where}`, (e as Error).message); res.status(500).json({ error: 'Server error' }); };
const isEvent = (x: unknown): x is EventCode => typeof x === 'string' && x in EVENT_INFO;
const PV: Record<string, number> = { NQ: 20, MNQ: 2, ES: 50, MES: 5 };

// ---- prop-firm news blackout (any signed-in user, own accounts only) ----
// GET /api/news/blackout/:account_id -> { before, after, upcoming: [{event, utc, name}] (next 7 days) }
router.get('/blackout/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const a = await pool.query('SELECT news_blackout_before_min AS before, news_blackout_after_min AS after FROM accounts WHERE id = $1', [req.params.account_id]);
    const now = Date.now(), week = now + 7 * 86400000;
    const up = (await calendar()).filter(r => { const t = Date.parse(r.utc); return t > now - 3 * 3600000 && t < week; })
      .map(r => ({ event: r.event, name: EVENT_INFO[r.event].name, utc: r.utc, shared: r.shared }));
    res.json({ before: a.rows[0]?.before ?? null, after: a.rows[0]?.after ?? null, upcoming: up });
  } catch (e) { fail(res, 'blackout', e); }
});

// PUT /api/news/blackout/:account_id {before, after} (minutes; null = off)
router.put('/blackout/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  const ok = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 240);
  const { before = null, after = null } = req.body || {};
  if (!ok(before) || !ok(after)) return res.status(400).json({ error: 'before/after must be whole minutes from 0 to 240, or null' });
  try {
    await pool.query('UPDATE accounts SET news_blackout_before_min = $2, news_blackout_after_min = $3 WHERE id = $1', [req.params.account_id, before, after]);
    res.json({ before, after });
  } catch (e) { fail(res, 'blackout put', e); }
});

// ---- research (owner only: uses the market-data copy) ----
router.use(requireAdmin);

// GET /api/news/calendar — all releases (past with first-release values, upcoming known dates)
router.get('/calendar', async (_req: Request, res: Response) => {
  try { res.json({ events: Object.entries(EVENT_INFO).map(([k, v]) => ({ code: k, ...v })), releases: await calendar() }); }
  catch (e) { fail(res, 'calendar', e); }
});

// GET /api/news/study/:event?sigma=0.5&shared=0
router.get('/study/:event', async (req: Request, res: Response) => {
  const ev = String(req.params.event).toUpperCase();
  if (!isEvent(ev)) return res.status(400).json({ error: 'event must be CPI, NFP, PPI, RETAIL or FOMC' });
  const sigma = Number(req.query.sigma ?? 0.5);
  if (!(sigma > 0 && sigma <= 3)) return res.status(400).json({ error: 'sigma must be between 0 and 3' });
  try { res.json(await eventStudy(ev, { sigma, includeShared: req.query.shared === '1' })); }
  catch (e) { fail(res, 'study', e); }
});

// GET /api/news/summary/:event?sigma=&shared= — 3-5 plain-English bullets from the computed stats only
router.get('/summary/:event', async (req: Request, res: Response) => {
  const ev = String(req.params.event).toUpperCase();
  if (!isEvent(ev)) return res.status(400).json({ error: 'event must be CPI, NFP, PPI, RETAIL or FOMC' });
  const sigma = Number(req.query.sigma ?? 0.5);
  if (!(sigma > 0 && sigma <= 3)) return res.status(400).json({ error: 'sigma must be between 0 and 3' });
  try { res.json(await summarize(await eventStudy(ev, { sigma, includeShared: req.query.shared === '1' }) as any)); }
  catch (e) { fail(res, 'summary', e); }
});

// POST /api/news/forecasts {csv} — import consensus forecasts / upcoming dates: event,date,time,forecast,source
router.post('/forecasts', async (req: Request, res: Response) => {
  const text = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!text.trim() || text.length > 500_000) return res.status(400).json({ error: 'Send the CSV text (up to 500 KB) as {csv}' });
  const { rows, errors } = parseForecastCsv(text);
  if (!rows.length) return res.status(400).json({ error: 'No valid rows', errors: errors.slice(0, 20) });
  try {
    for (const r of rows) {
      await pool.query(
        `INSERT INTO econ_forecasts (event, release_date, release_time, forecast, source, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (event, release_date) DO UPDATE SET release_time = COALESCE(EXCLUDED.release_time, econ_forecasts.release_time),
           forecast = EXCLUDED.forecast, source = EXCLUDED.source, updated_at = NOW()`,
        [r.event, r.release_date, r.release_time, r.forecast, r.source]);
    }
    res.json({ imported: rows.length, errors: errors.slice(0, 20) });
  } catch (e) { fail(res, 'forecasts', e); }
});

// GET /api/news/personal?account_id= — the trader's results on each event's days vs normal days
router.get('/personal', async (req: Request, res: Response) => {
  const acc = Number(req.query.account_id);
  if (!Number.isInteger(acc)) return res.status(400).json({ error: 'account_id is required' });
  try {
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [acc, req.userId]);
    if (!own.rows.length) return res.status(404).json({ error: 'Account not found' });
    const t = await pool.query(
      `SELECT to_char(journal_wall_to_utc(t.entry_time, a.timezone) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
              t.pnl, t.entry_price, t.stop_loss, t.quantity, t.symbol
         FROM trades t JOIN accounts a ON a.id = t.account_id WHERE t.account_id = $1 AND t.pnl IS NOT NULL`, [acc]);
    const trades: PTrade[] = t.rows.map((r: any) => {
      const pv = PV[String(r.symbol || '').toUpperCase()];
      const risk = pv && r.entry_price && r.stop_loss && r.quantity ? Math.abs(Number(r.entry_price) - Number(r.stop_loss)) * pv * Number(r.quantity) : 0;
      return { day: r.day, pnl: Number(r.pnl), r: risk > 0 ? Number(r.pnl) / risk : null };
    });
    const rels = (await getReleases()).filter(r => r.actual != null);
    const allDays = new Set(rels.map(r => r.date));
    const out: Record<string, unknown> = {};
    for (const ev of Object.keys(EVENT_INFO) as EventCode[]) {
      const evDays = new Set(rels.filter(r => r.event === ev).map(r => r.date));
      // "normal" = days with none of the five events
      const s = personalStats(trades.filter(x => evDays.has(x.day) || !allDays.has(x.day)), evDays);
      out[ev] = s;
    }
    res.json({ account_id: acc, trades: trades.length, byEvent: out });
  } catch (e) { fail(res, 'personal', e); }
});

export default router;
