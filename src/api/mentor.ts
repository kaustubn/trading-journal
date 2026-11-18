import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(verifyToken, requireAdmin);

const ID_RE = /^[a-z0-9-]{1,64}$/;
const KINDS = ['book', 'video', 'builtin'];
const MAX_COURSE_CHARS = 2_000_000;
const MAX_PROGRESS_CHARS = 300_000;
const MAX_ITEMS = 200;
const MAX_TEXT = 200;

/** Validate a course document for course id `id`. Returns an error message, or null when valid. */
export function validateCourse(id: string, course: any): string | null {
  if (typeof id !== 'string' || !ID_RE.test(id)) return 'course id must match [a-z0-9-] and be 1-64 characters';
  if (course === null || typeof course !== 'object' || Array.isArray(course)) return 'course must be a JSON object';
  if (course.id !== id) return 'course.id must equal the course id in the URL';
  if (course.version !== 1) return 'course.version must be 1';
  for (const k of ['title', 'mentor']) {
    const v = course[k];
    if (typeof v !== 'string' || !v.trim()) return `course.${k} must be a non-empty string`;
    if (v.length > MAX_TEXT) return `course.${k} too long (max ${MAX_TEXT} characters)`;
  }
  if (!KINDS.includes(course.kind)) return `course.kind must be one of ${KINDS.join(', ')}`;
  if (!Array.isArray(course.chapters)) return 'course.chapters must be an array';
  if (course.chapters.length > MAX_ITEMS) return `course.chapters too long (max ${MAX_ITEMS})`;
  if (!Array.isArray(course.strategies)) return 'course.strategies must be an array';
  if (course.strategies.length > MAX_ITEMS) return `course.strategies too long (max ${MAX_ITEMS})`;
  for (let i = 0; i < course.strategies.length; i++) {
    const s = course.strategies[i];
    if (s === null || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || typeof s.name !== 'string' || !s.name) {
      return `course.strategies[${i}] must have string id and name`;
    }
  }
  if (JSON.stringify(course).length > MAX_COURSE_CHARS) return `course too large (max ${MAX_COURSE_CHARS} characters)`;
  return null;
}

// GET /api/mentor/courses — the caller's courses (summaries only)
router.get('/courses', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT id,
              data->>'title' AS title,
              data->>'mentor' AS mentor,
              data->>'kind' AS kind,
              COALESCE(data->>'description', '') AS description,
              CASE WHEN jsonb_typeof(data->'chapters') = 'array' THEN jsonb_array_length(data->'chapters') ELSE 0 END AS chapters,
              CASE WHEN jsonb_typeof(data->'strategies') = 'array' THEN jsonb_array_length(data->'strategies') ELSE 0 END AS strategies,
              updated_at
         FROM mentor_courses WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.userId]
    );
    res.json({ courses: r.rows });
  } catch (e: any) {
    console.error('[mentor]', e.message);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// GET /api/mentor/courses/:id — one full course
router.get('/courses/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid course id' });
    const r = await pool.query('SELECT data FROM mentor_courses WHERE user_id = $1 AND id = $2', [req.userId, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Course not found' });
    res.json({ course: r.rows[0].data });
  } catch (e: any) {
    console.error('[mentor]', e.message);
    res.status(500).json({ error: 'Failed to load course' });
  }
});

// PUT /api/mentor/courses/:id — body { course }; upsert
router.put('/courses/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const course = req.body?.course;
    const err = validateCourse(id, course);
    if (err) return res.status(400).json({ error: err });
    await pool.query(
      `INSERT INTO mentor_courses (user_id, id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [req.userId, id, JSON.stringify(course)]
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[mentor]', e.message);
    res.status(500).json({ error: 'Failed to save course' });
  }
});

// DELETE /api/mentor/courses/:id
router.delete('/courses/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid course id' });
    const r = await pool.query('DELETE FROM mentor_courses WHERE user_id = $1 AND id = $2', [req.userId, id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Course not found' });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[mentor]', e.message);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// GET /api/mentor/progress — the caller's practice progress ({} if none yet)
router.get('/progress', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT data FROM mentor_progress WHERE user_id = $1', [req.userId]);
    res.json({ progress: r.rows[0]?.data ?? {} });
  } catch (e: any) {
    console.error('[mentor]', e.message);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// PUT /api/mentor/progress — body { progress: <object> }; stored as-is
router.put('/progress', async (req: Request, res: Response) => {
  try {
    const progress = req.body?.progress;
    if (progress === null || typeof progress !== 'object' || Array.isArray(progress)) {
      return res.status(400).json({ error: 'progress must be a JSON object' });
    }
    const json = JSON.stringify(progress);
    if (json.length > MAX_PROGRESS_CHARS) {
      return res.status(400).json({ error: `progress too large (max ${MAX_PROGRESS_CHARS} characters)` });
    }
    await pool.query(
      `INSERT INTO mentor_progress (user_id, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [req.userId, json]
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[mentor]', e.message);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

export default router;
