// Telegram alerts. The journal runs on a free Render plan that sleeps, so nothing here runs on a timer: an outside
// scheduler (GitHub Actions, .github/workflows/alerts-tick.yml) calls GET /api/alerts/tick every 10 minutes on US
// weekdays. Each tick sends what is due and records it in alert_log, so a message is never sent twice.
//   news   : high-impact USD releases starting within lead_min minutes (+ what NQ usually does)
//   brief  : once per weekday morning (07:30-09:25 New York): today's releases, big-tech earnings, NQ overnight levels,
//            VIX, discipline score
//   rules  : a personal-rule break today (shared/habits checkRules)
//   prop   : prop-account drawdown buffer in danger / breached, or today's loss near the daily limit
import jwt from 'jsonwebtoken';
import pool from '../db';
import { decrypt } from '../utils/crypto';
import { listEvents } from '../news/econEvents';
import { utcToNy } from '../shared/econCalendar';
import { RULE_LABEL } from '../shared/habits';
import { violations, accountToday, score } from './habitsData';
import { earnings, premarket } from './marketData';

export interface AlertUser { user_id: number; token: string; chat: string; account_id: number | null; news: boolean; earnings: boolean; rules: boolean; prop: boolean; brief: boolean; lead_min: number }

export async function sendTelegram(token: string, chat: string, text: string): Promise<void> {
  // TELEGRAM_API_BASE: local tests only (a fake Telegram server); never set on the real server
  const r = await fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Telegram said ${r.status}${body.includes('chat not found') ? ': chat not found (send your bot a message first, then check the chat id)' : body.includes('Unauthorized') ? ': the bot token is wrong' : ''}`);
  }
}

async function once(userId: number, key: string, send: () => Promise<void>): Promise<boolean> {
  const ins = await pool.query('INSERT INTO alert_log (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [userId, key.slice(0, 200)]);
  if (!ins.rows.length) return false;
  try { await send(); return true; } catch (e) { await pool.query('DELETE FROM alert_log WHERE user_id = $1 AND key = $2', [userId, key.slice(0, 200)]); throw e; }
}

const fmt = (n: number | null | undefined, d = 2) => (n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (n: number | null | undefined, d = 2) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${fmt(n, d)}`);

export async function loadUsers(): Promise<AlertUser[]> {
  const r = await pool.query(`SELECT * FROM alert_settings WHERE enabled = true AND telegram_token IS NOT NULL AND telegram_chat IS NOT NULL`);
  return r.rows.map(x => ({ user_id: x.user_id, token: String(decrypt(x.telegram_token) ?? ''), chat: x.telegram_chat, account_id: x.account_id,
    news: x.news, earnings: x.earnings, rules: x.rules, prop: x.prop, brief: x.brief, lead_min: Number(x.lead_min) || 15 }));
}

