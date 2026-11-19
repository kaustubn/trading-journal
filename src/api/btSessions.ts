// Backtest Session Tracker API: practice time on Market Chart replay and S1 Practice.
// Mounted at /api/bt-sessions. Timing rules live in services/btSessionClock.ts.
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken, userIdFromToken } from '../middleware/auth';
import { acceptBeat, lockState, LOCK_SEC, STALE_SEC, rescaleMinutes, Status } from '../services/btSessionClock';

const router = Router();

const TAB_RE = /^[A-Za-z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: Status[] = ['running', 'paused', 'idle'];
const PAGES = ['marketchart', 's1practice'];
const TAGS = ['trend', 'range', 'news'];
const COLS = `id, page, started_at, ended_at, status, active_sec, idle_sec, pause_sec, setup_tag, instrument, timeframe,
  to_char(hist_from, 'YYYY-MM-DD') AS hist_from, to_char(hist_to, 'YYYY-MM-DD') AS hist_to, trades_logged, last_seq,
  last_beat_at, lock_tab, lock_until, edited, note`;

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fail = (res: Response, where: string, e: unknown) => { console.error(`[bt-sessions] ${where}`, (e as Error).message); res.status(500).json({ error: 'Server error' }); };

function safeTz(tz: unknown): string {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

/** Close sessions nobody has heard from for 30 min: they end at their last heartbeat. */
async function closeStale(userId: number) {
  await pool.query(
    `UPDATE bt_sessions SET status = 'stopped', ended_at = last_beat_at, lock_tab = NULL, lock_until = NULL
     WHERE user_id = $1 AND status <> 'stopped' AND last_beat_at < NOW() - make_interval(secs => $2)`, [userId, STALE_SEC]);
}

/** Apply one heartbeat inside a transaction. Returns the session row or an error code. */
async function applyBeat(userId: number, id: number, body: any): Promise<{ status: number; body: any }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT ${COLS} FROM bt_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Session not found' } }; }
    const s = r.rows[0];
    const now = new Date((await client.query('SELECT NOW() AS n')).rows[0].n);
    const beat = { tabId: String(body?.tabId ?? ''), seq: Number(body?.seq), activeSec: body?.activeSec, idleSec: body?.idleSec, pauseSec: body?.pauseSec };
    const res = acceptBeat({ status: s.status, last_seq: s.last_seq, last_beat_at: new Date(s.last_beat_at), lock_tab: s.lock_tab, lock_until: s.lock_until ? new Date(s.lock_until) : null }, beat, now);
    if (!res.ok) {
      await client.query('ROLLBACK');
      const code = res.reason === 'locked' ? 409 : res.reason === 'stopped' ? 410 : res.reason === 'duplicate' ? 200 : 400;
      return { status: code, body: { error: res.reason, session: s } };
    }
    const status: Status = STATUSES.includes(body?.status) ? body.status : 'running';
    const from = typeof body?.replayFrom === 'string' && DATE_RE.test(body.replayFrom) ? body.replayFrom : null;
    const to = typeof body?.replayTo === 'string' && DATE_RE.test(body.replayTo) ? body.replayTo : from;
    const u = await client.query(
      `UPDATE bt_sessions SET active_sec = active_sec + $3, idle_sec = idle_sec + $4, pause_sec = pause_sec + $5,
         last_seq = $6, last_beat_at = $7, lock_tab = $8, lock_until = $7::timestamptz + make_interval(secs => $9), status = $10,
         hist_from = CASE WHEN $11::date IS NULL THEN hist_from ELSE LEAST(COALESCE(hist_from, $11::date), $11::date) END,
         hist_to   = CASE WHEN $12::date IS NULL THEN hist_to   ELSE GREATEST(COALESCE(hist_to, $12::date), $12::date) END,
         setup_tag = COALESCE($13, setup_tag), instrument = COALESCE($14, instrument), timeframe = COALESCE($15, timeframe)
       WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
      [id, userId, res.add.active, res.add.idle, res.add.pause, beat.seq, now.toISOString(), beat.tabId, LOCK_SEC, status,
        from, to, str(body?.setupTag, 100), str(body?.instrument, 20), str(body?.timeframe, 10)]);
    for (const m of res.minutes) {
      await client.query(
        `INSERT INTO bt_session_minutes (session_id, minute_utc, active_sec) VALUES ($1, $2, $3)
         ON CONFLICT (session_id, minute_utc) DO UPDATE SET active_sec = bt_session_minutes.active_sec + EXCLUDED.active_sec`,
        [id, new Date(m.minute).toISOString(), m.sec]);
    }
    if (from && to) {
      await client.query(
        `INSERT INTO bt_session_days (session_id, hist_date)
         SELECT $1, d::date FROM generate_series($2::date, LEAST($3::date, $2::date + 31), interval '1 day') d
         ON CONFLICT DO NOTHING`, [id, from, to]);
    }
    await client.query('COMMIT');
    return { status: 200, body: { session: u.rows[0], added: res.add } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// POST /api/bt-sessions/beacon — final save from navigator.sendBeacon (tab hidden/closed). Token travels in the body.
router.post('/beacon', async (req: Request, res: Response) => {
  const userId = userIdFromToken(req.body?.token);
  const id = Number(req.body?.sessionId);
  if (!userId || !Number.isInteger(id)) return res.status(401).end();
  try {
    const r = await applyBeat(userId, id, req.body);
    res.status(r.status === 200 ? 204 : r.status).end();
  } catch (e) { fail(res, 'beacon', e); }
});

router.use(verifyToken);

// POST /api/bt-sessions/start {tabId, page, instrument?, timeframe?, setupTag?}
// Resumes the user's open session when no other tab holds it; otherwise reports the conflict.
router.post('/start', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const tabId = String(req.body?.tabId ?? '');
  const page = PAGES.includes(req.body?.page) ? req.body.page : 'marketchart';
  if (!TAB_RE.test(tabId)) return res.status(400).json({ error: 'tabId must be 8-64 letters, digits or hyphens' });
  try {
    await closeStale(userId);
    const open = await pool.query(`SELECT ${COLS} FROM bt_sessions WHERE user_id = $1 AND status <> 'stopped' ORDER BY started_at DESC LIMIT 1`, [userId]);
    const now = new Date((await pool.query('SELECT NOW() AS n')).rows[0].n);
    if (open.rows.length) {
      const s = open.rows[0];
      if (lockState({ lock_tab: s.lock_tab, lock_until: s.lock_until ? new Date(s.lock_until) : null }, tabId, now) === 'other') {
        return res.status(409).json({ conflict: true, session: s });
      }
      const u = await pool.query(
        `UPDATE bt_sessions SET lock_tab = $3, lock_until = NOW() + make_interval(secs => $4), status = 'running', last_beat_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`, [s.id, userId, tabId, LOCK_SEC]);
      return res.json({ session: u.rows[0], resumed: true });
    }
    const c = await pool.query(
      `INSERT INTO bt_sessions (user_id, page, instrument, timeframe, setup_tag, lock_tab, lock_until)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(secs => $7)) RETURNING ${COLS}`,
      [userId, page, str(req.body?.instrument, 20) ?? 'NQ', str(req.body?.timeframe, 10), str(req.body?.setupTag, 100), tabId, LOCK_SEC]);
    res.status(201).json({ session: c.rows[0], resumed: false });
  } catch (e) { fail(res, 'start', e); }
});

// POST /api/bt-sessions/:id/beat {tabId, seq, activeSec, idleSec, pauseSec, status, replayFrom?, replayTo?, setupTag?, ...}
router.post('/:id/beat', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const r = await applyBeat(req.userId!, id, req.body);
    res.status(r.status).json(r.body);
  } catch (e) { fail(res, 'beat', e); }
});

// POST /api/bt-sessions/:id/takeover {tabId} — this tab becomes the timer (the other tab goes read-only)
router.post('/:id/takeover', async (req: Request, res: Response) => {
  const id = Number(req.params.id), tabId = String(req.body?.tabId ?? '');
  if (!Number.isInteger(id) || !TAB_RE.test(tabId)) return res.status(400).json({ error: 'bad request' });
  try {
    const u = await pool.query(
      `UPDATE bt_sessions SET lock_tab = $3, lock_until = NOW() + make_interval(secs => $4), last_beat_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status <> 'stopped' RETURNING ${COLS}`, [id, req.userId, tabId, LOCK_SEC]);
    if (!u.rows.length) return res.status(404).json({ error: 'Session not found or already stopped' });
    res.json({ session: u.rows[0] });
  } catch (e) { fail(res, 'takeover', e); }
});

// POST /api/bt-sessions/:id/stop {tabId, ...final deltas} — saves the last deltas, then ends the session
router.post('/:id/stop', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  try {
    if (Number.isInteger(req.body?.seq)) await applyBeat(req.userId!, id, req.body);
    const u = await pool.query(
      `UPDATE bt_sessions SET status = 'stopped', ended_at = NOW(), lock_tab = NULL, lock_until = NULL
       WHERE id = $1 AND user_id = $2 AND status <> 'stopped' RETURNING ${COLS}`, [id, req.userId]);
    if (!u.rows.length) return res.status(404).json({ error: 'Session not found or already stopped' });
    res.json({ session: u.rows[0] });
  } catch (e) { fail(res, 'stop', e); }
});

// PATCH /api/bt-sessions/:id — manual correction (marks the session as edited)
router.patch('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id), b = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const nonNeg = (v: unknown) => v === undefined ? undefined : (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 86400 * 2 ? v as number : NaN);
  const active = nonNeg(b.active_sec), idle = nonNeg(b.idle_sec), pause = nonNeg(b.pause_sec);
  if ([active, idle, pause].some(v => Number.isNaN(v))) return res.status(400).json({ error: 'times must be whole seconds from 0 to 172800' });
  const started = b.started_at === undefined ? undefined : new Date(b.started_at);
  const ended = b.ended_at === undefined || b.ended_at === null ? b.ended_at : new Date(b.ended_at);
  if (started && Number.isNaN(started.getTime())) return res.status(400).json({ error: 'started_at is not a valid time' });
  if (ended && Number.isNaN((ended as Date).getTime())) return res.status(400).json({ error: 'ended_at is not a valid time' });
  if (started && ended && (ended as Date) <= started) return res.status(400).json({ error: 'ended_at must be after started_at' });
  for (const k of ['hist_from', 'hist_to']) if (b[k] != null && !(typeof b[k] === 'string' && DATE_RE.test(b[k]))) return res.status(400).json({ error: `${k} must be YYYY-MM-DD` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT ${COLS} FROM bt_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, req.userId]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found' }); }
    const u = await client.query(
      `UPDATE bt_sessions SET
         started_at = COALESCE($3, started_at), ended_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE ended_at END,
         active_sec = COALESCE($6, active_sec), idle_sec = COALESCE($7, idle_sec), pause_sec = COALESCE($8, pause_sec),
         setup_tag = CASE WHEN $9::boolean THEN $10 ELSE setup_tag END, instrument = COALESCE($11, instrument),
         timeframe = COALESCE($12, timeframe), hist_from = COALESCE($13::date, hist_from), hist_to = COALESCE($14::date, hist_to),
         note = CASE WHEN $15::boolean THEN $16 ELSE note END, edited = true
       WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
      [id, req.userId, started ? started.toISOString() : null, ended !== undefined, ended ? (ended as Date).toISOString() : null,
        active ?? null, idle ?? null, pause ?? null, b.setup_tag !== undefined, str(b.setup_tag, 100), str(b.instrument, 20),
        str(b.timeframe, 10), b.hist_from ?? null, b.hist_to ?? null, b.note !== undefined, str(b.note, 2000)]);
    if (active !== undefined && active !== cur.rows[0].active_sec) {
      const mins = await client.query(`SELECT extract(epoch FROM minute_utc) * 1000 AS minute, active_sec AS sec FROM bt_session_minutes WHERE session_id = $1 ORDER BY minute_utc`, [id]);
      let next = rescaleMinutes(mins.rows.map(m => ({ minute: Number(m.minute), sec: Number(m.sec) })), active);
      if (!next.length && active > 0) {
        // no buckets yet (e.g. a session added by hand): put the time at the start of the session
        const start = new Date(u.rows[0].started_at).getTime();
        next = []; let left = active, t = Math.floor(start / 60000) * 60000;
        while (left > 0) { const take = Math.min(60, left); next.push({ minute: t, sec: take }); left -= take; t += 60000; }
      }
      await client.query('DELETE FROM bt_session_minutes WHERE session_id = $1', [id]);
      for (const m of next) await client.query('INSERT INTO bt_session_minutes (session_id, minute_utc, active_sec) VALUES ($1, $2, $3)', [id, new Date(m.minute).toISOString(), m.sec]);
    }
    await client.query('COMMIT');
    res.json({ session: u.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, 'edit', e);
  } finally { client.release(); }
});

