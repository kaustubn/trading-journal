// Free, delayed market context for the pre-market panel and the earnings strip.
//   - Quotes: Yahoo Finance chart API (no key; ~10-15 min delayed for futures). Cached 60 s in market_cache.
//   - Earnings dates for the stocks that move NQ most: Nasdaq's public earnings calendar (one request per weekday),
//     rescanned at most every 12 hours, stored in earnings_events. A failed source never breaks the page: the last
//     good data is returned with a note.
import pool from '../db';
import { utcToNy } from '../shared/econCalendar';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
export const MEGACAPS = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AVGO', 'TSLA', 'NFLX', 'COST', 'AMD'];
const CONTEXT = [
  { sym: 'NQ=F', label: 'NQ (Nasdaq 100 fut.)' }, { sym: 'ES=F', label: 'ES (S&P 500 fut.)' }, { sym: '^VIX', label: 'VIX' },
  { sym: 'DX-Y.NYB', label: 'Dollar index' }, { sym: '^TNX', label: '10-year yield' }, { sym: 'CL=F', label: 'Crude oil' },
];

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function cached<T>(key: string, maxAgeSec: number, load: () => Promise<T>): Promise<{ data: T; fetchedAt: string; stale?: string }> {
  const c = await pool.query('SELECT data, fetched_at FROM market_cache WHERE key = $1', [key]);
  const row = c.rows[0];
  if (row && Date.now() - new Date(row.fetched_at).getTime() < maxAgeSec * 1000) return { data: row.data, fetchedAt: new Date(row.fetched_at).toISOString() };
  try {
    const data = await load();
    await pool.query(`INSERT INTO market_cache (key, data, fetched_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()`, [key, JSON.stringify(data)]);
    return { data, fetchedAt: new Date().toISOString() };
  } catch (e) {
    if (row) return { data: row.data, fetchedAt: new Date(row.fetched_at).toISOString(), stale: (e as Error).message };
    throw e;
  }
}

// ------------------------------------------------------------------ quotes
export interface Quote { sym: string; label: string; last: number | null; ref: number | null; chg: number | null; chgPct: number | null; session: string }
interface Bars { t: number[]; o: (number | null)[]; h: (number | null)[]; l: (number | null)[]; c: (number | null)[] }

async function yahoo(sym: string, range = '2d', interval = '5m'): Promise<{ meta: any; bars: Bars }> {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}&includePrePost=true`);
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(`no data for ${sym}`);
  const q = res.indicators?.quote?.[0] ?? {};
  return { meta: res.meta, bars: { t: (res.timestamp ?? []).map((x: number) => x * 1000), o: q.open ?? [], h: q.high ?? [], l: q.low ?? [], c: q.close ?? [] } };
}

/** Last price vs the right reference: yesterday's close during the regular session, else the last regular close. */
export function quoteFrom(sym: string, label: string, meta: any, bars: Bars, now = Date.now()): Quote {
  let lastBar: number | null = null;
  for (let i = bars.c.length - 1; i >= 0; i--) if (bars.c[i] != null) { lastBar = bars.c[i] as number; break; }
  const reg = meta?.currentTradingPeriod?.regular;
  const inRegular = reg && now >= reg.start * 1000 && now <= reg.end * 1000;
  const isFuture = meta?.instrumentType === 'FUTURE';
  let last: number | null, ref: number | null, session: string;
  if (isFuture || inRegular) { last = meta?.regularMarketPrice ?? lastBar; ref = meta?.previousClose ?? meta?.chartPreviousClose ?? null; session = isFuture ? 'futures' : 'regular'; }
  else { last = lastBar ?? meta?.regularMarketPrice ?? null; ref = meta?.regularMarketPrice ?? null; session = now < (reg?.start ?? 0) * 1000 ? 'pre-market' : 'after hours'; }
  const chg = last != null && ref != null ? last - ref : null;
  return { sym, label, last, ref, chg, chgPct: chg != null && ref ? (100 * chg) / ref : null, session };
}

/** NQ levels: yesterday's New York session (9:30-16:00 ET) high / low / close and the overnight range since 18:00 ET. */
export function nqLevels(bars: Bars, now = Date.now(), quoteLast: number | null = null) {
  const today = utcToNy(now).date;
  let rthDay = '', rthH = -Infinity, rthL = Infinity, rthC: number | null = null;
  // the most recent New York session that has finished (or today's if it is running)
  const rows = bars.t.map((t, i) => ({ t, ny: utcToNy(t), o: bars.o[i], h: bars.h[i], l: bars.l[i], c: bars.c[i] })).filter(r => r.c != null);
  const rth = rows.filter(r => r.ny.time >= '09:30' && r.ny.time < '16:00');
  const days = [...new Set(rth.map(r => r.ny.date))].sort();
  rthDay = days.filter(d => d < today).pop() ?? days.pop() ?? '';
  for (const r of rth.filter(x => x.ny.date === rthDay)) { rthH = Math.max(rthH, r.h ?? -Infinity); rthL = Math.min(rthL, r.l ?? Infinity); rthC = r.c; }
  // overnight: bars after that session's close
  const after = rows.filter(r => r.ny.date > rthDay || (r.ny.date === rthDay && r.ny.time >= '16:00'));
  const onH = after.length ? Math.max(...after.map(r => r.h ?? -Infinity)) : null;
  const onL = after.length ? Math.min(...after.map(r => r.l ?? Infinity)) : null;
  // the quote's last trade (same number as the NQ tile); the last 5-minute bar can lag it
  const last = quoteLast ?? (rows.length ? rows[rows.length - 1].c : null);
  return {
    rthDay, rthHigh: Number.isFinite(rthH) ? rthH : null, rthLow: Number.isFinite(rthL) ? rthL : null, rthClose: rthC,
    onHigh: onH, onLow: onL, last, gap: last != null && rthC != null ? last - rthC : null,
  };
}

export async function premarket() {
  return cached('premarket_v2', 60, async () => {
    const syms = [...CONTEXT, ...MEGACAPS.slice(0, 8).map(s => ({ sym: s, label: s }))];
    const got = await Promise.allSettled(syms.map(s => yahoo(s.sym)));
    const quotes: Quote[] = [];
    let nq: ReturnType<typeof nqLevels> | null = null;
    got.forEach((g, i) => {
      if (g.status !== 'fulfilled') { quotes.push({ sym: syms[i].sym, label: syms[i].label, last: null, ref: null, chg: null, chgPct: null, session: 'unavailable' }); return; }
      quotes.push(quoteFrom(syms[i].sym, syms[i].label, g.value.meta, g.value.bars));
      if (syms[i].sym === 'NQ=F') nq = nqLevels(g.value.bars, Date.now(), g.value.meta?.regularMarketPrice ?? null);
    });
    if (got.every(g => g.status !== 'fulfilled')) throw new Error('Yahoo Finance did not answer');
    return { quotes, nq, note: 'Yahoo Finance, delayed (futures ~10 min). NQ=F is the front-month continuous contract.' };
  });
}

// ------------------------------------------------------------------ earnings
const TIMING: Record<string, string> = { 'time-pre-market': 'before the open', 'time-after-hours': 'after the close', 'time-not-supplied': 'time not given' };
let scanning: Promise<void> | null = null;

async function scanEarnings(days = 45): Promise<void> {
  const want = new Set(MEGACAPS);
  const start = new Date(Date.now() - 2 * 86400000);
  let ok = 0;
  for (let i = 0; i <= days + 2; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const w = d.getUTCDay();
    if (w === 0 || w === 6) continue;
    const day = d.toISOString().slice(0, 10);
    try {
      const j = await getJson(`https://api.nasdaq.com/api/calendar/earnings?date=${day}`, { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' });
      ok++;
      for (const r of j?.data?.rows ?? []) {
        if (!want.has(String(r.symbol))) continue;
        await pool.query(`INSERT INTO earnings_events (symbol, report_date, timing, eps_forecast, fetched_at) VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (symbol, report_date) DO UPDATE SET timing = EXCLUDED.timing, eps_forecast = EXCLUDED.eps_forecast, fetched_at = NOW()`,
          [r.symbol, day, TIMING[r.time] ?? r.time ?? null, r.epsForecast || null]);
      }
    } catch { /* one bad day does not stop the scan */ }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ok) throw new Error('Nasdaq earnings calendar did not answer');
  await pool.query(`INSERT INTO market_cache (key, data, fetched_at) VALUES ('earnings_scan', '{}', NOW())
    ON CONFLICT (key) DO UPDATE SET fetched_at = NOW()`);
}

