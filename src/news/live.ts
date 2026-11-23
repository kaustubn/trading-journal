// Live news for the News page and the alerts: upcoming market-moving events and filtered headlines.
//   Scheduled releases: FRED's public release calendar (one small page per release, refreshed every 6 hours) and the
//   Fed's FOMC calendar page; plus big-tech earnings (services/marketData) and anything imported into econ_events.
//   Headlines: US (CNBC, MarketWatch, Yahoo big tech, Google News), India (Economic Times, Mint, Business Standard,
//   Google News India) and Canada (CBC, BNN Bloomberg, Globe and Mail, Google News Canada) RSS, refreshed at most every
//   3 minutes, scored (shared/newsFeed); market-relevant ones are kept in news_items for the chart's history.
// Requests identify themselves honestly and stay few; ForexFactory is never fetched.
import {
  SCHEDULED, parseFredCalendar, parseFomc, parseRss, scoreHeadline, dedupe, IMPORTANT, recentMove, Scored,
  headlineRegion, splitPublisher, headlineTopic, headlineKey, scoreEconomy,
} from '../shared/newsFeed';
import pool from '../db';
import { utcToNy, nyToUtc, reactionFor, movePts } from '../shared/econCalendar';
import { reactions, listEvents } from './econEvents';
import { earnings, nqMinutes, MEGACAPS } from '../services/marketData';

const UA = 'trading-journal/1.0 (personal news calendar)';
async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

export interface UpEvent {
  id: string; utc: string; ny_date: string; ny_time: string;
  title: string; kind: 'data' | 'fed' | 'earnings' | 'imported'; impact: 'high' | 'medium';
  why: string; nq: { absMed15: number; up15: number } | null; source: string;
}

let sched: { at: number; events: UpEvent[]; errors: string[] } = { at: 0, events: [], errors: [] };
let loading: Promise<void> | null = null;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function loadScheduled(): Promise<void> {
  const now = Date.now();
  const vs = day(now - 86400000), ve = day(now + 60 * 86400000);
  const errors: string[] = [];
  const t = reactions();
  const nqOf = (study: string | null) => {
    const r = study ? reactionFor(t, study) : null;
    return r ? { absMed15: movePts(r, 15), up15: r.up15 } : null;
  };
  const events: UpEvent[] = [];
  await Promise.all(SCHEDULED.map(async s => {
    try {
      const html = await getText(`https://fred.stlouisfed.org/releases/calendar?rid=${s.rid}&vs=${vs}&ve=${ve}`);
      for (const r of parseFredCalendar(html).filter(x => x.rid === s.rid)) {
        const ny = utcToNy(Date.parse(r.utc));
        events.push({ id: `fred:${s.rid}:${r.date}`, utc: r.utc, ny_date: ny.date, ny_time: ny.time, title: s.label, kind: 'data',
          impact: s.impact, why: s.why, nq: nqOf(s.study), source: 'FRED release calendar' });
      }
    } catch (e) { errors.push(`${s.label}: ${(e as Error).message}`); }
  }));
  try {
    const fomc = parseFomc(await getText('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'));
    for (const f of fomc) {
      const ms = Date.parse(f.utc);
      if (ms < now - 86400000 || ms > now + 60 * 86400000) continue;
      const ny = utcToNy(ms);
      events.push({ id: `fomc:${f.date}`, utc: f.utc, ny_date: ny.date, ny_time: ny.time, title: `Fed rate decision (FOMC)${f.projections ? ' + projections' : ''}`,
        kind: 'fed', impact: 'high', why: 'Rate decision at 2:00, Powell press conference at 2:30 New York. Big two-way swings.',
        nq: nqOf('Federal Funds Rate'), source: 'federalreserve.gov' });
    }
  } catch (e) { errors.push(`FOMC: ${(e as Error).message}`); }
  if (events.length || !sched.events.length) sched = { at: Date.now(), events, errors };
  else sched = { ...sched, at: Date.now() - 5 * 3600000, errors };   // keep the old list, retry in an hour
}

