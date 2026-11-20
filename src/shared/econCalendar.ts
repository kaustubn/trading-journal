// Economic calendar: pure helpers shared by the server, the client and the tests (no I/O).
//   - Reads calendar files: a ForexFactory weekly export (JSON with UTC offsets, or CSV), a ForexFactory history
//     CSV (Date,Time,Currency,Impact,Event,Actual,Forecast,Previous; London time), or a release_datetime_et CSV.
//   - Converts New York / London wall-clock times to UTC with the US / UK daylight-saving rules (no tz database
//     needed, so it behaves the same on every machine).
//   - Matches an event title to the "what NQ usually does" study (nqReactions.json).

export type Impact = 'high' | 'medium' | 'low';
export interface EconEvent {
  release_utc: string;           // ISO, UTC
  title: string;
  currency: string;
  impact: Impact;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}
export type FileTz = 'auto' | 'ny' | 'london' | 'utc';

// ------------------------------------------------------------------ time zones
const nthSunday = (y: number, m: number, n: number) => { const d = new Date(Date.UTC(y, m - 1, 1)); return 1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1); };
const lastSunday = (y: number, m: number) => { const d = new Date(Date.UTC(y, m, 0)); return d.getUTCDate() - d.getUTCDay(); };

/** UTC ms of a New York wall-clock time (US DST: 2nd Sunday of March to 1st Sunday of November, 2:00). */
export function nyToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const start = Date.UTC(y, 2, nthSunday(y, 3, 2), 2), end = Date.UTC(y, 10, nthSunday(y, 11, 1), 2);
  return local + (local >= start && local < end ? 4 : 5) * 3600000;
}
/** UTC ms of a London wall-clock time (UK summer time: last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC). */
export function londonToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const start = Date.UTC(y, 2, lastSunday(y, 3), 2), end = Date.UTC(y, 9, lastSunday(y, 10), 2);
  return local - (local >= start && local < end ? 3600000 : 0);
}
/** New York wall clock for a UTC instant: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function utcToNy(ms: number): { date: string; time: string } {
  const edt = new Date(ms - 4 * 3600000);
  const y = edt.getUTCFullYear(), mo = edt.getUTCMonth() + 1, d = edt.getUTCDate(), h = edt.getUTCHours(), mi = edt.getUTCMinutes();
  const isDst = nyToUtc(y, mo, d, h, mi) === ms;     // the EDT reading round-trips only when DST is in force
  const t = isDst ? edt : new Date(ms - 5 * 3600000);
  return { date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16) };
}

// ------------------------------------------------------------------ CSV
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) out.push(row);
  return out;
}

const impactOf = (s: string): Impact | null => {
  const t = s.trim().toLowerCase();
  if (t.startsWith('high')) return 'high';
  if (t.startsWith('med')) return 'medium';
  if (t.startsWith('low')) return 'low';
  return null;   // holiday / non-economic
};
const val = (s: string | undefined) => { const t = (s ?? '').trim(); return t ? t.slice(0, 40) : null; };

/** '8:30am' / '08:30' / '14:00' / '2:00pm' -> [h, m] or null ('All Day', 'Tentative', ''). */
export function parseClock(s: string): [number, number] | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h < 24 && mi < 60 ? [h, mi] : null;
}
/** 'YYYY-MM-DD' or 'MM-DD-YYYY' or 'MM/DD/YYYY' -> [y, m, d] or null. */
export function parseDay(s: string): [number, number, number] | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return [Number(m[3]), Number(m[1]), Number(m[2])];
  return null;
}

function toUtc(day: [number, number, number], clock: [number, number], tz: Exclude<FileTz, 'auto'>): number {
  const [y, mo, d] = day, [h, mi] = clock;
  if (tz === 'ny') return nyToUtc(y, mo, d, h, mi);
  if (tz === 'london') return londonToUtc(y, mo, d, h, mi);
  return Date.UTC(y, mo - 1, d, h, mi);
}

export interface ParseResult { format: string; tz: string; events: EconEvent[]; skipped: number; errors: string[] }

/**
 * Reads any of the supported calendar files. `tz` is used for CSV files whose times have no offset;
 * 'auto' = London for the ForexFactory history CSV, New York for release_datetime_et, UTC for the weekly CSV.
 * Keeps one currency (default USD) and drops holidays / all-day items.
 */
