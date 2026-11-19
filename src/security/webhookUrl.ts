// Outgoing alert webhooks: only real Discord / Telegram endpoints, so the server can never be
// pointed at itself, the cloud metadata service or a private network (SSRF).
const ALLOWED: Record<string, { hosts: string[]; path: RegExp }> = {
  discord: { hosts: ['discord.com', 'discordapp.com'], path: /^\/api\/webhooks\/\d+\/[\w-]+\/?$/ },
  telegram: { hosts: ['api.telegram.org'], path: /^\/bot\d+:[\w-]+\/sendMessage\/?$/ },
};

/** Returns null if the URL is allowed for this service, otherwise a short reason. */
export function webhookUrlProblem(service: string, raw: string): string | null {
  const rule = ALLOWED[String(service || '').toLowerCase()];
  if (!rule) return 'Unsupported service (use discord or telegram)';
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return 'Webhook URL required';
  let u: URL;
  try { u = new URL(raw); } catch { return 'Invalid URL'; }
  if (u.protocol !== 'https:') return 'Webhook URL must use https';
  if (u.username || u.password) return 'Webhook URL must not contain credentials';
  if (u.port && u.port !== '443') return 'Webhook URL must use the default port';
  if (!rule.hosts.includes(u.hostname.toLowerCase())) return `Webhook URL must be on ${rule.hosts.join(' or ')}`;
  if (!rule.path.test(u.pathname)) return 'Webhook URL path does not look like a ' + service + ' webhook';
  return null;
}
