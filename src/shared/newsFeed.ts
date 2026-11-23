// News page + news alerts: pure helpers shared by the server and the tests (no I/O).
//   - Scheduled US releases that move NQ, with their official dates read from FRED's public release calendar
//     (fred.stlouisfed.org/releases/calendar, times shown in US Central time) and the FOMC meeting list from
//     federalreserve.gov (decision at 2:00 pm New York on the meeting's last day).
//   - Headlines from RSS feeds, scored so only market-moving ones are shown / sent.
import { nyToUtc } from './econCalendar';

export type Impact = 'high' | 'medium';
export interface Scheduled { rid: number; label: string; impact: Impact; study: string | null; why: string }
/** The releases worth watching on NQ (FRED release ids). */
export const SCHEDULED: Scheduled[] = [
  { rid: 10, label: 'CPI (inflation)', impact: 'high', study: 'CPI m/m', why: 'Inflation: the biggest monthly mover. Hot = rates stay high = NQ usually down.' },
  { rid: 50, label: 'Jobs report (NFP)', impact: 'high', study: 'Non-Farm Employment Change', why: 'Jobs and wages: big, fast moves at 8:30 New York.' },
  { rid: 46, label: 'PPI (producer prices)', impact: 'high', study: 'PPI m/m', why: 'Inflation at the producer level; moves NQ when far from forecast.' },
  { rid: 9, label: 'Retail sales', impact: 'high', study: 'Retail Sales m/m', why: 'Consumer spending: growth vs rates.' },
  { rid: 54, label: 'PCE inflation (Fed\'s favourite)', impact: 'high', study: 'Core PCE Price Index m/m', why: 'The inflation number the Fed targets.' },
  { rid: 53, label: 'GDP', impact: 'medium', study: 'Advance GDP q/q', why: 'Growth; the first (advance) estimate moves most.' },
  { rid: 192, label: 'JOLTS job openings', impact: 'medium', study: 'JOLTS Job Openings', why: 'Labour demand, 10:00 New York.' },
  { rid: 180, label: 'Weekly jobless claims', impact: 'medium', study: 'Unemployment Claims', why: 'Weekly labour check; matters more when the job market is in focus.' },
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIdx = (s: string) => {
  const k = s.toLowerCase().slice(0, 3);
  const i = MONTHS.findIndex(m => m.startsWith(k));
  return i < 0 ? -1 : i + 1;
};
const pad = (n: number) => String(n).padStart(2, '0');

export interface Release { rid: number; date: string; utc: string }
/**
 * Rows of FRED's release calendar page: a bold date, then (for scheduled releases) a time in US Central time, then
 * the release link. Rows without a time are data updates, not announcements, and are skipped.
 */
export function parseFredCalendar(html: string): Release[] {
  const out: Release[] = [];
  const re = /<span style="font-weight: bold;">\s*[A-Za-z]+ ([A-Za-z]+) (\d{1,2}), (\d{4})\s*<\/span>|>\s*(\d{1,2}):(\d{2}) (am|pm)\s*<|<a href="\/release\?rid=(\d+)">/g;
  let day: [number, number, number] | null = null;
  let time: [number, number] | null = null;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) { const mo = monthIdx(m[1]); day = mo > 0 ? [Number(m[3]), mo, Number(m[2])] : null; time = null; }
    else if (m[4]) { let h = Number(m[4]) % 12; if (m[6] === 'pm') h += 12; time = [h, Number(m[5])]; }
    else if (m[7] && day && time) {
      // Central -> New York is +1 hour all year (both zones change on the same dates)
      const [y, mo, d] = day;
      out.push({ rid: Number(m[7]), date: `${y}-${pad(mo)}-${pad(d)}`, utc: new Date(nyToUtc(y, mo, d, time[0] + 1, time[1])).toISOString() });
      time = null;
    }
  }
  return out;
}

export interface Fomc { date: string; utc: string; projections: boolean }
/**
 * FOMC meetings from federalreserve.gov/monetarypolicy/fomccalendars.htm: per year, "January 27-28",
 * "Apr/May 30-1", "December 8-9*" (* = with economic projections). The decision comes at 2:00 pm New York on the
 * last day. One-day items such as "(notation vote)" are skipped.
 */