// DELETE /api/bt-sessions/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const r = await pool.query('DELETE FROM bt_sessions WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json({ deleted: id });
  } catch (e) { fail(res, 'delete', e); }
});

// GET /api/bt-sessions/stats?tz=America/Vancouver — everything the Practice log dashboard needs
router.get('/stats', async (req: Request, res: Response) => {
  const userId = req.userId!, tz = safeTz(req.query.tz);
  try {
    await closeStale(userId);
    const [daily, sessions, samples, targets, coverage] = await Promise.all([
      pool.query(
        `SELECT to_char((m.minute_utc AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d, SUM(m.active_sec)::int AS sec
         FROM bt_session_minutes m JOIN bt_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 GROUP BY 1 ORDER BY 1`, [userId, tz]),
      pool.query(`SELECT ${COLS} FROM bt_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 5000`, [userId]),
      pool.query(
        `SELECT COALESCE(NULLIF(t.setup_tag, ''), '(no setup)') AS setup, COUNT(*)::int AS n
         FROM trades t JOIN accounts a ON a.id = t.account_id LEFT JOIN account_attempts at ON at.id = t.attempt_id
         WHERE a.user_id = $1 AND (t.bt_session_id IS NOT NULL OR at.label = 'Bar replay')
         GROUP BY 1 ORDER BY 2 DESC`, [userId]),
      pool.query('SELECT setup_tag, target FROM bt_setup_targets WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT to_char(x.hist_date, 'YYYY-MM-DD') AS date, MAX(x.sessions)::int AS sessions, MAX(ct.tag) AS tag FROM (
           SELECT d.hist_date, COUNT(DISTINCT d.session_id) AS sessions
           FROM bt_session_days d JOIN bt_sessions s ON s.id = d.session_id WHERE s.user_id = $1 GROUP BY d.hist_date
           UNION ALL SELECT hist_date, 0 FROM bt_coverage_tags WHERE user_id = $1
         ) x LEFT JOIN bt_coverage_tags ct ON ct.user_id = $1 AND ct.hist_date = x.hist_date
         GROUP BY x.hist_date ORDER BY x.hist_date`, [userId]),
    ]);
    res.json({ tz, daily: daily.rows, sessions: sessions.rows, samples: samples.rows, targets: targets.rows, coverage: coverage.rows });
  } catch (e) { fail(res, 'stats', e); }
});

// PUT /api/bt-sessions/coverage/:date {tag: 'trend'|'range'|'news'|null}
router.put('/coverage/:date', async (req: Request, res: Response) => {
  const date = String(req.params.date), tag = req.body?.tag ?? null;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (tag !== null && !TAGS.includes(tag)) return res.status(400).json({ error: "tag must be 'trend', 'range', 'news' or null" });
  try {
    if (tag === null) await pool.query('DELETE FROM bt_coverage_tags WHERE user_id = $1 AND hist_date = $2', [req.userId, date]);
    else await pool.query(
      `INSERT INTO bt_coverage_tags (user_id, hist_date, tag) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, hist_date) DO UPDATE SET tag = EXCLUDED.tag`, [req.userId, date, tag]);
    res.json({ date, tag });
  } catch (e) { fail(res, 'coverage', e); }
});

// PUT /api/bt-sessions/targets {setup_tag, target}
router.put('/targets', async (req: Request, res: Response) => {
  const setup = str(req.body?.setup_tag, 100), target = Number(req.body?.target);
  if (!setup || !Number.isInteger(target) || target < 1 || target > 100000) return res.status(400).json({ error: 'setup_tag and a target from 1 to 100000 are required' });
  try {
    await pool.query(
      `INSERT INTO bt_setup_targets (user_id, setup_tag, target) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, setup_tag) DO UPDATE SET target = EXCLUDED.target`, [req.userId, setup, target]);
    res.json({ setup_tag: setup, target });
  } catch (e) { fail(res, 'targets', e); }
});

export default router;
