// Economy brief for the USA, India and Canada: the real economy, not markets (jobs, prices, growth, budgets, trade,
// housing, wages, energy, policy). One short start-to-finish story per country: what happened, why, what is happening
// now, what is likely next, and what it means for people and businesses. Written by Gemini from the economy headlines
// (plain version without a key), refreshed every 2 hours; Claude Code's daily check can post a corrected version.
import pool from '../db';
import { economyNews, EconItem } from './live';
import { cleanBrief, clip, list, nyTime, gemini, httpsOrNull, BriefBody } from './brief';

export interface EconCountry { headline: string; happened: { text: string; src: number[] }[]; why: string[]; now: string[]; next: string[]; people: string }
export interface EconomyBrief {
  countries: { US?: EconCountry; India?: EconCountry; Canada?: EconCountry };
  sources: BriefBody['sources']; generated_at: string; engine: string; note?: string; corrections?: string[];
}
const COUNTRY = { US: 'US', IN: 'India', CA: 'Canada' } as const;
type R = keyof typeof COUNTRY;

/** The strongest economy stories of the last 48 hours, up to 10 per country. */
export function pickEconSources(all: EconItem[], now = Date.now()): EconItem[] {
  return (['US', 'IN', 'CA'] as R[]).flatMap(r => all.filter(h => h.region === r && h.pub >= now - 48 * 3600000)
    .sort((a, b) => b.score + b.also - (a.score + a.also) || b.pub - a.pub).slice(0, 10));
}

export function buildEconomyPrompt(src: EconItem[]): string {
  const lines = src.map((h, i) => `[${i + 1}] (${COUNTRY[h.region as R]}, ${nyTime(h.pub)} NY, ${h.source}) ${h.title}`);
  return [
    'You explain the ECONOMY (not the stock market) of three countries to a busy reader who knows nothing about it yet.',
    'For each country tell one clear story from start to finish: what happened, why, what is happening now, what is likely next,',
    'and what it means for ordinary people and businesses there. Use ONLY the facts below; if a cause is not given, say it is unclear.',
    'Plain English, no jargon (explain any term in a few words), each bullet at most 18 words. No investment advice.',
    'Skip stock-market moves unless the economy caused them. Pick the most important economic story per country.',
    '',
    'Return JSON only:',
    '{"US": {"headline": "max 14 words", "happened": [{"text": "...", "src": [headline numbers]}] (1-3), "why": [] (1-2), "now": [] (1-2), "next": [] (1-2), "people": "what it means for people and businesses, one line"},',
    ' "India": {same shape}, "Canada": {same shape}}',
    'Leave a country out if there is no economic news for it below.',
    '',
    'HEADLINES (numbered):',
    ...lines,
  ].join('\n');
}

export function cleanEconCountry(raw: any, nSources: number): EconCountry | null {
  const core = cleanBrief({ ...(raw ?? {}), regions: {}, impact: {}, watch: [] }, nSources);
  if (!core) return null;
  return { headline: core.headline, happened: core.happened, why: core.why, now: core.now, next: core.next, people: clip(raw?.people, 220) };
}

/** Plain version (no AI): the top stories per country. */
export function basicEconomy(src: EconItem[]): EconomyBrief['countries'] {
  const out: EconomyBrief['countries'] = {};
  for (const r of ['US', 'IN', 'CA'] as R[]) {
    const mine = src.map((h, i) => ({ h, i })).filter(x => x.h.region === r).slice(0, 4);
    if (!mine.length) continue;
    out[COUNTRY[r]] = { headline: mine[0].h.title, happened: mine.map(x => ({ text: x.h.title, src: [x.i + 1] })), why: [], now: [], next: [], people: '' };
  }
  return out;
}

const sourcesOf = (src: EconItem[]) => src.map((x, i) => ({ i: i + 1, title: x.title, link: x.link || null, source: x.source, region: x.region, ts: new Date(x.pub).toISOString() }));

let latest: EconomyBrief | null = null;
let building: Promise<EconomyBrief> | null = null;

export async function makeEconomyBrief(): Promise<EconomyBrief> {
  const e = await economyNews();
  const src = pickEconSources(e.list);
  let countries: EconomyBrief['countries'] | null = null, engine = 'basic', note: string | undefined;
  if (process.env.GEMINI_API_KEY && src.length) {
    try {
      const g = await gemini(buildEconomyPrompt(src));
      const c: EconomyBrief['countries'] = {};
      for (const k of ['US', 'India', 'Canada'] as const) { const x = cleanEconCountry(g.json?.[k], src.length); if (x) c[k] = x; }
      if (Object.keys(c).length) { countries = c; engine = g.model; } else note = 'The AI answer was not usable; showing the plain version.';
    } catch (err) { note = `AI unavailable (${(err as Error).message}); showing the plain version.`; }
  } else if (!process.env.GEMINI_API_KEY) note = 'Plain version: add GEMINI_API_KEY in Render for the short explanation.';
  const full: EconomyBrief = { countries: countries ?? basicEconomy(src), sources: sourcesOf(src), generated_at: new Date().toISOString(), engine, note };
  await pool.query('INSERT INTO news_briefs (engine, body) VALUES ($1, $2)', [`economy:${engine}`.slice(0, 30), JSON.stringify(full)]);
  latest = full;
  return full;
}

/** Latest economy brief; rebuilt when older than 2 hours. */
export async function getEconomyBrief(force = false): Promise<EconomyBrief | null> {
  if (!latest) {
    const r = await pool.query(`SELECT body FROM news_briefs WHERE engine LIKE 'economy:%' ORDER BY id DESC LIMIT 1`);
    if (r.rows[0]) latest = r.rows[0].body;
  }
  if (force || !latest || Date.now() - Date.parse(latest.generated_at) > 2 * 3600000) {
    if (!building) building = makeEconomyBrief().finally(() => { building = null; });
    try { return await building; } catch (err) { console.error('[economy brief]', (err as Error).message); return latest; }
  }
  return latest;
}

/** Claude Code's checked version (POST /api/news/economy/review), shown for 24 hours. */
export function cleanEconomyReview(b: any): EconomyBrief | string {
  const sources = (Array.isArray(b?.sources) ? b.sources : []).slice(0, 40).map((s: any, k: number) => ({
    i: k + 1, title: clip(s?.title, 300), link: httpsOrNull(s?.link), source: clip(s?.source, 80) || 'web',
    region: ['US', 'IN', 'CA'].includes(s?.region) ? s.region : 'US', ts: Number.isFinite(Date.parse(s?.ts)) ? new Date(s.ts).toISOString() : new Date().toISOString(),
  })).filter((s: any) => s.title);
  const countries: EconomyBrief['countries'] = {};
  for (const k of ['US', 'India', 'Canada'] as const) { const x = cleanEconCountry(b?.countries?.[k], sources.length); if (x) countries[k] = x; }
  if (!Object.keys(countries).length) return 'At least one country with a headline and a "happened" item is needed.';
  return { countries, sources, generated_at: new Date().toISOString(), engine: 'claude (reviewed)', corrections: list(b?.corrections, 8, 220) };
}
export async function saveEconomyReview(r: EconomyBrief): Promise<void> {
  await pool.query('INSERT INTO news_briefs (engine, body) VALUES ($1, $2)', ['economy-review', JSON.stringify(r)]);
}
export async function latestEconomyReview(): Promise<EconomyBrief | null> {
  const r = await pool.query(`SELECT body FROM news_briefs WHERE engine = 'economy-review' AND created_at > NOW() - INTERVAL '24 hours' ORDER BY id DESC LIMIT 1`);
  return r.rows[0]?.body ?? null;
}