export function parseFomc(html: string): Fomc[] {
  const out: Fomc[] = [];
  const re = /(\d{4}) FOMC Meetings|fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>|fomc-meeting__date[^>]*>([^<]+)</g;
  let year = 0, month = '';
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) { year = Number(m[1]); month = ''; }
    else if (m[2]) month = m[2].trim();
    else if (m[3] && year && month) {
      const dm = /^\s*(\d{1,2})-(\d{1,2})(\*?)/.exec(m[3]);
      if (!dm) continue;
      const parts = month.split('/');
      const mo = monthIdx(parts[parts.length - 1]);
      if (mo < 0) continue;
      const d = Number(dm[2]);
      out.push({ date: `${year}-${pad(mo)}-${pad(d)}`, utc: new Date(nyToUtc(year, mo, d, 14, 0)).toISOString(), projections: dm[3] === '*' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ headlines
export interface Headline { title: string; link: string; pub: number; source: string }
const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Items of an RSS 2.0 feed. */
export function parseRss(xml: string, source: string): Headline[] {
  const out: Headline[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const it = m[0];
    const tag = (t: string) => { const x = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`).exec(it); return x ? decode(x[1]) : ''; };
    const title = tag('title'), link = tag('link'), pub = Date.parse(tag('pubDate'));
    if (title && Number.isFinite(pub)) out.push({ title, link: /^https:\/\//.test(link) ? link : '', pub, source });
  }
  return out;
}

const MACRO = /\b(fed|fomc|powell|rate cuts?|rate hikes?|interest rates?|(cuts?|hikes?|raises?|holds?|keeps?) (key |interest |policy |benchmark |repo )?rates?|inflation|cpi|ppi|pce|jobs report|payrolls|unemployment|jobless|gdp|recession|treasury yields?|bond yields?|tariffs?|trade war|trade deal|sanctions|shutdown|debt ceiling|stimulus|white house|trump|war|invasion|attack|ceasefire)\b/i;
// the few macro items that move NQ on their own
const CORE = /\b(powell|fomc|fed chair|rate cuts?|rate hikes?|cpi|jobs report|payrolls|tariffs?)\b/i;
const MEGA = /\b(nvidia|nvda|apple|aapl|microsoft|msft|amazon|amzn|alphabet|google|meta|tesla|tsla|broadcom|avgo|netflix|amd|openai|jensen huang|huang|tim cook|elon musk|musk|nadella|zuckerberg)\b/i;
const MARKET = /\b(nasdaq|s&p|s&amp;p|stocks?|dow|futures|wall street|markets?|tech stocks|sell-?off|chipmakers?|semiconductors?)\b/i;
const MOVE = /\b(climbs?|stunning|booms?|tanks?|soars?|soaring|surges?|surging|skyrockets?|plunges?|plunging|tumbles?|crash(es|ing)?|sell-?off|rall(y|ies|ying)|record|halt(ed)?|jumps?|sinks?|rout|slumps?|biggest|spikes?|collapses?|reinstated|resigns?|ousted|fired|steps down|(is )?back as (\w+ )?ceo|returns? as (\w+ )?ceo|new ceo|ceo (exit|departure)|bankrupt(cy)?|downgrade|emergency)\b/i;
// India and Canada: central banks, indices, currencies, big index names and policy makers
const INDIA = /\b(rbi|reserve bank of india|repo rate|sensex|nifty|bank nifty|rupee|sebi|gst|union budget|fiis?|fpis?|india vix|dalal street|sitharaman|malhotra)\b/i;
const INDIA_CO = /\b(adani|reliance|hdfc|icici|infosys|tcs|wipro|tata|bajaj|sbi|modi|nse|bse)\b/i;
const CANADA = /\b(bank of canada|boc|macklem|tsx|loonie|canadian dollar|cusma|usmca|bay street|canada'?s (economy|inflation|jobs|gdp))\b/i;
const CANADA_CO = /\b(carney|shopify|rbc|td bank|enbridge|suncor|oil sands)\b/i;
// IPOs and the grey market premium (GMP: the unofficial price of IPO shares before they list, mostly in India)
const IPO = /\b(ipos?|gmp|grey[- ]market|gray[- ]market|listing (gains?|day|price)|subscription status|subscribed \d|anchor investors|price band|allotment)\b/i;
const GLOBAL = /\b(oil|crude|opec|brent|gold|china|yuan|bitcoin|dollar index|yen|ecb|bank of japan)\b/i;
const NOISE = /\b(i'?ve|i'?m|my (wife|husband|parents|kids)|how to|should i|retire(ment)?|married|mortgage|personal finance|opinion|podcast|recipe|celebrity|best .{0,20} to buy|quiz|horoscope|wedding|divorce|portfolio stocks?|multibaggers?|stocks? to (buy|watch)|buy or sell|target price|check (list|details|here)|penny stocks?|dividend stocks?|share price (today|highlights|live)|stock price (history|today|live)|stock tips?|live updates)\b/i;

export interface Scored extends Headline { score: number; tags: string[] }
/** 0+ score: macro +3 (Fed / CPI / jobs / tariffs +2 more), big tech +2, market words +1, big-move words +2, a move of 5%+ in the title +2, noise -5. */
export function scoreHeadline(h: Headline): Scored {
  const t = h.title; let score = 0; const tags: string[] = [];
  if (MACRO.test(t)) { score += 3; tags.push('macro'); }
  if (CORE.test(t)) score += 2;
  if (MEGA.test(t)) { score += 2; tags.push('big tech'); }
  if (MARKET.test(t)) { score += 1; tags.push('market'); }
  if (MOVE.test(t)) { score += 2; tags.push('big move'); }
  if (INDIA.test(t)) { score += 3; tags.push('india'); } else if (INDIA_CO.test(t)) { score += 1; tags.push('india'); }
  if (CANADA.test(t)) { score += 3; tags.push('canada'); } else if (CANADA_CO.test(t)) { score += 1; tags.push('canada'); }
  if (GLOBAL.test(t)) { score += 1; tags.push('global'); }
  if (IPO.test(t)) { score += /\b(gmp|grey[- ]market|gray[- ]market)\b/i.test(t) ? 5 : 3; tags.push(/\b(gmp|grey[- ]market|gray[- ]market)\b/i.test(t) ? 'grey market' : 'ipo'); }
  const pct = Math.max(0, ...[...t.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map(x => Number(x[1])));
  if (pct >= 5) { score += 2; tags.push(`${pct}%`); }
  if (NOISE.test(t)) { score -= 5; tags.push('noise'); }
  return { ...h, score, tags };
}
export const IMPORTANT = 5;

// ------------------------------------------------------------------ the real economy (not markets)
// Jobs, prices, growth, budgets, trade, housing, wages, energy and policy: what changes life and business in a country.
const ECON_CORE = /\b(econom(y|ic|ies)|gdp|growth|recession|inflation|prices?|cost of living|jobs?|unemployment|employment|hiring|layoffs?|wages?|salar(y|ies)|minimum wage|budget|deficit|debt|tax(es)?|gst|spending|subsid(y|ies)|tariffs?|trade|exports?|imports?|manufacturing|factory|industr(y|ial)|retail sales|consumer|housing|home (prices|sales)|rents?|interest rates?|repo rate|central bank|monetary policy|fiscal|energy|fuel|petrol|diesel|electricity|food prices|agricultur(e|al)|farm(ers)?|monsoon|strikes?|immigration|population|productivity|investment|fdi|currency|rupee|loonie|stimulus|welfare|pension|census|poverty)\b/i;
const ECON_GOV = /\b(ottawa|carney|premiers?|provinc(e|es|ial)|interprovincial|government|parliament|congress|senate|white house|treasury|finance minister|ministry|prime minister|budget|policy|statistics canada|statcan|bureau of labor|bls|mospi|niti aayog|rbi|bank of canada|federal reserve|fed|imf|world bank|oecd)\b/i;
const MARKET_ONLY = /\b(shares?|stocks?|sensex|nifty|nasdaq|s&p|dow|tsx|ipos?|gmp|grey market|mutual funds?|portfolio|target price|multibagger|crypto|bitcoin|earnings call|q[1-4] results?)\b/i;
/** Economy score: economic topics +3, government / central bank +1, a big number move +1; stock-market-only stories and
 *  personal-finance noise are pushed down so this list explains the country, not the market. */
export function scoreEconomy(h: Headline): Scored {
  const t = h.title; let score = 0; const tags: string[] = [];
  if (ECON_CORE.test(t)) { score += 3; tags.push('economy'); }
  if (ECON_GOV.test(t)) { score += 1; tags.push('policy'); }
  if (/\b\d+(\.\d+)?\s?%|\b(record|highest|lowest|biggest|surges?|plunges?|slows?|jumps?|falls?|rises?|cuts?|hikes?)\b/i.test(t)) score += 1;
  if (MARKET_ONLY.test(t)) { score -= 2; tags.push('market'); }
  if (NOISE.test(t)) { score -= 5; tags.push('noise'); }
  return { ...h, score, tags };
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').split(' ').filter(w => w.length > 2));
/** Same story from several feeds -> one entry (the earliest), with how many feeds carried it. */
export function dedupe(list: Scored[]): (Scored & { also: number })[] {
  const out: (Scored & { also: number; w: Set<string> })[] = [];
  for (const h of [...list].sort((a, b) => a.pub - b.pub)) {
    const w = words(h.title);
    const same = out.find(o => {
      let inter = 0; for (const x of w) if (o.w.has(x)) inter++;
      return inter / Math.max(1, Math.min(w.size, o.w.size)) >= 0.6;
    });
    if (same) { same.also++; if (h.score > same.score) same.score = h.score; }
    else out.push({ ...h, also: 0, w });
  }
  return out.map(({ w, ...rest }) => rest).sort((a, b) => b.pub - a.pub);
}
/** Stable short key for "sent once" logs. */
export function headlineKey(title: string): string {
  let h = 2166136261;
  for (const c of [...words(title)].sort().join(' ')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

// ------------------------------------------------------------------ fast moves
/** NQ move over the last `mins` minutes of 1-minute closes (ascending time). */
export function recentMove(t: number[], c: (number | null)[], mins = 15): { pts: number; pct: number; from: number; to: number } | null {
  let j = c.length - 1;
  while (j >= 0 && c[j] == null) j--;
  if (j < 0) return null;
  const endT = t[j], to = c[j] as number;
  let i = j;
  while (i > 0 && t[i - 1] >= endT - mins * 60000) i--;
  let from: number | null = null;
  for (let k = i; k <= j && from == null; k++) from = c[k];
  if (from == null || i === j) return null;
  return { pts: to - from, pct: ((to - from) / from) * 100, from, to };
}

// one alert per story: headlines about the same company / theme share a topic
const TOPICS: [RegExp, string][] = [
  [/\b(nvidia|nvda|jensen huang|huang)\b/i, 'nvidia'], [/\b(apple|aapl|tim cook)\b/i, 'apple'], [/\b(microsoft|msft|nadella)\b/i, 'microsoft'],
  [/\b(amazon|amzn)\b/i, 'amazon'], [/\b(alphabet|google)\b/i, 'google'], [/\b(meta|zuckerberg)\b/i, 'meta'], [/\b(tesla|tsla|elon musk|musk)\b/i, 'tesla'],
  [/\b(broadcom|avgo)\b/i, 'broadcom'], [/\b(openai)\b/i, 'openai'], [/\b(amd)\b/i, 'amd'], [/\b(netflix)\b/i, 'netflix'],
  [/\b(fed|fomc|powell|rate cuts?|rate hikes?|interest rates?)\b/i, 'fed'], [/\b(cpi|ppi|pce|inflation)\b/i, 'inflation'],
  [/\b(jobs report|payrolls|unemployment|jobless)\b/i, 'jobs'], [/\b(tariffs?|trade war|trade deal)\b/i, 'tariffs'],
  [/\b(rbi|reserve bank of india|repo rate)\b/i, 'rbi'], [/\b(sensex|nifty|dalal street)\b/i, 'nifty'], [/\b(rupee)\b/i, 'rupee'],
  [/\b(bank of canada|boc|macklem)\b/i, 'boc'], [/\b(tsx|bay street)\b/i, 'tsx'], [/\b(loonie|canadian dollar)\b/i, 'cad'],
  [/\b(ipos?|gmp|grey[- ]market|gray[- ]market|listing gains?|allotment|price band)\b/i, 'ipo'],
  [/\b(oil|crude|opec|brent)\b/i, 'oil'], [/\b(adani)\b/i, 'adani'], [/\b(reliance)\b/i, 'reliance'],
];
/** Short chart label for a topic ("nvidia" -> "NVDA"). */
export const TOPIC_LABEL: Record<string, string> = {
  nvidia: 'NVDA', apple: 'AAPL', microsoft: 'MSFT', amazon: 'AMZN', google: 'GOOGL', meta: 'META', tesla: 'TSLA', broadcom: 'AVGO',
  openai: 'OpenAI', amd: 'AMD', netflix: 'NFLX', fed: 'Fed', inflation: 'Inflation', jobs: 'Jobs', tariffs: 'Tariffs',
  rbi: 'RBI', nifty: 'Nifty', rupee: 'Rupee', boc: 'BoC', tsx: 'TSX', cad: 'CAD', oil: 'Oil', adani: 'Adani', reliance: 'Reliance', ipo: 'IPO',
};
/** Which country a headline is about, from its words, else the feed's country. */
export function headlineRegion(title: string, feedRegion: 'US' | 'IN' | 'CA'): 'US' | 'IN' | 'CA' {
  if (INDIA.test(title) || (INDIA_CO.test(title) && !MEGA.test(title))) return 'IN';
  if (/\b(gmp|grey[- ]market|gray[- ]market|price band|allotment)\b/i.test(title) || /₹/.test(title)) return 'IN';
  if (CANADA.test(title) || (CANADA_CO.test(title) && !MEGA.test(title))) return 'CA';
  if (MACRO.test(title) || MEGA.test(title) || /\b(nasdaq|s&p|dow|wall street)\b/i.test(title)) return 'US';
  return feedRegion;
}
/** Google News titles end with " - Publisher": split them. */
export function splitPublisher(title: string): { title: string; publisher: string | null } {
  const m = /^(.*\S)\s+-\s+([^-]{2,60})$/.exec(title);
  return m ? { title: m[1], publisher: m[2].trim() } : { title, publisher: null };
}
/** Topic of a headline ("nvidia", "fed", ...) or a per-headline key when none matches. */
export function headlineTopic(title: string): string {
  for (const [re, t] of TOPICS) if (re.test(title)) return t;
  return `h${headlineKey(title)}`;
}
