// The short "what happened / why / what now / what next" brief at the top of the News page.
// Facts in: the latest market headlines (USA, India, Canada), the crowd's odds (Polymarket), the next big releases,
// and NQ's move today. Words out: Google Gemini (free tier; key in the GEMINI_API_KEY environment variable, set by the
// owner in Render, never stored in code or the database). Without a key a plain version is built from the same facts.
// At most one brief every 30 minutes (60 at weekends); kept in news_briefs.
import pool from '../db';
import { headlines, upcoming, RegionHeadline } from './live';
import { crowdOdds, CrowdOdds } from './odds';
import { nqMinutes } from '../services/marketData';
import { TOPIC_LABEL } from '../shared/newsFeed';

export interface BriefBody {
  headline: string;
  happened: { text: string; src: number[] }[];
  why: string[]; now: string[]; next: string[];
  regions: { US?: string; India?: string; Canada?: string };
  impact: { NQ?: string; Nifty?: string; CAD?: string };
  watch: string[];
  sources: { i: number; title: string; link: string | null; source: string; region: string; ts: string }[];
  odds: { title: string; url: string; line: string }[];
  generated_at: string; engine: string; note?: string;
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map(x => clip(x, len)).filter(Boolean).slice(0, n);
const nyTime = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
export const oddsLine = (o: CrowdOdds) => `${o.title}: ${o.outcomes.map(x => `${x.label === 'Yes' ? 'yes' : x.label} ${x.pct}%`).join(', ')}`;

/** The newest headlines worth explaining: strongest first, a few per country, one per topic. */
export function pickSources(all: RegionHeadline[], now = Date.now()): RegionHeadline[] {
  const fresh = all.filter(h => h.score >= 4 && h.pub >= now - 18 * 3600000).sort((a, b) => b.score + b.also - (a.score + a.also) || b.pub - a.pub);
  const out: RegionHeadline[] = [], per: Record<string, number> = {}, topics = new Set<string>();
  const cap: Record<string, number> = { US: 14, IN: 9, CA: 7 };
  for (const h of fresh) {
    if ((per[h.region] ?? 0) >= (cap[h.region] ?? 5)) continue;
    if (!h.topic.startsWith('h') && topics.has(h.topic) && (per[h.region] ?? 0) > 2) continue;
    out.push(h); per[h.region] = (per[h.region] ?? 0) + 1; topics.add(h.topic);
  }
  return out.slice(0, 30);
}

export function buildPrompt(src: RegionHeadline[], odds: CrowdOdds[], events: { title: string; utc: string }[], nq: string | null): string {
  const lines = src.map((h, i) => `[${i + 1}] (${h.region}, ${nyTime(h.pub)} NY, ${h.source}${h.also ? `, ${h.also + 1} outlets` : ''}) ${h.title}`);
  return [
    'You write a very short market news brief for a busy day trader who trades Nasdaq futures (NQ), Indian stocks (Nifty) and lives in Canada.',
    'Use ONLY the facts below. Do not invent numbers, names, causes or quotes. If a cause is not in the facts, say it is unclear.',
    'Plain English, no jargon, each bullet at most 16 words. Never tell the reader to buy or sell; describe what could happen.',
    'For India include notable IPO news and grey market premium (GMP) signals when present, and say GMP is unofficial.',
    'When you mention a crowd expectation, quote its % from the CROWD ODDS list.',
    '',
    'Return JSON only, exactly this shape:',
    '{"headline": "the single most important thing right now, max 14 words",',
    ' "happened": [{"text": "what happened", "src": [headline numbers]}] (2 to 4 items, most important first),',
    ' "why": ["why it happened / why it matters"] (1 to 3),',
    ' "now": ["what is happening now in markets"] (1 to 3),',
    ' "next": ["what could happen next, with crowd odds where given"] (1 to 3),',
    ' "regions": {"US": "one line", "India": "one line", "Canada": "one line"},',
    ' "impact": {"NQ": "one line", "Nifty": "one line", "CAD": "one line"},',
    ' "watch": ["upcoming event and its time"] (0 to 3)}',
    '',
    `NQ today: ${nq ?? 'unknown'}`,
    '',
    'HEADLINES (newest market news, numbered):',
    ...lines,
    '',
    'CROWD ODDS (prediction markets, money on the outcome):',
    ...odds.slice(0, 12).map(o => `- ${oddsLine(o)}`),
    '',
    'UPCOMING RELEASES (New York time):',
    ...events.slice(0, 6).map(e => `- ${e.title}: ${nyTime(Date.parse(e.utc))}`),
  ].join('\n');
}

/** Check and trim what the model returned; null when it is not usable. */
export function cleanBrief(raw: any, nSources: number): Omit<BriefBody, 'sources' | 'odds' | 'generated_at' | 'engine'> | null {
  if (!raw || typeof raw !== 'object' || !clip(raw.headline, 200)) return null;
  const happened = (Array.isArray(raw.happened) ? raw.happened : []).map((x: any) => ({
    text: clip(typeof x === 'string' ? x : x?.text, 200),
    src: (Array.isArray(x?.src) ? x.src : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= nSources).slice(0, 4),
  })).filter((x: any) => x.text).slice(0, 4);
  if (!happened.length) return null;
  const obj = (v: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, clip(v?.[k], 220)]).filter(([, t]) => t));
  return {
    headline: clip(raw.headline, 160), happened,
    why: list(raw.why, 3, 200), now: list(raw.now, 3, 200), next: list(raw.next, 3, 220),
    regions: obj(raw.regions, ['US', 'India', 'Canada']), impact: obj(raw.impact, ['NQ', 'Nifty', 'CAD']), watch: list(raw.watch, 3, 160),
  };
}