export function parseEventsFile(text: string, tz: FileTz = 'auto', currency = 'USD'): ParseResult {
  const errors: string[] = [];
  let skipped = 0;
  const keep = (c: string) => !currency || c.trim().toUpperCase() === currency;
  const t = text.trim();
  // ForexFactory weekly JSON: [{title, country, date: '2026-11-25T08:30:00-05:00', impact, forecast, previous}]
  if (t.startsWith('[')) {
    let arr: any[];
    try { arr = JSON.parse(t); } catch { return { format: 'json', tz: 'offset', events: [], skipped: 0, errors: ['The file is not valid JSON.'] }; }
    const events: EconEvent[] = [];
    for (const x of arr) {
      const imp = impactOf(String(x?.impact ?? ''));
      const when = Date.parse(String(x?.date ?? ''));
      if (!imp || !Number.isFinite(when) || !keep(String(x?.country ?? x?.currency ?? ''))) { skipped++; continue; }
      events.push({ release_utc: new Date(when).toISOString(), title: String(x.title ?? '').trim().slice(0, 160), currency: currency || String(x.country),
        impact: imp, actual: val(x.actual), forecast: val(x.forecast), previous: val(x.previous) });
    }
    return { format: 'ForexFactory weekly JSON', tz: 'offset in file', events, skipped, errors };
  }
  const rows = parseCsv(t);
  if (rows.length < 2) return { format: 'csv', tz, events: [], skipped: 0, errors: ['The file has no data rows.'] };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map(n => head.indexOf(n)).find(i => i >= 0) ?? -1;
  const events: EconEvent[] = [];
  let format = '', zone: Exclude<FileTz, 'auto'> = 'utc';
  if (col('release_datetime_et') >= 0) {
    format = 'release_datetime_et CSV'; zone = tz === 'auto' ? 'ny' : tz;
    const [cT, cTi, cA, cF, cP, cI, cC] = [col('release_datetime_et'), col('title'), col('actual'), col('forecast'), col('previous'), col('impact'), col('currency')];
    for (const r of rows.slice(1)) {
      const [dPart, tPart] = (r[cT] ?? '').trim().split(/[ T]/);
      const day = parseDay(dPart ?? ''), clock = parseClock(tPart ?? '');
      if (!day || !clock || (cC >= 0 && !keep(r[cC] ?? ''))) { skipped++; continue; }
      const imp = cI >= 0 ? impactOf(r[cI] ?? '') : 'high';
      if (!imp) { skipped++; continue; }
      events.push({ release_utc: new Date(toUtc(day, clock, zone)).toISOString(), title: (r[cTi] ?? '').trim().slice(0, 160), currency: currency || 'USD', impact: imp,
        actual: val(r[cA]), forecast: val(r[cF]), previous: val(r[cP]) });
    }
  } else if (col('event') >= 0 && col('currency') >= 0 && col('date') >= 0) {
    format = 'ForexFactory history CSV'; zone = tz === 'auto' ? 'london' : tz;
    const [cD, cTm, cCu, cI, cE, cA, cF, cP, cL] = [col('date'), col('time'), col('currency'), col('impact'), col('event'), col('actual'), col('forecast'), col('previous'), col('time_label')];
    for (const r of rows.slice(1)) {
      if (cL >= 0 && (r[cL] ?? '').trim()) { skipped++; continue; }    // All Day / Tentative
      const day = parseDay(r[cD] ?? ''), clock = parseClock(r[cTm] ?? ''), imp = impactOf(r[cI] ?? '');
      if (!day || !clock || !imp || !keep(r[cCu] ?? '')) { skipped++; continue; }
      events.push({ release_utc: new Date(toUtc(day, clock, zone)).toISOString(), title: (r[cE] ?? '').trim().slice(0, 160), currency: currency || (r[cCu] ?? '').trim(), impact: imp,
        actual: val(r[cA]), forecast: val(r[cF]), previous: val(r[cP]) });
    }
  } else if (col('title') >= 0 && col('country') >= 0 && col('date') >= 0) {
    format = 'ForexFactory weekly CSV'; zone = tz === 'auto' ? 'utc' : tz;
    const [cTi, cCo, cD, cTm, cI, cF, cP, cA] = [col('title'), col('country'), col('date'), col('time'), col('impact'), col('forecast'), col('previous'), col('actual')];
    for (const r of rows.slice(1)) {
      const day = parseDay(r[cD] ?? ''), clock = parseClock(r[cTm] ?? ''), imp = impactOf(r[cI] ?? '');
      if (!day || !clock || !imp || !keep(r[cCo] ?? '')) { skipped++; continue; }
      events.push({ release_utc: new Date(toUtc(day, clock, zone)).toISOString(), title: (r[cTi] ?? '').trim().slice(0, 160), currency: currency || (r[cCo] ?? '').trim(), impact: imp,
        actual: cA >= 0 ? val(r[cA]) : null, forecast: val(r[cF]), previous: val(r[cP]) });
    }
  } else {
    errors.push('Unknown file. Expected a ForexFactory weekly export (JSON or CSV), a ForexFactory history CSV (Date, Time, Currency, Impact, Event, …) or a CSV with release_datetime_et, title, actual, forecast, previous.');
    format = 'unknown';
  }
  return { format, tz: zone, events: events.filter(e => e.title), skipped, errors };
}

