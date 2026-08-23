import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

export const OPTION_FIELDS = ['pair', 'setup', 'test_type', 'session', 'timeframe'] as const;
type Field = typeof OPTION_FIELDS[number];

// Seeded once per user, then fully editable — add your own, delete what you don't use.
const DEFAULTS: Record<Field, string[]> = {
  pair: ['NQ', 'MNQ', 'ES', 'XAU/USD', 'EUR/USD', 'Nifty 50', 'GC1 FUT'],
  setup: ['S1', 'S2', 'S3', 'ORB', 'Type 1', 'Type 2'],
  test_type: [
    'Retracement', 'Reversal', 'LTF Reversal', 'HTF Reversal',
    'Continuation', 'LTF Continuation', 'HTF Continuation',
    'Range rejection', 'Prev Structure', '1M Reversal CHOC',
    '3m VWAP rejection', 'Bbn', 'No setup',
  ],
  session: ['Asia', 'London', 'NY AM', 'NY PM'],
  timeframe: ['1m', '2m', '3m', '5m', '15m', '1h'],
};

async function seedIfEmpty(userId: number) {
  const existing = await pool.query('SELECT DISTINCT field FROM journal_options WHERE user_id = $1', [userId]);
  const have = new Set(existing.rows.map((r: any) => r.field));
  for (const field of OPTION_FIELDS) {
    if (have.has(field)) continue;
    const vals = DEFAULTS[field];
    for (let i = 0; i < vals.length; i++) {
      await pool.query(
        `INSERT INTO journal_options (user_id, field, value, sort_order) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, field, value) DO NOTHING`,
        [userId, field, vals[i], i]
      );
    }
  }
}

// GET /api/options → { pair: [...], setup: [...], test_type: [...], ... }
router.get('/options', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId!;
    await seedIfEmpty(user_id);
    const r = await pool.query(
      'SELECT id, field, value FROM journal_options WHERE user_id = $1 ORDER BY field, sort_order, id',
      [user_id]
    );
    const data: Record<string, { id: number; value: string }[]> = {};
    for (const f of OPTION_FIELDS) data[f] = [];
    for (const row of r.rows) {
      (data[row.field] ||= []).push({ id: row.id, value: row.value });
    }
    res.json({ data });
  } catch (error: any) {
    console.error('Options list error:', error);
    res.status(500).json({ error: 'Failed to load options' });
  }
});

// POST /api/options { field, value }
router.post('/options', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId!;
    const field = String(req.body?.field || '');
    const value = String(req.body?.value || '').trim().slice(0, 60);
    if (!OPTION_FIELDS.includes(field as Field)) return res.status(400).json({ error: 'Unknown field' });
    if (!value) return res.status(400).json({ error: 'Value required' });

    const next = await pool.query(
      'SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM journal_options WHERE user_id=$1 AND field=$2',
      [user_id, field]
    );
    const r = await pool.query(
      `INSERT INTO journal_options (user_id, field, value, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, field, value) DO NOTHING RETURNING id, field, value`,
      [user_id, field, value, next.rows[0].n]
    );
    if (r.rows.length === 0) return res.status(409).json({ error: 'Already exists' });
    res.json({ data: r.rows[0] });
  } catch (error: any) {
    console.error('Option add error:', error);
    res.status(500).json({ error: 'Failed to add option' });
  }
});

// DELETE /api/options/:id — removes the choice from the list only; trades keep their value
router.delete('/options/:id', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId!;
    const r = await pool.query('DELETE FROM journal_options WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, user_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Option delete error:', error);
    res.status(500).json({ error: 'Failed to delete option' });
  }
});

export default router;
