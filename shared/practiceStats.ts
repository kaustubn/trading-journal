// Practice log (Backtest Session Tracker) dashboard numbers — pure functions, tested in tests/practiceStats.test.ts.

export interface DayRow { d: string; sec: number }            // local date (YYYY-MM-DD) -> active seconds
export interface SessionRow {
  id: number; started_at: string; ended_at: string | null; status: string;
  active_sec: number; idle_sec: number; pause_sec: number; setup_tag: string | null;
  instrument: string | null; timeframe: string | null; hist_from: string | null; hist_to: string | null;
  trades_logged: number; edited: boolean; note: string | null; page?: string; mkt_sessions?: string | null;
}

const DAY = 86400000;
const toUtc = (d: string) => Date.parse(d + 'T00:00:00Z');
export const addDays = (d: string, n: number) => new Date(toUtc(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);

/** Monday of the week containing `d`. */
export function weekStart(d: string): string {
  const wd = new Date(toUtc(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((wd + 6) % 7));
}

export interface Kpis {
  todaySec: number; weekSec: number; monthSec: number; allSec: number;
  activeDays: number; calendarDays: number;
  avgActiveDaySec: number | null;    // over days with practice
  avgCalendarDaySec: number | null;  // over every day since the first practice day (incl. today)
  tradesPerHour: number | null;
  longest: SessionRow | null; shortest: SessionRow | null;
  currentStreak: number; bestStreak: number;
}

/** A day counts toward streaks with at least this much active time. */
export const STREAK_MIN_SEC = 60;

export function kpis(daily: DayRow[], sessions: SessionRow[], today: string): Kpis {
  const byDay = new Map(daily.map(r => [r.d, r.sec]));
  const sum = (pred: (d: string) => boolean) => daily.filter(r => pred(r.d)).reduce((a, r) => a + r.sec, 0);
  const wk = weekStart(today), mo = today.slice(0, 7);
  const allSec = sum(() => true);
  const activeDays = daily.filter(r => r.sec > 0).length;
  const first = daily.find(r => r.sec > 0)?.d ?? null;
  const calendarDays = first ? daysBetween(first, today) + 1 : 0;
  const trades = sessions.reduce((a, s) => a + (s.trades_logged || 0), 0);
  const sessSec = sessions.reduce((a, s) => a + (s.active_sec || 0), 0);
  const done = sessions.filter(s => s.status === 'stopped' && s.active_sec > 0);
  const longest = done.reduce<SessionRow | null>((m, s) => (!m || s.active_sec > m.active_sec ? s : m), null);
  const shortest = done.reduce<SessionRow | null>((m, s) => (!m || s.active_sec < m.active_sec ? s : m), null);
  // streaks: consecutive calendar days with >= STREAK_MIN_SEC; the current streak may end yesterday
  let best = 0, run = 0, prev: string | null = null;
  for (const r of daily.filter(x => x.sec >= STREAK_MIN_SEC)) {
    run = prev && daysBetween(prev, r.d) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = r.d;
  }
  let current = 0;
  let d = (byDay.get(today) ?? 0) >= STREAK_MIN_SEC ? today : addDays(today, -1);
  while ((byDay.get(d) ?? 0) >= STREAK_MIN_SEC) { current++; d = addDays(d, -1); }
  return {
    todaySec: byDay.get(today) ?? 0,
    weekSec: sum(x => x >= wk && x <= today),
    monthSec: sum(x => x.startsWith(mo)),
    allSec, activeDays, calendarDays,
    avgActiveDaySec: activeDays ? allSec / activeDays : null,
    avgCalendarDaySec: calendarDays ? allSec / calendarDays : null,
    tradesPerHour: sessSec >= 60 ? trades / (sessSec / 3600) : null,
    longest, shortest, currentStreak: current, bestStreak: best,
  };
}

/** GitHub-style grid: `weeks` columns ending with the week of `today`; level 0-4 by active minutes. */
export function heatmap(daily: DayRow[], today: string, weeks = 53): { d: string; sec: number; level: number; future: boolean }[][] {
  const byDay = new Map(daily.map(r => [r.d, r.sec]));
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  const cols: { d: string; sec: number; level: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const sec = byDay.get(d) ?? 0;
      const min = sec / 60;
      col.push({ d, sec, future: d > today, level: sec <= 0 ? 0 : min < 15 ? 1 : min < 45 ? 2 : min < 90 ? 3 : 4 });
    }
    cols.push(col);
  }
  return cols;
}

/** Active time per setup (sessions without a setup are grouped as "(no setup)"). */
export function timePerSetup(sessions: SessionRow[]): { setup: string; sec: number; sessions: number }[] {
  const m = new Map<string, { sec: number; sessions: number }>();
  for (const s of sessions) {
    const k = s.setup_tag?.trim() || '(no setup)';
    const v = m.get(k) ?? { sec: 0, sessions: 0 };
    v.sec += s.active_sec || 0; v.sessions++;
    m.set(k, v);
  }
  return [...m.entries()].map(([setup, v]) => ({ setup, ...v })).sort((a, b) => b.sec - a.sec);
}

export interface SessionFilter { from?: string; to?: string; setup?: string; instrument?: string; session?: string }
/** `startedLocal` turns a session's UTC start into a local date (the page passes one that uses the browser zone). */
export function filterSessions(rows: SessionRow[], f: SessionFilter, startedLocal: (iso: string) => string): SessionRow[] {
  return rows.filter(s => {
    const d = startedLocal(s.started_at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.setup && (s.setup_tag || '(no setup)') !== f.setup) return false;
    if (f.instrument && (s.instrument || '') !== f.instrument) return false;
    if (f.session && !(s.mkt_sessions || '').split(', ').includes(f.session)) return false;
    return true;
  });
}

const csvCell = (v: unknown) => `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`;
export function sessionsCsv(rows: SessionRow[], local: (iso: string) => string): string {
  const head = ['id', 'start (local)', 'end (local)', 'start (UTC)', 'end (UTC)', 'active min', 'idle min', 'paused min', 'setup', 'instrument',
    'timeframe', 'market sessions', 'tested from', 'tested to', 'trades logged', 'edited', 'note'];
  const lines = rows.map(s => [s.id, local(s.started_at), s.ended_at ? local(s.ended_at) : '', s.started_at, s.ended_at ?? '',
    (s.active_sec / 60).toFixed(1), (s.idle_sec / 60).toFixed(1), (s.pause_sec / 60).toFixed(1), s.setup_tag, s.instrument, s.timeframe,
    s.mkt_sessions ?? '', s.hist_from, s.hist_to, s.trades_logged, s.edited ? 'yes' : '', s.note].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\n');
}