/** Market-moving events from `fromMs` to `toMs`, soonest first. */
/** withDb false: official calendars only (the alert tick uses this so the database can stay asleep). */
export async function upcoming(fromMs: number, toMs: number, withDb = true): Promise<{ events: UpEvent[]; errors: string[] }> {
  if (Date.now() - sched.at > 6 * 3600000) {
    if (!loading) loading = loadScheduled().catch(() => { /* errors kept in sched */ }).finally(() => { loading = null; });
    await loading;
  }
  const out = sched.events.filter(e => { const ms = Date.parse(e.utc); return ms >= fromMs && ms < toMs; });
  const errors = [...sched.errors];
  // events imported into the journal's calendar (ForexFactory file) that the official lists do not cover
  if (withDb) try {
    const imp = await listEvents(fromMs, toMs, ['high']);
    for (const e of imp) {
      if (e.currency !== 'USD') continue;
      if (out.some(o => Math.abs(Date.parse(o.utc) - Date.parse(e.release_utc)) < 60000)) continue;
      out.push({ id: `imp:${e.id}`, utc: e.release_utc, ny_date: e.ny_date, ny_time: e.ny_time, title: e.title, kind: 'imported', impact: 'high',
        why: [e.forecast ? `forecast ${e.forecast}` : '', e.previous ? `previous ${e.previous}` : ''].filter(Boolean).join(', ') || 'From your imported calendar.',
        nq: e.nq ? { absMed15: e.nq.absMed15, up15: e.nq.up15 } : null, source: 'your imported calendar' });
    }
  } catch { /* the calendar table is optional */ }
  // big-tech earnings: before the open = 8:00 New York, after the close = 16:05 (exact minute unknown)
  if (withDb) try {
    const er = await earnings();
    for (const x of er.events as { symbol: string; day: string; timing: string | null }[]) {
      const [y, mo, d] = x.day.split('-').map(Number);
      const before = /before|pre|bmo/i.test(x.timing ?? '');
      const ms = nyToUtc(y, mo, d, before ? 8 : 16, before ? 0 : 5);
      if (ms < fromMs || ms >= toMs) continue;
      const ny = utcToNy(ms);
      out.push({ id: `earn:${x.symbol}:${x.day}`, utc: new Date(ms).toISOString(), ny_date: ny.date, ny_time: ny.time,
        title: `${x.symbol} earnings (${before ? 'before the open' : 'after the close'})`, kind: 'earnings',
        impact: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL'].includes(x.symbol) ? 'high' : 'medium',
        why: 'Big Nasdaq weight: a surprise moves NQ overnight / at the open. Date from the Nasdaq calendar; confirm on the company site.',
        nq: null, source: 'Nasdaq earnings calendar' });
    }
  } catch (e) { errors.push(`earnings: ${(e as Error).message}`); }
  out.sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc) || (a.impact === 'high' ? -1 : 1));
  return { events: out, errors };
}

