// Live news for the News page and the alerts: upcoming market-moving events and filtered headlines.
//   Scheduled releases: FRED's public release calendar (one small page per release, refreshed every 6 hours) and the
//   Fed's FOMC calendar page; plus big-tech earnings (services/marketData) and anything imported into econ_events.
//   Headlines: CNBC top news + Yahoo Finance big-tech RSS, refreshed at most every 3 minutes, scored (shared/newsFeed).
// Requests identify themselves honestly and stay few; ForexFactory is never fetched.
import {
  SCHEDULED, parseFredCalendar, parseFomc, parseRss, scoreHeadline, dedupe, IMPORTANT, recentMove, Scored,
} from '../shared/newsFeed';
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
const FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${MEGACAPS.slice(0, 8).join(',')}&region=US&lang=en-US`, source: 'Yahoo Finance' },
];
let heads: { at: number; list: (Scored & { also: number })[]; errors: string[] } = { at: 0, list: [], errors: [] };
let headLoading: Promise<void> | null = null;
export async function headlines(): Promise<{ list: (Scored & { also: number })[]; important: number; errors: string[]; at: string }> {
  if (Date.now() - heads.at > 3 * 60000) {
    if (!headLoading) headLoading = (async () => {
      const errors: string[] = []; const all: Scored[] = [];
      await Promise.all(FEEDS.map(async f => {
        try { all.push(...parseRss(await getText(f.url), f.source).map(scoreHeadline)); } catch (e) { errors.push(`${f.source}: ${(e as Error).message}`); }
      }));
      const cut = Date.now() - 36 * 3600000;
      const list = dedupe(all.filter(h => h.pub >= cut && h.score >= 3)).slice(0, 60);
      heads = { at: Date.now(), list: list.length || !heads.list.length ? list : heads.list, errors };
    })().finally(() => { headLoading = null; });
    await headLoading;
  }
  return { list: heads.list, important: IMPORTANT, errors: heads.errors, at: new Date(heads.at).toISOString() };
}

/** NQ's last-15-minute move, or null when the feed has nothing. */
let fast: { at: number; v: ReturnType<typeof recentMove> } = { at: 0, v: null };
export async function nqFastMove(): Promise<ReturnType<typeof recentMove>> {
  if (Date.now() - fast.at < 60000) return fast.v;
  const m = await nqMinutes();
  fast = { at: Date.now(), v: recentMove(m.t, m.c, 15) };
  return fast.v;
}
