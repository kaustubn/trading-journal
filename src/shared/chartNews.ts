// News lines on the market chart: short labels, one line per release time, and an honest "what usually happens"
// read-out from the NQ reaction study (src/news/nqReactions.json). Pure functions, tested in tests/chartNews.test.ts.
import type { Reaction } from './econCalendar';

export interface ChartNews {
  utc: string; title: string; impact: 'high' | 'medium' | 'low';
  actual: string | null; forecast: string | null; previous: string | null;
  surprise: 'above' | 'below' | 'inline' | null;
  kind: 'data' | 'fed' | 'earnings' | 'headline';
  nq: Reaction | null;
  source?: string; region?: string; topic?: string;    // headlines only
}

const SHORT: [RegExp, string][] = [
  [/^core cpi/i, 'Core CPI'], [/^cpi/i, 'CPI'], [/core pce/i, 'Core PCE'], [/pce/i, 'PCE'], [/^core ppi/i, 'Core PPI'], [/^ppi/i, 'PPI'],
  [/^adp/i, 'ADP'], [/non-farm|nfp|jobs report/i, 'NFP'], [/unemployment rate/i, 'Unemp.'], [/unemployment claims|jobless/i, 'Claims'],
  [/average hourly/i, 'Wages'], [/core retail/i, 'Core Retail'], [/retail/i, 'Retail'], [/fomc statement|federal funds|fed announcement|fed rate|fomc rate/i, 'FOMC'],
  [/fomc press/i, 'Powell PC'], [/minutes/i, 'Minutes'], [/powell|yellen|fed chair/i, 'Fed Chair'], [/trump/i, 'Trump'], [/projections/i, 'FOMC proj.'],
  [/ism manufacturing/i, 'ISM Mfg'], [/ism services/i, 'ISM Serv'], [/flash manufacturing/i, 'PMI Mfg'], [/flash services/i, 'PMI Serv'],
  [/jolts/i, 'JOLTS'], [/gdp/i, 'GDP'], [/uom|consumer sentiment/i, 'UoM'], [/inflation expectations/i, 'Infl. exp.'],
  [/consumer confidence/i, 'Conf.'], [/durable/i, 'Durables'], [/crude/i, 'Crude'], [/empire/i, 'Empire'], [/philly/i, 'Philly Fed'],
  [/building permits/i, 'Permits'], [/employment cost/i, 'ECI'],
];
const TOPIC_SHORT: Record<string, string> = {
  nvidia: 'NVDA', apple: 'AAPL', microsoft: 'MSFT', amazon: 'AMZN', google: 'GOOGL', meta: 'META', tesla: 'TSLA', broadcom: 'AVGO',
  openai: 'OpenAI', amd: 'AMD', netflix: 'NFLX', fed: 'Fed', inflation: 'Inflation', jobs: 'Jobs', tariffs: 'Tariffs',
  rbi: 'RBI', nifty: 'Nifty', rupee: 'Rupee', boc: 'BoC', tsx: 'TSX', cad: 'CAD', oil: 'Oil', adani: 'Adani', reliance: 'Reliance', ipo: 'IPO',
};
/** Chart label for any item: a release's short name, or a headline's topic ("NVDA", "RBI") / first words. */
export function labelOf(e: ChartNews): string {
  if (e.kind !== 'headline') return shortTitle(e.title);
  const flag = e.region === 'IN' ? 'IN ' : e.region === 'CA' ? 'CA ' : '';
  const t = e.topic && TOPIC_SHORT[e.topic];
  return flag + (t ?? e.title.split(/\s+/).slice(0, 2).join(' ').slice(0, 14));
}
export function shortTitle(t: string): string {
  const earn = t.match(/^([A-Z]{1,5}) earnings/);
  if (earn) return `${earn[1]} earn.`;
  for (const [re, s] of SHORT) if (re.test(t)) return s;
  return t.length > 14 ? t.slice(0, 13) + '…' : t;
}

export interface NewsGroup { ms: number; events: ChartNews[]; impact: 'high' | 'medium' | 'low'; label: string; main: ChartNews }
const RANK = { high: 3, medium: 2, low: 1 } as const;
/** One group per release minute; the label names the biggest mover first ("CPI +2"). */
export function groupNews(evs: ChartNews[]): NewsGroup[] {
  const by = new Map<number, ChartNews[]>();
  for (const e of evs) { const ms = Math.floor(Date.parse(e.utc) / 60000) * 60000; if (!Number.isFinite(ms)) continue; (by.get(ms) ?? by.set(ms, []).get(ms)!).push(e); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([ms, list]) => {
    const score = (e: ChartNews) => RANK[e.impact] * 1000 + (e.nq ? e.nq.n * (e.nq.absPct15 ?? e.nq.absMed15 / 100) : 0);
    const sorted = [...list].sort((a, b) => score(b) - score(a));
    const names = [...new Set(sorted.map(labelOf))];
    return { ms, events: sorted, main: sorted[0], impact: sorted.reduce((m, e) => (RANK[e.impact] > RANK[m] ? e.impact : m), 'low' as ChartNews['impact']),
      label: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] };
  });
}

