// Market sessions of a replayed NQ candle, by New York clock time. Used by the practice-session tracker so the
// Practice Log shows which part of the day was practised (the replay cursor's time, not the wall-clock time).

export const MARKET_SESSIONS = ['Asia', 'London', 'Pre-market', 'NY AM', 'NY lunch', 'NY PM', 'After hours'] as const;
export type MarketSession = typeof MARKET_SESSIONS[number];

// [start minute of the New York day, session]; each runs until the next start. Asia wraps past midnight.
const STARTS: [number, MarketSession][] = [
  [0, 'Asia'], [3 * 60, 'London'], [8 * 60, 'Pre-market'], [9 * 60 + 30, 'NY AM'],
  [12 * 60, 'NY lunch'], [13 * 60 + 30, 'NY PM'], [16 * 60, 'After hours'], [18 * 60, 'Asia'],
];

let fmt: Intl.DateTimeFormat | null = null;
/** Session of the candle at epoch milliseconds `ms` (New York time). */
export function marketSession(ms: number): MarketSession | null {
  if (!Number.isFinite(ms)) return null;
  fmt ??= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = fmt.formatToParts(new Date(ms));
  const h = Number(parts.find(p => p.type === 'hour')?.value), m = Number(parts.find(p => p.type === 'minute')?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const min = (h % 24) * 60 + m;
  let s: MarketSession = 'Asia';
  for (const [start, name] of STARTS) if (min >= start) s = name;
  return s;
}

/** Known session names from a list or a comma-separated string, in day order, without repeats. */
export function cleanSessions(v: unknown): MarketSession[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const set = new Set(list.map(x => String(x).trim().toLowerCase()));
  return MARKET_SESSIONS.filter(s => set.has(s.toLowerCase()));
}

/** Stored value (comma-separated, day order) after adding `add` to `current`; null when empty. */
export function mergeSessions(current: string | null | undefined, add: unknown): string | null {
  const all = cleanSessions([...cleanSessions(current ?? ''), ...cleanSessions(add)]);
  return all.length ? all.join(', ') : null;
}
