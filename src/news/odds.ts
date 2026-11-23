// "What the crowd expects": open prediction markets on Polymarket (public read-only API, no key), where people put
// money on an outcome before it happens (Fed decisions, inflation, big tech, India, Canada, trade, conflicts).
// Refreshed at most every 30 minutes; a handful of small requests.
const UA = 'trading-journal/1.0 (personal news calendar)';
const TAGS = ['fed-rates', 'economy', 'finance', 'stocks', 'tech', 'business', 'trade-war', 'geopolitics', 'india', 'canada'];

export interface CrowdOdds {
  id: string; title: string; url: string; region: 'US' | 'IN' | 'CA' | 'World';
  ends: string | null; volume24h: number;
  outcomes: { label: string; pct: number; change1d: number | null }[];
}

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const yesPrice = (m: any): number | null => {
  try { const p = JSON.parse(m.outcomePrices ?? '[]'); return num(p[0]); } catch { return null; }
};

/** Turn one Polymarket event into the few outcomes worth showing (most likely first). */
export function toOdds(e: any, tag: string): CrowdOdds | null {
  const markets = (e.markets ?? []).filter((m: any) => m.active && !m.closed);
  if (!markets.length) return null;
  const outs = markets.map((m: any) => ({
    label: String(markets.length > 1 ? m.groupItemTitle || m.question : 'Yes').slice(0, 80),
    pct: Math.round((yesPrice(m) ?? NaN) * 1000) / 10,
    change1d: num(m.oneDayPriceChange) == null ? null : Math.round(num(m.oneDayPriceChange)! * 1000) / 10,
  })).filter((o: any) => Number.isFinite(o.pct));
  if (!outs.length) return null;
  outs.sort((a: any, b: any) => b.pct - a.pct);
  if (outs[0].pct >= 99.5 && (outs.length === 1 || outs[1].pct < 1)) return null;   // already decided: nothing to learn
  const tags = (e.tags ?? []).map((t: any) => String(t.slug ?? '').toLowerCase());
  const region = tags.includes('india') || tag === 'india' ? 'IN' : tags.includes('canada') || tag === 'canada' ? 'CA'
    : ['geopolitics'].includes(tag) ? 'World' : 'US';
  return {
    id: String(e.id), title: String(e.title ?? '').slice(0, 140), url: `https://polymarket.com/event/${encodeURIComponent(String(e.slug ?? ''))}`,
    region, ends: e.endDate ?? null, volume24h: num(e.volume24hr) ?? 0, outcomes: outs.slice(0, markets.length > 1 ? 3 : 1),
  };
}

const NOISE = /\b(nba|nfl|mlb|nhl|ufc|fifa|super bowl|world cup|oscars?|grammy|eurovision|weather|temperature|election winner of|mention|tweet|say .* during|math|millennium prize|riemann|conjecture|person of the year|canada.?s choice|idol|bachelor|survivor|big brother|got talent|box office|album|song)\b/i;
let cache: { at: number; list: CrowdOdds[]; errors: string[] } = { at: 0, list: [], errors: [] };
let loading: Promise<void> | null = null;

export async function crowdOdds(): Promise<{ list: CrowdOdds[]; errors: string[]; at: string }> {
  if (Date.now() - cache.at > 30 * 60000) {
    if (!loading) loading = (async () => {
      const errors: string[] = []; const seen = new Map<string, CrowdOdds>();
      await Promise.all(TAGS.map(async tag => {
        try {
          const list = await getJson(`https://gamma-api.polymarket.com/events?closed=false&active=true&limit=25&order=volume24hr&ascending=false&tag_slug=${tag}`);
          for (const e of Array.isArray(list) ? list : []) {
            const end = Date.parse(e.endDate ?? '');
            if (Number.isFinite(end) && (end < Date.now() || end > Date.now() + 200 * 86400000)) continue;   // past, or too far away to matter
            if (NOISE.test(String(e.title ?? ''))) continue;
            const minVol = tag === 'india' || tag === 'canada' ? 500 : 20000;
            if ((num(e.volume24hr) ?? 0) < minVol) continue;
            const o = toOdds(e, tag);
            if (o && !seen.has(o.id)) seen.set(o.id, o);
          }
        } catch (err) { errors.push(`Polymarket ${tag}: ${(err as Error).message}`); }
      }));
      const all = [...seen.values()].sort((a, b) => b.volume24h - a.volume24h);
      // the busiest overall, plus the top few of India and Canada (their markets are much smaller)
      const list = [...all.slice(0, 24), ...['IN', 'CA'].flatMap(r => all.filter(o => o.region === r).slice(0, 4))]
        .filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
      cache = { at: Date.now(), list: list.length || !cache.list.length ? list : cache.list, errors };
    })().finally(() => { loading = null; });
    await loading;
  }
  return { list: cache.list, errors: cache.errors, at: new Date(cache.at).toISOString() };
}
