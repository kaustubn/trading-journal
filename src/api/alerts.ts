// Telegram alert settings + the scheduler tick: /api/alerts
//   GET  /settings, PUT /settings, POST /test, POST /preview-brief  (signed in)
//   GET  /tick  (public, called by .github/workflows/alerts-tick.yml; idempotent, sends only what is due, once)
import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/crypto';
import { sendTelegram, tickAll, briefText, AlertUser, alertSettingsChanged } from '../services/alertsEngine';

const router = Router();
const fail = (res: Response, where: string, e: unknown) => { console.error(`[alerts] ${where}`, (e as Error).message); res.status(500).json({ error: (e as Error).message || 'Server error' }); };

router.get('/tick', async (_req: Request, res: Response) => {
  try { res.json(await tickAll()); } catch (e) { fail(res, 'tick', e); }
});

router.use(verifyToken);

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
const CHAT_RE = /^-?\d{3,20}$/;

async function settingsOf(userId: number) {
  const r = await pool.query('SELECT * FROM alert_settings WHERE user_id = $1', [userId]);
  return r.rows[0] ?? null;
}
const publicView = (x: any) => x ? {
  enabled: x.enabled, hasToken: !!x.telegram_token, chat: x.telegram_chat, account_id: x.account_id,
  news: x.news, earnings: x.earnings, rules: x.rules, prop: x.prop, brief: x.brief, lead_min: x.lead_min,
} : { enabled: false, hasToken: false, chat: null, account_id: null, news: true, earnings: true, rules: true, prop: true, brief: true, lead_min: 15 };

router.get('/settings', async (req: Request, res: Response) => {
  try { res.json({ settings: publicView(await settingsOf(req.userId!)) }); } catch (e) { fail(res, 'settings', e); }
});

// PUT /settings {token?, chat, enabled, account_id, news, earnings, rules, prop, brief, lead_min}. An empty token keeps the saved one.
router.put('/settings', async (req: Request, res: Response) => {
  const b = req.body || {};
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  const chat = b.chat == null ? null : String(b.chat).trim();
  if (token && !TOKEN_RE.test(token)) return res.status(400).json({ error: 'That does not look like a Telegram bot token (123456789:ABC…).' });
  if (chat && !CHAT_RE.test(chat)) return res.status(400).json({ error: 'The chat id is a number, like 123456789 (or -100… for a group).' });
  const lead = Number(b.lead_min ?? 15);
  if (!(Number.isInteger(lead) && lead >= 5 && lead <= 120)) return res.status(400).json({ error: 'Minutes before a release: 5 to 120.' });
  const acc = b.account_id == null || b.account_id === '' ? null : Number(b.account_id);
  try {
    if (acc != null) {
      const own = await pool.query('SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2', [acc, req.userId]);
      if (!own.rows.length) return res.status(404).json({ error: 'Account not found' });
    }
    const prev = await settingsOf(req.userId!);
    const enc = token ? encrypt(token) : prev?.telegram_token ?? null;
    await pool.query(
      `INSERT INTO alert_settings (user_id, telegram_token, telegram_chat, enabled, account_id, news, earnings, rules, prop, brief, lead_min, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (user_id) DO UPDATE SET telegram_token=$2, telegram_chat=$3, enabled=$4, account_id=$5, news=$6, earnings=$7, rules=$8, prop=$9, brief=$10, lead_min=$11, updated_at=NOW()`,
      [req.userId, enc, chat || null, !!b.enabled && !!enc && !!chat, acc, b.news !== false, b.earnings !== false, b.rules !== false, b.prop !== false, b.brief !== false, lead]);
    alertSettingsChanged();
    res.json({ settings: publicView(await settingsOf(req.userId!)) });
  } catch (e) { fail(res, 'settings put', e); }
});

router.post('/test', async (req: Request, res: Response) => {
  try {
    const s = await settingsOf(req.userId!);
    if (!s?.telegram_token || !s?.telegram_chat) return res.status(400).json({ error: 'Save a bot token and chat id first.' });
    await sendTelegram(String(decrypt(s.telegram_token)), s.telegram_chat, '✅ Test from your trading journal. Alerts will arrive here.');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

// POST /preview-brief — the morning brief as text (also sends it when {send: true})
router.post('/preview-brief', async (req: Request, res: Response) => {
  try {
    const s = await settingsOf(req.userId!);
    const u: AlertUser = { user_id: req.userId!, token: s?.telegram_token ? String(decrypt(s.telegram_token)) : '', chat: s?.telegram_chat ?? '',
      account_id: s?.account_id ?? (req.body?.account_id ? Number(req.body.account_id) : null), news: true, earnings: true, rules: true, prop: true, brief: true, lead_min: 15 };
    if (u.account_id) {
      const own = await pool.query('SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2', [u.account_id, req.userId]);
      if (!own.rows.length) u.account_id = null;
    }
    const text = await briefText(u);
    if (req.body?.send) {
      if (!u.token || !u.chat) return res.status(400).json({ error: 'Save a bot token and chat id first.', text });
      await sendTelegram(u.token, u.chat, text);
    }
    res.json({ text });
  } catch (e) { fail(res, 'preview', e); }
});

export default router;
