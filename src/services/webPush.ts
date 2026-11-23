// App notifications (Web Push): the phone / desktop shows them even when the journal is closed.
// The server's VAPID key pair is made once on first use and kept in app_kv (private key encrypted with
// ENCRYPTION_KEY), so nobody has to create or paste a key. Each browser that turns notifications on stores one row
// in push_subs; a subscription the push service reports as gone (404 / 410) is deleted.
import webpush from 'web-push';
import pool from '../db';
import { encrypt, decrypt } from '../utils/crypto';

let vapid: { publicKey: string; privateKey: string } | null = null;
async function keys() {
  if (vapid) return vapid;
  const r = await pool.query(`SELECT value FROM app_kv WHERE key = 'vapid'`);
  if (r.rows[0]) {
    const v = JSON.parse(r.rows[0].value);
    vapid = { publicKey: v.publicKey, privateKey: String(decrypt(v.privateKey)) };
  } else {
    const k = webpush.generateVAPIDKeys();
    await pool.query(`INSERT INTO app_kv (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify({ publicKey: k.publicKey, privateKey: encrypt(k.privateKey) })]);
    vapid = null;
    return keys();                         // read back: another instance may have won the insert
  }
  webpush.setVapidDetails('mailto:alerts@trading-journal.invalid', vapid.publicKey, vapid.privateKey);
  return vapid;
}

export async function publicKey(): Promise<string> { return (await keys()).publicKey; }

const ENDPOINT_RE = /^https:\/\/[a-z0-9.-]+(:\d+)?\//i;
export async function subscribe(userId: number, sub: any, label: string): Promise<void> {
  const endpoint = String(sub?.endpoint ?? ''), p256dh = String(sub?.keys?.p256dh ?? ''), auth = String(sub?.keys?.auth ?? '');
  if (!ENDPOINT_RE.test(endpoint) || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,60}$/.test(auth))
    throw Object.assign(new Error('Not a push subscription'), { status: 400 });
  await pool.query(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, label) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, label = $5`, [userId, endpoint, p256dh, auth, label.slice(0, 80)]);
}
export async function unsubscribe(userId: number, endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subs WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}
export async function devices(userId: number): Promise<{ endpoint: string; label: string; created_at: string }[]> {
  const r = await pool.query('SELECT endpoint, label, created_at FROM push_subs WHERE user_id = $1 ORDER BY created_at', [userId]);
  return r.rows;
}

export interface PushMsg { title: string; body: string; url?: string; tag?: string }
/** Sends to every device of the user. Returns how many got it. Throws only when every device failed. */
export async function pushUser(userId: number, msg: PushMsg): Promise<number> {
  await keys();
  const r = await pool.query('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = $1', [userId]);
  let ok = 0; const errs: string[] = [];
  const payload = JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 900), url: msg.url ?? '/?view=news', tag: msg.tag });
  for (const s of r.rows) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
      ok++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await pool.query('DELETE FROM push_subs WHERE endpoint = $1', [s.endpoint]);
      else errs.push(`push ${e?.statusCode ?? ''} ${e?.body ?? e?.message ?? ''}`.trim());
    }
  }
  if (!ok && errs.length) throw new Error(errs[0]);
  return ok;
}
