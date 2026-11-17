import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(verifyToken, requireAdmin);

const MAX_SETTINGS_CHARS = 100_000;

// GET /api/chart/settings — the caller's saved chart settings ({} if none saved yet)
router.get('/', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT settings FROM chart_settings WHERE user_id = $1', [req.userId]);
    res.json({ settings: r.rows[0]?.settings ?? {} });
  } catch (e: any) {
    console.error('[chart/settings]', e.message);
    res.status(500).json({ error: 'Failed to load chart settings' });
  }
});

// PUT /api/chart/settings — body { settings: <object> }; stored as-is (opaque to the server)
router.put('/', async (req: Request, res: Response) => {
  try {
    const settings = req.body?.settings;
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings must be a JSON object' });
    }
    const json = JSON.stringify(settings);
    if (json.length > MAX_SETTINGS_CHARS) {
      return res.status(400).json({ error: `settings too large (max ${MAX_SETTINGS_CHARS} characters)` });
    }
    await pool.query(
      `INSERT INTO chart_settings (user_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
      [req.userId, json]
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[chart/settings]', e.message);
    res.status(500).json({ error: 'Failed to save chart settings' });
  }
});

export default router;