// ------------------------------------------------------------------ headlines
type Region = 'US' | 'IN' | 'CA';
const GN = (hl: string, gl: string) => `https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=${hl}&gl=${gl}&ceid=${gl}:${hl.split('-')[0]}`;
const FEEDS: { url: string; source: string; region: Region; google?: boolean }[] = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC', region: 'US' },
  { url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${MEGACAPS.slice(0, 8).join(',')}&region=US&lang=en-US`, source: 'Yahoo Finance', region: 'US' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse', source: 'MarketWatch', region: 'US' },
  { url: GN('en-US', 'US'), source: 'Google News US', region: 'US', google: true },
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', source: 'Economic Times', region: 'IN' },
  { url: 'https://www.livemint.com/rss/markets', source: 'Mint', region: 'IN' },
  { url: 'https://www.business-standard.com/rss/markets-106.rss', source: 'Business Standard', region: 'IN' },
  { url: GN('en-IN', 'IN'), source: 'Google News India', region: 'IN', google: true },
  // IPOs and the grey market premium (GMP)
  { url: 'https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/14655708.cms', source: 'Economic Times IPO', region: 'IN' },
  { url: 'https://news.google.com/rss/search?q=IPO+GMP+OR+%22grey+market%22+when:2d&hl=en-IN&gl=IN&ceid=IN:en', source: 'Google News IPO', region: 'IN', google: true },
  { url: 'https://www.cbc.ca/webfeed/rss/rss-business', source: 'CBC', region: 'CA' },
  { url: 'https://www.bnnbloomberg.ca/arc/outboundfeeds/rss/category/markets/?outputType=xml', source: 'BNN Bloomberg', region: 'CA' },
  { url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/', source: 'Globe and Mail', region: 'CA' },
  { url: GN('en-CA', 'CA'), source: 'Google News Canada', region: 'CA', google: true },
];
export type RegionHeadline = Scored & { also: number; region: Region; topic: string };

// Google News asks for few requests: each of its feeds is read at most every 15 minutes, one after another, and after
// a "too many requests" answer it is left alone for an hour (its last items are reused meanwhile).
const feedMem = new Map<string, { at: number; until: number; items: ReturnType<typeof parseRss> }>();
async function feedItems(f: { url: string; source: string; google?: boolean }, i: number) {
  const m = feedMem.get(f.url), now = Date.now();
  if (m && (now < m.until || (f.google && now - m.at < 15 * 60000))) return m.items;
  if (f.google) await new Promise(r => setTimeout(r, 2000 * FEEDS.filter((x, k) => x.google && k < i).length));   // Google feeds 2 s apart
  try {
    const items = parseRss(await getText(f.url), f.source);
    feedMem.set(f.url, { at: now, until: 0, items });
    return items;
  } catch (e) {
    if (/HTTP 429/.test((e as Error).message)) feedMem.set(f.url, { at: now, until: now + 3600000, items: m?.items ?? [] });
    throw e;
  }
}
let heads: { at: number; list: RegionHeadline[]; errors: string[] } = { at: 0, list: [], errors: [] };
let headLoading: Promise<void> | null = null;
const stored = new Set<string>();          // keys already written to news_items by this process
export async function headlines(): Promise<{ list: RegionHeadline[]; important: number; errors: string[]; at: string }> {
  if (Date.now() - heads.at > 3 * 60000) {
    if (!headLoading) headLoading = (async () => {
      const errors: string[] = []; const all: (Scored & { region: Region })[] = [];
      await Promise.all(FEEDS.map(async (f, i) => {
        try {
          for (const h of await feedItems(f, i)) {
            const sp = f.google ? splitPublisher(h.title) : { title: h.title, publisher: null };
            const it = { ...h, title: sp.title, source: sp.publisher ? `${sp.publisher} (Google News)` : f.source };
            all.push({ ...scoreHeadline(it), region: headlineRegion(it.title, f.region) });
          }
        } catch (e) { errors.push(`${f.source}: ${(e as Error).message}`); }
      }));
      const cut = Date.now() - 36 * 3600000;
      const list = (dedupe(all.filter(h => h.pub >= cut && h.pub <= Date.now() + 600000 && h.score >= 3)) as (Scored & { also: number; region: Region })[])
        .slice(0, 150).map(h => ({ ...h, topic: headlineTopic(h.title) }));
      heads = { at: Date.now(), list: list.length || !heads.list.length ? list : heads.list, errors };
      await keep(list).catch(e => errors.push(`store: ${(e as Error).message}`));
    })().finally(() => { headLoading = null; });
    await headLoading;
  }
  return { list: heads.list, important: IMPORTANT, errors: heads.errors, at: new Date(heads.at).toISOString() };
}

/** Write new market-relevant headlines (score 4+) to news_items, once each; one small INSERT per refresh. */
async function keep(list: RegionHeadline[]) {
  const fresh = list.filter(h => h.score >= 4 && !stored.has(headlineKey(h.title)));
  if (!fresh.length) return;
  const vals: unknown[] = [], rows: string[] = [];
  for (const h of fresh.slice(0, 80)) {
    const k = headlineKey(h.title);
    stored.add(k);
    const i = vals.length;
    rows.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$${i + 7},$${i + 8},$${i + 9})`);
    vals.push(k, new Date(h.pub).toISOString(), h.title.slice(0, 400), h.link || null, h.source.slice(0, 80), h.region, h.topic.slice(0, 40), h.score, 1 + h.also);
  }
  await pool.query(`INSERT INTO news_items (key, ts, title, link, source, region, topic, score, feeds) VALUES ${rows.join(',')}
    ON CONFLICT (key) DO UPDATE SET feeds = GREATEST(news_items.feeds, EXCLUDED.feeds), score = GREATEST(news_items.score, EXCLUDED.score)`, vals);
  if (stored.size > 20000) stored.clear();
}

