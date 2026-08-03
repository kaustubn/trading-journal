import { Router, Request, Response } from 'express';
import pool from '../db';
import { requirePro } from '../middleware/plan';

const router = Router();

// Canonical emotion tags with polarity. Frontend chips write these into trades.tags.
export const EMOTIONS = [
  { key: 'revenge', label: 'Revenge', neg: true },
  { key: 'fomo', label: 'FOMO', neg: true },
  { key: 'chased', label: 'Chased entry', neg: true },
  { key: 'panic', label: 'Panic exit', neg: true },
  { key: 'tilt', label: 'Tilt', neg: true },
  { key: 'bored', label: 'Boredom', neg: true },
  { key: 'greedy', label: 'Greedy', neg: true },
  { key: 'hesitated', label: 'Hesitated', neg: true },
  { key: 'no-plan', label: 'No plan', neg: true },
  { key: 'moved-stop', label: 'Moved stop', neg: true },
  { key: 'disciplined', label: 'Disciplined', neg: false },
  { key: 'patient', label: 'Patient', neg: false },
  { key: 'planned', label: 'Planned', neg: false },
];
const EMAP = new Map(EMOTIONS.map(e => [e.key, e]));
const norm = (s: string) => String(s).trim().toLowerCase().replace(/\s+/g, '-');

router.get('/emotions/:account_id', requirePro('Emotions analytics'), async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(String(req.params.account_id));
    const user_id = req.userId;
    const { attempt } = req.query;

    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    const params: any[] = [account_id];
    let f = '';
    if (attempt) { params.push(attempt); f = ` AND attempt_id = $${params.length}`; }
    const tr = await pool.query(
      `SELECT tags, pnl FROM trades WHERE account_id = $1 AND pnl IS NOT NULL${f}`, params);

    const agg: Record<string, { key: string; label: string; neg: boolean; trades: number; wins: number; net: number }> = {};
    let negTradeCount = 0, negNet = 0, posTradeCount = 0, posNet = 0, tagged = 0, total = 0;

    for (const row of tr.rows) {
      total++;
      const pnl = Number(row.pnl);
      const tags: string[] = Array.isArray(row.tags) ? row.tags.map(norm) : [];
      const matched = tags.filter(t => EMAP.has(t));
      if (matched.length) tagged++;
      let hasNeg = false, hasPos = false;
      for (const t of matched) {
        const meta = EMAP.get(t)!;
        const a = (agg[t] ||= { key: t, label: meta.label, neg: meta.neg, trades: 0, wins: 0, net: 0 });
        a.trades++; a.net += pnl; if (pnl > 0) a.wins++;
        if (meta.neg) hasNeg = true; else hasPos = true;
      }
      if (hasNeg) { negTradeCount++; negNet += pnl; }
      if (hasPos) { posTradeCount++; posNet += pnl; }
    }

    const rows = Object.values(agg).map(a => ({
      ...a,
      net: Number(a.net.toFixed(2)),
      winRate: a.trades ? Math.round((a.wins / a.trades) * 100) : 0,
      avg: a.trades ? Number((a.net / a.trades).toFixed(2)) : 0,
    })).sort((a, b) => a.net - b.net); // worst first

    res.json({
      data: {
        rows,
        summary: {
          total, tagged, untagged: total - tagged,
          negTradeCount, negNet: Number(negNet.toFixed(2)),
          posTradeCount, posNet: Number(posNet.toFixed(2)),
        },
        emotions: EMOTIONS,
      },
    });
  } catch (error: any) {
    console.error('Emotions error:', error);
    res.status(500).json({ error: 'Failed to compute emotions' });
  }
});

export default router;