async function gemini(prompt: string): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no key');
  const models = [process.env.GEMINI_MODEL || 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let last: Error | null = null;
  for (const model of [...new Set(models)]) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1800, ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      if (r.status === 404) { last = new Error(`model ${model} not found`); continue; }
      if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
      const j: any = await r.json();
      const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
      return { model, json: JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()) };
    } catch (e) { last = e as Error; if ((e as Error).message.startsWith('Gemini HTTP 4')) break; }
    finally { clearTimeout(t); }
  }
  throw last ?? new Error('Gemini failed');
}

/** Plain brief from the same facts when no AI key is set (or the AI call failed). */
export function basicBrief(src: RegionHeadline[], odds: CrowdOdds[], events: { title: string; utc: string }[], nq: string | null): Omit<BriefBody, 'sources' | 'odds' | 'generated_at' | 'engine'> {
  const top = src.slice(0, 4);
  const by = (r: string) => src.find(h => h.region === r)?.title;
  return {
    headline: top[0]?.title ?? 'No big market news in the last 18 hours.',
    happened: top.map((h, i) => ({ text: `${h.topic && TOPIC_LABEL[h.topic] ? `${TOPIC_LABEL[h.topic]}: ` : ''}${h.title}`, src: [i + 1] })),
    why: [], now: [nq ? `NQ today: ${nq}.` : ''].filter(Boolean), next: odds.slice(0, 3).map(oddsLine),
    regions: { US: by('US'), India: by('IN'), Canada: by('CA') } as any, impact: {},
    watch: events.slice(0, 3).map(e => `${e.title}: ${nyTime(Date.parse(e.utc))} NY`),
  };
}

async function nqToday(): Promise<string | null> {
  try {
    const m = await nqMinutes();
    const c = m.c.filter((x): x is number => x != null);
    if (c.length < 2) return null;
    const d = c[c.length - 1] - c[0];
    return `${d >= 0 ? '+' : ''}${d.toFixed(0)} pts (${((d / c[0]) * 100).toFixed(2)}%) since the session open, last ${c[c.length - 1].toFixed(0)}`;
  } catch { return null; }
}

let latest: BriefBody | null = null;
let building: Promise<BriefBody> | null = null;
const maxAge = () => { const d = new Date().getUTCDay(); return (d === 0 || d === 6 ? 60 : 30) * 60000; };

