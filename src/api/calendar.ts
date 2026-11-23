// Economic calendar, big-tech earnings and the pre-market snapshot: /api/calendar
import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { parseEventsFile, FileTz, Impact } from '../shared/econCalendar';
import { listEvents, saveEvents, coverage, reactions } from '../news/econEvents';
import { earnings, premarket } from '../services/marketData';
import { upcoming, storedHeadlines } from '../news/live';
import { SCHEDULED } from '../shared/newsFeed';
import { reactionFor, nyToUtc } from '../shared/econCalendar';
import { ChartNews, pickChartHeadlines } from '../shared/chartNews';

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

// GET /api/calendar/chart?from=ms&to=ms&medium=1 — news lines for the market chart: imported history (with actual vs
// forecast) plus the official upcoming list, each with the NQ reaction study row. Spans up to 400 days per call.
router.get('/chart', async (req: Request, res: Response) => {
  const from = Number(req.query.from), to = Number(req.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 400 * 86400000) return res.status(400).json({ error: 'from/to: up to 400 days' });
  const impacts: Impact[] = req.query.medium === '1' ? ['high', 'medium'] : ['high'];
  try {
    const t = reactions();
    const hist = (await listEvents(from, to, impacts)).filter(e => e.currency === 'USD');
    const out: ChartNews[] = hist.map(e => ({
      utc: e.release_utc, title: e.title, impact: e.impact, actual: e.actual, forecast: e.forecast, previous: e.previous, surprise: e.surprise,
      kind: /fomc|federal funds|fed /i.test(e.title) ? 'fed' : 'data', nq: reactionFor(t, e.title),
    }));
    const now = Date.now();
    if (to > now - 3 * 3600000) {
      const up = await upcoming(Math.max(from, now - 3 * 3600000), to, false);
      const near = (ms: number) => out.some(o => Math.abs(Date.parse(o.utc) - ms) < 60000);
      for (const e of up.events) {
        const ms = Date.parse(e.utc);
        if (!impacts.includes(e.impact) || near(ms)) continue;
        const study = SCHEDULED.find(s => s.label === e.title)?.study ?? (e.kind === 'fed' ? 'FOMC Statement' : null);
        out.push({ utc: e.utc, title: e.title, impact: e.impact, actual: null, forecast: null, previous: null, surprise: null,
          kind: e.kind === 'fed' ? 'fed' : 'data', nq: study ? reactionFor(t, study) : null });
      }
      try {
        const er = await earnings();
        for (const x of er.events as { symbol: string; day: string; timing: string | null }[]) {
          if (!['NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA', 'AVGO'].includes(x.symbol)) continue;
          const [y, mo, d] = x.day.split('-').map(Number);
          const before = /before|pre|bmo/i.test(x.timing ?? '');
          const ms = nyToUtc(y, mo, d, before ? 8 : 16, before ? 0 : 5);
          if (ms < from || ms >= to) continue;
          out.push({ utc: new Date(ms).toISOString(), title: `${x.symbol} earnings (${before ? 'before the open' : 'after the close'})`, impact: 'high',
            actual: null, forecast: null, previous: null, surprise: null, kind: 'earnings', nq: null });
        }
      } catch { /* earnings list is optional */ }
    }
    // breaking headlines kept by the news collector, kept sparse on the NQ chart: US stories scoring 5+, India / Canada
    // only very big ones (7+, or carried by 3+ outlets); at most one per country per hour (the strongest)
    if (req.query.headlines === '1') {
      for (const h of pickChartHeadlines(await storedHeadlines(from, to, 5)))
        out.push({ utc: h.ts, title: h.title, impact: h.score >= 7 || h.feeds >= 3 ? 'high' : 'medium', actual: null, forecast: null, previous: null,
          surprise: null, kind: 'headline', nq: null, source: h.source, region: h.region, topic: h.topic });
    }
    out.sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc));
    res.json({ events: out, period: t?.period ?? null });
  } catch (e) { fail(res, 'chart', e); }
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