/** Hide what was not known yet at `cursorMs` (replay): no actual, no surprise. */
export function asOf(e: ChartNews, cursorMs: number | null): ChartNews {
  if (cursorMs == null || Date.parse(e.utc) <= cursorMs) return e;
  return { ...e, actual: null, surprise: null };
}

export interface Outlook { bias: 'up' | 'down' | 'none'; upPct: number | null; n: number; movePts: number | null; lines: string[] }
const pts = (r: Reaction, price: number | null) => (r.absPct15 != null && price ? (r.absPct15 / 100) * price : r.absMed15);
const lean = (up: number) => (up >= 60 ? 'up' : up <= 40 ? 'down' : 'none') as Outlook['bias'];
const word = (s: 'above' | 'below' | 'inline') => (s === 'above' ? 'above forecast' : s === 'below' ? 'below forecast' : 'in line with forecast');

/** What NQ did after this release in the past. Before the release: the usual move size, the direction split and
 *  both surprise scenarios. After it (surprise known): what followed that kind of surprise. Never a certainty. */
export function outlook(e: ChartNews, price: number | null): Outlook {
  if (e.kind === 'headline') return { bias: 'none', upPct: null, n: 0, movePts: null, lines: [`Breaking news · ${e.source ?? ''}${e.region ? ` · ${e.region === 'IN' ? 'India' : e.region === 'CA' ? 'Canada' : 'USA'}` : ''}`] };
  const r = e.nq;
  if (!r || r.n < 8) return { bias: 'none', upPct: null, n: r?.n ?? 0, movePts: null, lines: [e.kind === 'earnings' ? 'Earnings: no NQ study for single-company reports. Expect a gap or fast move in the stock and often in NQ.' : 'No NQ history for this release yet.'] };
  const size = pts(r, price);
  const lines = [`Usual move: about ${Math.round(size)} pts either way within 15 min (median of ${r.n} releases).`];
  const known = e.surprise ? r.buckets[e.surprise] : null;
  if (e.surprise && known && known.n >= 5) {
    lines.unshift(`Came in ${word(e.surprise)}${e.actual ? ` (${e.actual} vs ${e.forecast ?? '?'})` : ''}. After that, NQ was higher 15 min later ${Math.round(known.up15)}% of ${known.n} times.`);
    if (known.held60 != null) lines.push(`The 15-min direction held to 60 min ${Math.round(known.held60)}% of the time.`);
    return { bias: lean(known.up15), upPct: known.up15, n: known.n, movePts: size, lines };
  }
  lines.push(Math.abs(r.up15 - 50) < 10 ? `Direction: about a coin flip (higher after 15 min ${Math.round(r.up15)}% of the time).`
    : `Leans ${r.up15 > 50 ? 'up' : 'down'}: higher after 15 min ${Math.round(r.up15)}% of the time.`);
  for (const s of ['above', 'below'] as const) {
    const b = r.buckets[s];
    if (b && b.n >= 5) lines.push(`If ${word(s)}: higher ${Math.round(b.up15)}% of ${b.n} times.`);
  }
  return { bias: lean(r.up15), upPct: r.up15, n: r.n, movePts: size, lines };
}

export interface StoredHeadline { ts: string; title: string; source: string; region: string; topic: string; score: number; feeds: number }
/** Keep the NQ chart readable: US stories scoring 5+, India / Canada only very big ones (8+, or carried by 3+ outlets);
 *  a story (topic) is marked once, when it broke, and not again for 6 hours; at most one marker per country per hour. */
export function pickChartHeadlines<T extends StoredHeadline>(rows: T[]): T[] {
  const ok = rows.filter(h => (h.region === 'US' ? h.score >= 5 : h.score >= 8 || h.feeds >= 3)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const lastTopic = new Map<string, number>(), slot = new Set<string>(), out: T[] = [];
  for (const h of ok) {
    const ms = Date.parse(h.ts);
    const named = !h.topic.startsWith('h');
    if (named && ms - (lastTopic.get(h.topic) ?? -Infinity) < 6 * 3600000) continue;
    const k = `${Math.floor(ms / 3600000)}|${h.region}`;
    if (slot.has(k)) continue;
    slot.add(k); if (named) lastTopic.set(h.topic, ms);
    out.push(h);
  }
  return out;
}