// ------------------------------------------------------------------ the real economy, per country
const ECON_FEEDS: { url: string; source: string; region: Region; google?: boolean }[] = [
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', source: 'CNBC Economy', region: 'US' },
  { url: 'https://news.google.com/rss/search?q=US+economy+OR+inflation+OR+jobs+OR+tariffs+OR+%22federal+budget%22+when:2d&hl=en-US&gl=US&ceid=US:en', source: 'Google News US economy', region: 'US', google: true },
  { url: 'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms', source: 'Economic Times Economy', region: 'IN' },
  { url: 'https://www.livemint.com/rss/economy', source: 'Mint Economy', region: 'IN' },
  { url: 'https://www.business-standard.com/rss/economy-102.rss', source: 'Business Standard Economy', region: 'IN' },
  { url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/economy/', source: 'Globe and Mail Economy', region: 'CA' },
  { url: 'https://www.cbc.ca/webfeed/rss/rss-canada', source: 'CBC Canada', region: 'CA' },
  { url: 'https://www.cbc.ca/webfeed/rss/rss-business', source: 'CBC Business', region: 'CA' },
  { url: 'https://news.google.com/rss/search?q=Canada+economy+OR+inflation+OR+jobs+OR+%22Bank+of+Canada%22+OR+tariffs+OR+housing+OR+budget+when:2d&hl=en-CA&gl=CA&ceid=CA:en', source: 'Google News Canada economy', region: 'CA', google: true },
];
export type EconItem = Scored & { also: number; region: Region };
let econ: { at: number; list: EconItem[]; errors: string[] } = { at: 0, list: [], errors: [] };
let econLoading: Promise<void> | null = null;
/** Economy news of the last 48 hours per country (not markets), refreshed at most every 10 minutes. */
export async function economyNews(): Promise<{ list: EconItem[]; errors: string[]; at: string }> {
  if (Date.now() - econ.at > 10 * 60000) {
    if (!econLoading) econLoading = (async () => {
      const errors: string[] = []; const all: (Scored & { region: Region })[] = [];
      await Promise.all(ECON_FEEDS.map(async (f, i) => {
        try {
          for (const h of await feedItems(f, i)) {
            const sp = f.google ? splitPublisher(h.title) : { title: h.title, publisher: null };
            const it = { ...h, title: sp.title, source: sp.publisher ? `${sp.publisher} (Google News)` : f.source };
            all.push({ ...scoreEconomy(it), region: f.region });
          }
        } catch (e) { errors.push(`${f.source}: ${(e as Error).message}`); }
      }));
      const cut = Date.now() - 48 * 3600000;
      const deduped = dedupe(all.filter(h => h.pub >= cut && h.pub <= Date.now() + 600000 && h.score >= 3)) as EconItem[];
      const list = (['US', 'IN', 'CA'] as Region[]).flatMap(r => deduped.filter(h => h.region === r).sort((a, b) => b.score + b.also - (a.score + a.also) || b.pub - a.pub).slice(0, 25));
      econ = { at: Date.now(), list: list.length || !econ.list.length ? list : econ.list, errors };
    })().finally(() => { econLoading = null; });
    await econLoading;
  }
  return { list: econ.list, errors: econ.errors, at: new Date(econ.at).toISOString() };
}

/** Stored headlines between two times (chart history), strongest first per 15 minutes. */
export async function storedHeadlines(fromMs: number, toMs: number, minScore = 5): Promise<{ ts: string; title: string; link: string | null; source: string; region: Region; topic: string; score: number; feeds: number }[]> {
  const r = await pool.query(
    `SELECT ts, title, link, source, region, topic, score, feeds FROM news_items
     WHERE ts >= $1 AND ts < $2 AND (score >= $3 OR (score >= $3 - 1 AND feeds >= 3)) ORDER BY ts LIMIT 3000`,
    [new Date(fromMs).toISOString(), new Date(toMs).toISOString(), minScore]);
  return r.rows.map(x => ({ ...x, ts: new Date(x.ts).toISOString() }));
}

/** NQ's last-15-minute move, or null when the feed has nothing. */
let fast: { at: number; v: ReturnType<typeof recentMove> } = { at: 0, v: null };
export async function nqFastMove(): Promise<ReturnType<typeof recentMove>> {
  if (Date.now() - fast.at < 60000) return fast.v;
  const m = await nqMinutes();
  fast = { at: Date.now(), v: recentMove(m.t, m.c, 15) };
  return fast.v;
}
