// Time & day pattern finder API (see src/patterns/timeScan.ts). Owner only: uses the chart's exchange data.
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { scan, cellDays, DIR_RULES, DirRule, ScanParams } from '../patterns/timeScan';
import { startHunt, latest, edgeStatus, candidateRecord } from '../patterns/edgeHunter';
import { recordStrategy, ensureTables, TradeSpec } from '../patterns/tradeBook';
import { load } from '../patterns/timeScan';
import { newsStudy } from '../patterns/news';
import { loadSessions, sessionStats } from '../patterns/sessions';
import { buildGrid, dayMap, analog, candleStats, candleOdds, CANDLE_TYPES, GapFilter, DayTypeFilter } from '../patterns/marketMemory';

const router = Router();
router.use(verifyToken, requireAdmin);

function parse(req: Request): ScanParams | string {
  const q = req.query;
  const contract = String(q.contract || 'NQ').toUpperCase();
  if (contract !== 'NQ' && contract !== 'MNQ') return 'contract must be NQ or MNQ';
  const targetUsd = Number(q.targetUsd ?? 150), stopUsd = Number(q.stopUsd ?? 100);
  if (!(targetUsd >= 5 && targetUsd <= 5000) || !(stopUsd >= 5 && stopUsd <= 5000)) return 'target and stop must be $5-$5000';
  const slotMin = Number(q.slotMin ?? 15);
  if (![5, 10, 15, 30, 60].includes(slotMin)) return 'slotMin must be 5, 10, 15, 30 or 60';
  const maxHoldMin = Number(q.maxHoldMin ?? 60);
  if (!(Number.isInteger(maxHoldMin) && maxHoldMin >= 5 && maxHoldMin <= 390)) return 'maxHoldMin must be 5-390';
  const dir = String(q.dir || 'long') as DirRule;
  if (!(dir in DIR_RULES)) return `dir must be one of ${Object.keys(DIR_RULES).join(', ')}`;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = q.from ? String(q.from) : undefined, to = q.to ? String(q.to) : undefined;
  if ((from && !day.test(from)) || (to && !day.test(to))) return 'from/to must be YYYY-MM-DD';
  return { contract, targetUsd, stopUsd, slotMin, maxHoldMin, dir, from, to } as ScanParams;
}

router.get('/time', async (req: Request, res: Response) => {
  const p = parse(req);
  if (typeof p === 'string') return res.status(400).json({ error: p });
  try { res.json({ result: await scan(p), rules: DIR_RULES }); }
  catch (e: any) { console.error('[patterns/time]', e.message); res.status(e.status || 500).json({ error: e.status ? e.message : 'Scan failed' }); }
});

router.get('/time/days', async (req: Request, res: Response) => {
  const p = parse(req);
  if (typeof p === 'string') return res.status(400).json({ error: p });
  const slot = String(req.query.slot || ''), wd = Number(req.query.wd ?? -1);
  if (!/^\d{1,2}:\d{2}$/.test(slot) || !(wd >= -1 && wd <= 4)) return res.status(400).json({ error: 'slot (H:MM) and wd (-1..4) required' });
  try { res.json({ days: await cellDays(p, slot, wd) }); }
  catch (e: any) { console.error('[patterns/time/days]', e.message); res.status(500).json({ error: 'Failed to list days' }); }
});

// Edge Hunter: latest saved run + whether one is running
router.get('/edge', async (_req: Request, res: Response) => {
  try { res.json({ result: await latest(), status: edgeStatus() }); }
  catch (e: any) { console.error('[patterns/edge]', e.message); res.status(500).json({ error: 'Failed to load the last search' }); }
});
// Start a new search in the background (about 10-60 s); poll GET /edge
router.post('/edge/run', (req: Request, res: Response) => {
  startHunt(req.userId).catch(e => console.error('[patterns/edge run]', e.message));
  res.json({ status: edgeStatus() });
});

