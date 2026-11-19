// Time & day pattern finder API (see src/patterns/timeScan.ts). Owner only: uses the chart's exchange data.
import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { scan, cellDays, DIR_RULES, DirRule, ScanParams } from '../patterns/timeScan';
import { startHunt, latest, edgeStatus } from '../patterns/edgeHunter';
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
router.post('/edge/run', (_req: Request, res: Response) => {
  startHunt().catch(e => console.error('[patterns/edge run]', e.message));
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

export default router;
