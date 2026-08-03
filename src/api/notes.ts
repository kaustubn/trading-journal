import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// Get a single day's note
router.get('/notes/:date', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const { date } = req.params;
    const r = await pool.query(
      `SELECT *, to_char(note_date, 'YYYY-MM-DD') AS note_date FROM daily_notes
       WHERE user_id = $1 AND note_date = $2`,
      [user_id, date]
    );
    res.json({ data: r.rows[0] || null });
  } catch (error: any) {
    console.error('Get note error:', error);
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// List recent notes (excludes heavy screenshot blob; exposes a flag)
router.get('/notes', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const limit = parseInt(String(req.query.limit || '30'));
    const r = await pool.query(
      `SELECT id, to_char(note_date, 'YYYY-MM-DD') AS note_date, day_type, bias, key_levels,
              setups, plan, review, followed_plan, (screenshot IS NOT NULL) AS has_screenshot
       FROM daily_notes WHERE user_id = $1 ORDER BY note_date DESC LIMIT $2`,
      [user_id, limit]
    );
    res.json({ data: r.rows });
  } catch (error: any) {
    console.error('List notes error:', error);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

// Upsert a day's note
router.put('/notes/:date', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const { date } = req.params;
    const { day_type, bias, key_levels, setups, plan, review, followed_plan, screenshot } = req.body;
    const r = await pool.query(
      `INSERT INTO daily_notes (user_id, note_date, day_type, bias, key_levels, setups, plan, review, followed_plan, screenshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, note_date) DO UPDATE SET
         day_type = EXCLUDED.day_type, bias = EXCLUDED.bias, key_levels = EXCLUDED.key_levels,
         setups = EXCLUDED.setups, plan = EXCLUDED.plan, review = EXCLUDED.review,
         followed_plan = EXCLUDED.followed_plan,
         screenshot = COALESCE(EXCLUDED.screenshot, daily_notes.screenshot), updated_at = NOW()
       RETURNING id, to_char(note_date, 'YYYY-MM-DD') AS note_date`,
      [user_id, date, day_type ?? null, bias ?? null, key_levels ?? null, setups ?? null,
       plan ?? null, review ?? null, followed_plan ?? null, screenshot ?? null]
    );
    res.json({ data: r.rows[0] });
  } catch (error: any) {
    console.error('Save note error:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

export default router;