// ---- Market Memory (src/patterns/marketMemory.ts) ----
const memErr = (res: Response, tag: string, e: any) => {
  if (e?.status) return res.status(e.status).json({ error: e.message });
  console.error(`[patterns/memory/${tag}]`, e);
  res.status(500).json({ error: 'Market Memory failed' });
};
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

router.get('/memory/info', async (_req: Request, res: Response) => {
  try { const g = buildGrid(await load()); res.json({ days: g.D, from: g.dates[0], to: g.dates[g.D - 1], dates: g.dates, candleTypes: CANDLE_TYPES }); }
  catch (e) { memErr(res, 'info', e); }
});
router.get('/memory/daymap', async (req: Request, res: Response) => {
  const gap = String(req.query.gap || 'all'), dayType = String(req.query.dayType || 'all'), unit = String(req.query.unit || 'pts');
  const wd = num(req.query.wd, -1);
  if (!['all', 'up', 'down', 'flat'].includes(gap) || !['all', 'trend', 'range'].includes(dayType) || !['pts', 'atr'].includes(unit) || !(wd >= -1 && wd <= 4))
    return res.status(400).json({ error: 'bad filter' });
  try { res.json(dayMap(buildGrid(await load()), { wd, gap: gap as GapFilter, dayType: dayType as DayTypeFilter, unit: unit as 'pts' | 'atr' })); }
  catch (e) { memErr(res, 'daymap', e); }
});
router.get('/memory/analog', async (req: Request, res: Response) => {
  const date = req.query.date ? String(req.query.date) : undefined, time = String(req.query.time || '10:30');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    res.json(analog(buildGrid(await load()), { date, time, lookback: num(req.query.lookback, 60), ahead: num(req.query.ahead, 30), k: num(req.query.k, 40), tol: num(req.query.tol, 10) }));
  } catch (e) { memErr(res, 'analog', e); }
});
router.get('/memory/candles', async (req: Request, res: Response) => {
  try { res.json(candleStats(buildGrid(await load()), { tf: num(req.query.tf, 5), next: num(req.query.next, 3) })); }
  catch (e) { memErr(res, 'candles', e); }
});

router.get('/memory/odds', async (req: Request, res: Response) => {
  try { res.json(candleOdds(buildGrid(await load()), { tf: num(req.query.tf, 5), from: String(req.query.from || '9:30'), to: String(req.query.to || '10:30') })); }
  catch (e) { memErr(res, 'odds', e); }
});
router.get('/memory/news', async (_req: Request, res: Response) => {
  try { res.json(await newsStudy()); } catch (e) { memErr(res, 'news', e); }
});
router.get('/memory/sessions', async (_req: Request, res: Response) => {
  try { res.json(sessionStats(await loadSessions())); } catch (e) { memErr(res, 'sessions', e); }
});

