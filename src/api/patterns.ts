// Time & day pattern finder API (see src/patterns/timeScan.ts). Owner only: uses the chart's exchange data.
import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { scan, cellDays, DIR_RULES, DirRule, ScanParams } from '../patterns/timeScan';

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

export default router;