// ------------------------------------------------------------------ numbers + "beat / miss"
/** '0.3%' -> 0.3, '256K' -> 256000, '-1.2B' -> -1.2e9; text -> null. */
export function parseValue(s: string | null | undefined): number | null {
  if (s == null) return null;
  let t = String(s).trim().replace(/,/g, '').replace(/−/g, '-').replace(/^[<>~\s]+/, '');
  if (!t) return null;
  let mult = 1;
  t = t.replace(/%$/, '');
  const suf = t.slice(-1).toUpperCase();
  if ('KMBT'.includes(suf) && t.length > 1) { mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suf as 'K']; t = t.slice(0, -1); }
  t = t.replace(/%$/, '');
  const v = Number(t);
  return Number.isFinite(v) && t !== '' ? v * mult : null;
}
/** Actual vs forecast: 'above' | 'below' | 'inline' | null (not released / no forecast). */
export function surpriseSign(actual: string | null, forecast: string | null): 'above' | 'below' | 'inline' | null {
  const a = parseValue(actual), f = parseValue(forecast);
  if (a == null || f == null) return null;
  return a > f ? 'above' : a < f ? 'below' : 'inline';
}

// ------------------------------------------------------------------ "what NQ usually does"
export interface ReactionBucket { n: number; up15: number; med15: number; held60: number | null }
export interface Reaction {
  title: string; n: number;
  absMed1: number; absMed15: number; absMed60: number;   // median size of the move (points, either direction)
  up15: number;                                          // % of releases where NQ was higher 15 minutes later
  buckets: Partial<Record<'above' | 'below' | 'inline', ReactionBucket>>;
}
export type ReactionTable = { period: string; source: string; events: Record<string, Reaction> };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Finds the study row for a title (exact first, then the same words in any order). */
export function reactionFor(table: ReactionTable | null | undefined, title: string): Reaction | null {
  if (!table) return null;
  const hit = table.events[title];
  if (hit) return hit;
  const n = norm(title);
  for (const [k, v] of Object.entries(table.events)) if (norm(k) === n) return v;
  return null;
}
/** One plain-English line about the study for an event (and, after the release, its surprise). */
export function reactionLine(r: Reaction | null, surprise: 'above' | 'below' | 'inline' | null = null): string {
  if (!r) return 'No NQ history for this event yet.';
  const base = `NQ, last ${r.n} releases: median move ${r.absMed1.toFixed(0)} pts in 1 min, ${r.absMed15.toFixed(0)} pts by 15 min`;
  const dir = Math.abs(r.up15 - 50) >= 15 ? `; up after 15 min ${r.up15.toFixed(0)}% of the time` : '; direction about a coin flip';
  const b = surprise ? r.buckets[surprise] : null;
  const s = b && b.n >= 5
    ? `. When it came in ${surprise === 'above' ? 'above' : surprise === 'below' ? 'below' : 'in line with'} forecast (${b.n} times): up after 15 min ${b.up15.toFixed(0)}%`
    : '';
  return base + dir + s + '.';
}