// ---- AI Trade Book (src/patterns/tradeBook.ts) ----
router.get('/book', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const r = await pool.query(`SELECT id, source, rule_key, name, rule, status, stats, gate, account_id, attempt_id, created_at, updated_at
      FROM ai_playbooks WHERE user_id = $1 ORDER BY (status = 'prop-ready') DESC, updated_at DESC`, [req.userId]);
    res.json({ playbooks: r.rows });
  } catch (e) { memErr(res, 'book', e); }
});
router.get('/book/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
  try {
    await ensureTables();
    const pb = await pool.query(`SELECT * FROM ai_playbooks WHERE id = $1 AND user_id = $2`, [id, req.userId]);
    if (!pb.rows.length) return res.status(404).json({ error: 'Not found' });
    const tr = await pool.query(`SELECT seq, trade_id, detail FROM ai_playbook_trades WHERE playbook_id = $1 ORDER BY seq`, [id]);
    res.json({ playbook: pb.rows[0], trades: tr.rows.map((x: any) => ({ tradeId: x.trade_id, ...x.detail })) });
  } catch (e) { memErr(res, 'book-one', e); }
});
// Record every trade of an Edge Hunter candidate from the latest run (manual, any candidate)
router.post('/book/record-candidate', async (req: Request, res: Response) => {
  const key = Number(req.body?.key);
  if (!Number.isInteger(key)) return res.status(400).json({ error: 'key required' });
  try {
    const run = await latest();
    const c = run?.candidates.find(x => x.key === key);
    if (!c) return res.status(404).json({ error: 'That rule is not in the latest Edge Hunter run' });
    res.json(await recordStrategy(candidateRecord(c, req.userId!).input));
  } catch (e) { memErr(res, 'record', e); }
});
// Record a strategy from any AI backtest (research scripts): trades + stats
router.post('/book/record-custom', async (req: Request, res: Response) => {
  const b = req.body || {};
  const ok = typeof b.name === 'string' && b.name.length <= 120 && typeof b.rule === 'string' && b.rule.length <= 2000
    && typeof b.ruleKey === 'string' && /^[\w:.-]{1,80}$/.test(b.ruleKey) && Array.isArray(b.trades) && b.trades.length > 0 && b.trades.length <= 5000
    && b.stats && typeof b.stats === 'object';
  if (!ok) return res.status(400).json({ error: 'name, rule, ruleKey, stats and trades[] required' });
  const trades: TradeSpec[] = [];
  for (const t of b.trades) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t?.date)) || !Number.isInteger(t.entryMin) || ![1, -1].includes(t.dir) || !(Number(t.targetR) > 0) || !(Number(t.holdMin) > 0)
      || !(Number(t.stopPts) > 0 || Number(t.stopAtr) > 0)) return res.status(400).json({ error: 'bad trade: ' + JSON.stringify(t).slice(0, 120) });
    trades.push({ date: t.date, entryMin: t.entryMin, dir: t.dir, stopPts: t.stopPts ? Number(t.stopPts) : undefined, stopAtr: t.stopAtr ? Number(t.stopAtr) : undefined,
      targetR: Number(t.targetR), holdMin: Number(t.holdMin), refR: t.refR == null ? undefined : Number(t.refR) });
  }
  const st = b.stats;
  const stats = { n: Number(st.n) || trades.length, tStat: Number(st.tStat) || 0, hold: st.hold || { n: 0, avgR: 0 }, val: st.val || { avgR: 0 },
    maxDdR: Number(st.maxDdR) || 0, maxLosingStreak: Number(st.maxLosingStreak) || 0, perDay: Number(st.perDay) || 0, ...st };
  try { res.json(await recordStrategy({ userId: req.userId!, source: String(b.source || 'AI research').slice(0, 60), ruleKey: 'custom:' + b.ruleKey, name: b.name, rule: b.rule, stats, trades })); }
  catch (e) { memErr(res, 'record-custom', e); }
});
// Remove a strategy and the journal trades it created (only its own rows)
router.delete('/book/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
  try {
    await ensureTables();
    const pb = await pool.query(`SELECT id, account_id, attempt_id FROM ai_playbooks WHERE id = $1 AND user_id = $2`, [id, req.userId]);
    if (!pb.rows.length) return res.status(404).json({ error: 'Not found' });
    const { account_id, attempt_id } = pb.rows[0];
    await pool.query(`DELETE FROM trades WHERE account_id = $1 AND broker_trade_id LIKE $2`, [account_id, `ai_${id}_%`]);
    await pool.query(`DELETE FROM ai_playbooks WHERE id = $1`, [id]);
    await pool.query(`DELETE FROM account_attempts WHERE id = $1 AND account_id = $2 AND NOT EXISTS (SELECT 1 FROM trades WHERE attempt_id = $1)`, [attempt_id, account_id]);
    res.json({ ok: true });
  } catch (e) { memErr(res, 'book-delete', e); }
});

export default router;