async function propStatus(userId: number, accountId: number): Promise<any> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const t = jwt.sign({ userId }, secret, { algorithm: 'HS256', expiresIn: '2m' });
  const r = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/accounts/${accountId}/prop-status`, { headers: { Authorization: `Bearer ${t}` } });
  return r.ok ? ((await r.json()) as any)?.data ?? null : null;
}

export async function briefText(u: AlertUser, now = Date.now()): Promise<string> {
  const ny = utcToNy(now);
  const lines: string[] = [`☀️ Morning brief, ${ny.date}`];
  try {
    const pm: any = await premarket();
    const p = pm.data;
    const q = (s: string) => p.quotes.find((x: any) => x.sym === s);
    const nq = q('NQ=F'), vix = q('^VIX'), es = q('ES=F');
    if (nq?.last != null) lines.push(`NQ ${fmt(nq.last)} (${sgn(nq.chg)} pts, ${sgn(nq.chgPct)}%)  ES ${sgn(es?.chgPct)}%  VIX ${fmt(vix?.last)}`);
    if (p.nq?.rthClose != null) lines.push(`Yesterday NY session: H ${fmt(p.nq.rthHigh)}  L ${fmt(p.nq.rthLow)}  C ${fmt(p.nq.rthClose)}. Overnight: H ${fmt(p.nq.onHigh)}  L ${fmt(p.nq.onLow)}  gap ${sgn(p.nq.gap)} pts`);
  } catch { lines.push('(market snapshot unavailable)'); }
  const dayStart = Date.parse(`${ny.date}T00:00:00Z`) - 12 * 3600000;
  const evs = (await listEvents(dayStart, dayStart + 48 * 3600000, ['high'])).filter(e => e.ny_date === ny.date);
  if (evs.length) {
    lines.push('', '📅 High-impact today (New York time):');
    for (const e of evs) lines.push(`${e.ny_time}  ${e.title}${e.forecast ? `  f ${e.forecast}` : ''}${e.previous ? `  p ${e.previous}` : ''}${e.nq ? `  · NQ median ${e.nq.absMed15.toFixed(0)} pts in 15 min` : ''}`);
  } else lines.push('', '📅 No high-impact US releases today (in your imported calendar).');
  if (u.earnings) {
    try {
      const er = await earnings();
      const next = er.events.filter((e: any) => e.day >= ny.date).slice(0, 4);
      if (next.length) lines.push('', '💼 Big-tech earnings: ' + next.map((e: any) => `${e.symbol} ${e.day === ny.date ? 'TODAY' : e.day.slice(5)} (${e.timing ?? '?'})`).join(', '));
    } catch { /* optional */ }
  }
  if (u.account_id) {
    try {
      const s = await score(u.user_id, u.account_id);
      lines.push('', `🎯 Discipline ${s.score ?? '–'}/100 · level ${s.level.name} · rule-free streak ${s.streaks.ruleFree} days · plan streak ${s.streaks.plan}`);
    } catch { /* optional */ }
  }
  return lines.join('\n');
}

/** Everything due for one user now. Returns the keys that were sent. */
export async function tickUser(u: AlertUser, now = Date.now()): Promise<string[]> {
  const sent: string[] = [];
  const send = (text: string) => () => sendTelegram(u.token, u.chat, text);
  const ny = utcToNy(now);
  const weekday = ![0, 6].includes(new Date(`${ny.date}T12:00:00Z`).getUTCDay());

  if (u.news) {
    const soon = (await listEvents(now, now + u.lead_min * 60000, ['high'])).filter(e => e.currency === 'USD');
    const byTime = new Map<string, typeof soon>();
    for (const e of soon) byTime.set(e.release_utc, [...(byTime.get(e.release_utc) ?? []), e]);
    for (const [utc, list] of byTime) {
      const mins = Math.max(0, Math.round((Date.parse(utc) - now) / 60000));
      const text = [`⏰ In ${mins} min (${list[0].ny_time} New York): ${list.map(e => e.title).join(', ')}`,
        ...list.filter(e => e.forecast || e.previous).map(e => `${e.title}: forecast ${e.forecast ?? '–'}, previous ${e.previous ?? '–'}`),
        list.find(e => e.nq)?.nq?.line ?? '', 'Check your news blackout and open orders.'].filter(Boolean).join('\n');
      if (await once(u.user_id, `news:${utc}`, send(text))) sent.push(`news:${utc}`);
    }
  }
  if (u.brief && weekday && ny.time >= '07:30' && ny.time <= '09:25') {
    const text = await briefText(u, now);
    if (await once(u.user_id, `brief:${ny.date}`, send(text))) sent.push(`brief:${ny.date}`);
  }
  if (u.account_id && u.rules) {
    const today = await accountToday(u.account_id);
    const v = (await violations(u.account_id, 1)).list.filter(x => x.day === today);
    for (const x of v) {
      const key = `rule:${u.account_id}:${today}:${x.rule}`;
      if (await once(u.user_id, key, send(`🚫 Rule break: ${RULE_LABEL[x.rule]} — ${x.detail}. Stop and review before the next trade.`))) sent.push(key);
    }
  }
  if (u.account_id && u.prop && weekday) {
    const p = await propStatus(u.user_id, u.account_id).catch(() => null);
    if (p?.configured !== false && p) {
      const today = await accountToday(u.account_id);
      if (p.bufferLevel === 'danger' || p.bufferLevel === 'breached') {
        const key = `prop:${u.account_id}:${today}:${p.bufferLevel}`;
        const msg = p.bufferLevel === 'breached' ? '🛑 Prop drawdown limit BREACHED on your account. No more trades on it today.'
          : `⚠️ Prop drawdown: only $${fmt(p.drawdownHeadroom, 0)} left before the limit (under 25% of the max drawdown). Size down or stop.`;
        if (await once(u.user_id, key, send(msg))) sent.push(key);
      }
      if (p.dailyHeadroom != null && p.dailyLossLimit && p.dailyHeadroom < 0.25 * Number(p.dailyLossLimit)) {
        const key = `propday:${u.account_id}:${today}`;
        if (await once(u.user_id, key, send(`⚠️ Daily loss limit: $${fmt(p.dailyHeadroom, 0)} left today. Consider stopping for the day.`))) sent.push(key);
      }
    }
  }
  return sent;
}

let lastRun = 0;
// When nobody has alerts on, don't wake the database (Neon free plan compute) more than once an hour.
let noUsersUntil = 0;
export function alertSettingsChanged() { noUsersUntil = 0; }
export async function tickAll(now = Date.now()): Promise<{ users: number; sent: number; errors: string[]; skipped?: string }> {
  if (now - lastRun < 60000) return { users: 0, sent: 0, errors: [], skipped: 'ran less than a minute ago' };
  if (now < noUsersUntil) return { users: 0, sent: 0, errors: [], skipped: 'no alert users (checked within the hour)' };
  lastRun = now;
  const users = await loadUsers();
  if (!users.length) { noUsersUntil = now + 3600000; return { users: 0, sent: 0, errors: [] }; }
  let sent = 0; const errors: string[] = [];
  for (const u of users) {
    try { sent += (await tickUser(u, now)).length; } catch (e) { errors.push(`user ${u.user_id}: ${(e as Error).message}`); }
  }
  // keep the log small
  await pool.query(`DELETE FROM alert_log WHERE sent_at < NOW() - interval '30 days'`);
  return { users: users.length, sent, errors };
}