/** Upcoming big-tech earnings (from 2 days ago). Starts a background rescan when the data is older than 12 hours. */
export async function earnings(force = false) {
  const s = await pool.query(`SELECT fetched_at FROM market_cache WHERE key = 'earnings_scan'`);
  const age = s.rows[0] ? Date.now() - new Date(s.rows[0].fetched_at).getTime() : Infinity;
  let note: string | undefined;
  if (force || age > 12 * 3600000) {
    if (!scanning) scanning = scanEarnings().catch(e => { note = (e as Error).message; }).finally(() => { scanning = null; });
    if (!s.rows[0] || force) await scanning;          // first time: wait so the list is not empty
  }
  const r = await pool.query(`SELECT symbol, to_char(report_date, 'YYYY-MM-DD') AS day, timing, eps_forecast
    FROM earnings_events WHERE report_date >= (NOW() AT TIME ZONE 'America/New_York')::date - 2 ORDER BY report_date, symbol`);
  const scan = await pool.query(`SELECT fetched_at FROM market_cache WHERE key = 'earnings_scan'`);
  return { symbols: MEGACAPS, events: r.rows, checkedAt: scan.rows[0]?.fetched_at ?? null, note,
    source: 'Nasdaq earnings calendar (dates can move; confirm on the company site).' };
}

/** NQ futures 1-minute closes for today (Yahoo), for the "fast move" alert. */
export async function nqMinutes(): Promise<{ t: number[]; c: (number | null)[] }> {
  const { bars } = await yahoo('NQ=F', '1d', '1m');
  return { t: bars.t, c: bars.c };
}

// ---- exchange rates to CAD (Kay withdraws in Canadian dollars), cached 6 hours ----
let fx: { at: number; rates: { USD: number; INR: number; CAD: number }; live: boolean } | null = null;
/** How many CAD one unit of each currency is worth. Falls back to rough rates when Yahoo is unreachable. */
export async function cadRates(): Promise<{ rates: { USD: number; INR: number; CAD: number }; live: boolean; at: number }> {
  if (fx && Date.now() - fx.at < 6 * 3600000) return fx;
  try {
    const [usdcad, usdinr] = await Promise.all([yahoo('USDCAD=X', '5d', '1d'), yahoo('INR=X', '5d', '1d')]);
    const a = Number(usdcad.meta?.regularMarketPrice), b = Number(usdinr.meta?.regularMarketPrice);
    if (!(a > 0.5 && a < 3) || !(b > 30 && b < 300)) throw new Error('rate out of range');
    fx = { at: Date.now(), rates: { USD: a, INR: a / b, CAD: 1 }, live: true };
  } catch {
    fx = { at: Date.now() - 5.5 * 3600000, rates: fx?.rates ?? { USD: 1.38, INR: 0.0157, CAD: 1 }, live: false };   // retry in 30 min
  }
  return fx;
}