export async function makeBrief(): Promise<BriefBody> {
  const [h, o, up, nq] = await Promise.all([headlines(), crowdOdds(), upcoming(Date.now(), Date.now() + 3 * 86400000, false).catch(() => ({ events: [] as any[] })), nqToday()]);
  const src = pickSources(h.list);
  const events = up.events.filter((e: any) => e.impact === 'high');
  let engine = 'basic', body: ReturnType<typeof basicBrief> | null = null, note: string | undefined;
  if (process.env.GEMINI_API_KEY && src.length) {
    try {
      const g = await gemini(buildPrompt(src, o.list, events, nq));
      body = cleanBrief(g.json, src.length);
      if (body) engine = g.model; else note = 'The AI answer was not usable; showing the plain brief.';
    } catch (e) { note = `AI brief unavailable (${(e as Error).message}); showing the plain brief.`; }
  } else if (!process.env.GEMINI_API_KEY) note = 'Plain brief: add GEMINI_API_KEY in Render for the short AI explanation.';
  const full: BriefBody = {
    ...(body ?? basicBrief(src, o.list, events, nq)),
    sources: src.map((x, i) => ({ i: i + 1, title: x.title, link: x.link || null, source: x.source, region: x.region, ts: new Date(x.pub).toISOString() })),
    odds: o.list.slice(0, 12).map(x => ({ title: x.title, url: x.url, line: oddsLine(x) })),
    generated_at: new Date().toISOString(), engine, note,
  };
  await pool.query('INSERT INTO news_briefs (engine, body) VALUES ($1, $2)', [engine, JSON.stringify(full)]);
  await pool.query(`DELETE FROM news_briefs WHERE created_at < NOW() - INTERVAL '30 days'`);
  latest = full;
  return full;
}

/** Latest brief; builds a new one when the last is older than 30 minutes (60 at weekends). */
export async function getBrief(force = false): Promise<BriefBody | null> {
  if (!latest) {
    const r = await pool.query('SELECT body FROM news_briefs ORDER BY id DESC LIMIT 1');
    if (r.rows[0]) latest = r.rows[0].body;
  }
  const stale = !latest || Date.now() - Date.parse(latest.generated_at) > maxAge();
  if (force || stale) {
    if (!building) building = makeBrief().finally(() => { building = null; });
    try { return await building; } catch (e) { console.error('[brief]', (e as Error).message); return latest; }
  }
  return latest;
}

// ------------------------------------------------------------------ reviewed brief (checked by Claude Code)
// The owner runs /newscheck in Claude Code: it reads the latest brief and headlines, checks them on the web, and posts a
// corrected brief here. It is shown above the automatic one, with what was corrected, until a newer review replaces it.
export interface ReviewedBrief extends BriefBody { corrections: string[]; reviewed_by: string }

const httpsOrNull = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s<>"]{4,600}$/.test(v) ? v : null);
/** Check what Claude Code sent; returns an error message or the cleaned brief. */
export function cleanReview(b: any): ReviewedBrief | string {
  const sources = (Array.isArray(b?.sources) ? b.sources : []).slice(0, 40).map((s: any, k: number) => ({
    i: k + 1, title: clip(s?.title, 300), link: httpsOrNull(s?.link), source: clip(s?.source, 80) || 'web',
    region: ['US', 'IN', 'CA', 'World'].includes(s?.region) ? s.region : 'US', ts: Number.isFinite(Date.parse(s?.ts)) ? new Date(s.ts).toISOString() : new Date().toISOString(),
  })).filter((s: any) => s.title);
  const core = cleanBrief(b, sources.length);
  if (!core) return 'A headline and at least one "happened" item are needed.';
  const odds = (Array.isArray(b?.odds) ? b.odds : []).slice(0, 12).map((o: any) => ({ title: clip(o?.title, 140), url: httpsOrNull(o?.url) ?? '', line: clip(o?.line, 240) })).filter((o: any) => o.line);
  return { ...core, sources, odds, generated_at: new Date().toISOString(), engine: 'claude (reviewed)', corrections: list(b?.corrections, 8, 220), reviewed_by: 'Claude Code' };
}

export async function saveReview(r: ReviewedBrief): Promise<void> {
  await pool.query('INSERT INTO news_briefs (engine, body) VALUES ($1, $2)', ['claude-review', JSON.stringify(r)]);
}
/** The newest reviewed brief from the last 24 hours, or null. */
export async function latestReview(): Promise<ReviewedBrief | null> {
  const r = await pool.query(`SELECT body FROM news_briefs WHERE engine = 'claude-review' AND created_at > NOW() - INTERVAL '24 hours' ORDER BY id DESC LIMIT 1`);
  return r.rows[0]?.body ?? null;
}
