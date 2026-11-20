// Economic calendar, big-tech earnings and the pre-market snapshot: /api/calendar
import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { parseEventsFile, FileTz, Impact } from '../shared/econCalendar';
import { listEvents, saveEvents, coverage, reactions } from '../news/econEvents';
import { earnings, premarket } from '../services/marketData';

const router = Router();
router.use(verifyToken);
const fail = (res: Response, where: string, e: unknown) => { console.error(`[calendar] ${where}`, (e as Error).message); res.status(502).json({ error: (e as Error).message || 'Server error' }); };

// GET /api/calendar/events?days=7&back=1&impact=high,medium
router.get('/events', async (req: Request, res: Response) => {
  const days = Math.min(60, Math.max(1, Number(req.query.days ?? 7) || 7));
  const back = Math.min(60, Math.max(0, Number(req.query.back ?? 1) || 0));
  const impacts = String(req.query.impact ?? 'high,medium').split(',').filter(x => ['high', 'medium', 'low'].includes(x)) as Impact[];
  try {
    const now = Date.now();
    res.json({ events: await listEvents(now - back * 86400000, now + days * 86400000, impacts.length ? impacts : ['high']), coverage: await coverage(),
      reactionsPeriod: reactions()?.period ?? null });
  } catch (e) { fail(res, 'events', e); }
});

// GET /api/calendar/earnings[?refresh=1]
router.get('/earnings', async (req: Request, res: Response) => {
  try { res.json(await earnings(req.query.refresh === '1')); } catch (e) { fail(res, 'earnings', e); }
});

// GET /api/calendar/premarket
router.get('/premarket', async (_req: Request, res: Response) => {
  try { res.json(await premarket()); } catch (e) { fail(res, 'premarket', e); }
});

// POST /api/calendar/import {text, tz, preview} — ForexFactory weekly export (JSON / CSV) or history CSV (admin: shared table)
router.post('/import', requireAdmin, async (req: Request, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const tz = (['auto', 'ny', 'london', 'utc'].includes(req.body?.tz) ? req.body.tz : 'auto') as FileTz;
  if (!text.trim()) return res.status(400).json({ error: 'Send the file text as {text}' });
  const p = parseEventsFile(text, tz);
  if (p.errors.length && !p.events.length) return res.status(400).json({ error: p.errors[0], format: p.format });
  const sample = p.events.filter(e => /CPI m\/m|Non-Farm Employment Change|Federal Funds Rate|Retail Sales m\/m/.test(e.title)).slice(-4);
  const summary = {
    format: p.format, tz: p.tz, events: p.events.length, skipped: p.skipped,
    first: p.events[0]?.release_utc ?? null, last: p.events[p.events.length - 1]?.release_utc ?? null,
    high: p.events.filter(e => e.impact === 'high').length,
    check: sample.map(e => ({ title: e.title, release_utc: e.release_utc })),
  };
  if (req.body?.preview) return res.json({ preview: true, ...summary });
  try { res.json({ saved: await saveEvents(p.events, p.format.slice(0, 40)), ...summary, coverage: await coverage() }); }
  catch (e) { fail(res, 'import', e); }
});

export default router;
