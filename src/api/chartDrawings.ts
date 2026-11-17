import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { SYMBOLS } from '../bars/store';

const router = Router();
router.use(verifyToken, requireAdmin);

const MAX_DRAWINGS = 1000;
const MAX_DRAWINGS_CHARS = 1_000_000;

function parseSymbol(req: Request, res: Response): string | null {
  const symbol = String(req.query.symbol || 'NQ').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(SYMBOLS, symbol)) {
    res.status(400).json({ error: `Unknown symbol ${symbol}` });
    return null;
  }
  return symbol;
}

// GET /api/chart/drawings?symbol=NQ — the caller's saved drawings for that symbol ([] if none)
router.get('/', async (req: Request, res: Response) => {
  const symbol = parseSymbol(req, res);
  if (!symbol) return;
  try {
    const r = await pool.query('SELECT drawings FROM drawings WHERE user_id = $1 AND symbol = $2', [req.userId, symbol]);
    res.json({ drawings: r.rows[0]?.drawings ?? [] });
  } catch (e: any) {
    console.error('[chart/drawings]', e.message);
    res.status(500).json({ error: 'Failed to load drawings' });
  }
});

// PUT /api/chart/drawings?symbol=NQ — body { drawings: <array> }; items stored as-is (opaque to the server)
router.put('/', async (req: Request, res: Response) => {
  const symbol = parseSymbol(req, res);
  if (!symbol) return;
  try {
    const drawings = req.body?.drawings;
    if (!Array.isArray(drawings)) {
      return res.status(400).json({ error: 'drawings must be an array' });
    }
    if (drawings.length > MAX_DRAWINGS) {
      return res.status(400).json({ error: `too many drawings (max ${MAX_DRAWINGS})` });
    }
    for (let i = 0; i < drawings.length; i++) {
      const d = drawings[i];
      if (d === null || typeof d !== 'object' || Array.isArray(d)) {
        return res.status(400).json({ error: `drawings[${i}] must be an object` });
      }
      if (typeof d.id !== 'string' || d.id.length < 1 || d.id.length > 64) {
        return res.status(400).json({ error: `drawings[${i}].id must be a string of 1-64 characters` });
      }
      if (typeof d.tool !== 'string' || d.tool.length < 1 || d.tool.length > 32) {
        return res.status(400).json({ error: `drawings[${i}].tool must be a string of 1-32 characters` });
      }
    }
    const json = JSON.stringify(drawings);
    if (json.length > MAX_DRAWINGS_CHARS) {
      return res.status(400).json({ error: `drawings too large (max ${MAX_DRAWINGS_CHARS} characters)` });
    }
    await pool.query(
      `INSERT INTO drawings (user_id, symbol, drawings, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, symbol) DO UPDATE SET drawings = EXCLUDED.drawings, updated_at = NOW()`,
      [req.userId, symbol, json]
    );
    res.json({ ok: true, count: drawings.length });
  } catch (e: any) {
    console.error('[chart/drawings]', e.message);
    res.status(500).json({ error: 'Failed to save drawings' });
  }
});

export default router;
