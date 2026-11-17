// Clock helpers for the market chart. Bars are stored in UTC; the chart can show
// New York time (ET) or BC time (fixed UTC-7). Session logic is always ET.

export type Clock = 'ET' | 'BC';
export const TZ: Record<Clock, string> = { ET: 'America/New_York', BC: 'Etc/GMT+7' };

const HOUR = 3600000;
const DAY = 86400000;

const etParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const offsetByDay = new Map<number, number>();

/**
 * ET offset from UTC (ms, negative) at the given instant. Cached per UTC day and
 * sampled late in that day: clocks change on Sunday at 2am ET while the market is
 * shut, so every bar of a UTC day shares one offset.
 */
export function etOffset(ms: number): number {
  const day = Math.floor(ms / DAY);
  let off = offsetByDay.get(day);
  if (off === undefined) {
    const probe = day * DAY + 23 * HOUR;
    const p: Record<string, number> = {};
    for (const part of etParts.formatToParts(probe)) p[part.type] = Number(part.value);
    off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - probe;
    offsetByDay.set(day, off);
  }
  return off;
}

export const clockOffset = (ms: number, clock: Clock) => (clock === 'ET' ? etOffset(ms) : -7 * HOUR);

/** Minutes since midnight ET. */
export function etMinutes(ms: number): number {
  const t = ms + etOffset(ms);
  return Math.floor((((t % DAY) + DAY) % DAY) / 60000);
}

/** CME session day number (6pm ET -> 5pm ET, counted by the day it ends on). */
export function sessionDay(ms: number): number {
  return Math.floor((ms + etOffset(ms) + 6 * HOUR) / DAY);
}

export type SessionName = 'asia' | 'london' | 'ny' | null;
/** Asia 6pm-2am, London 2am-9:30am, New York 9:30am-4pm (all ET). */
export function sessionOf(ms: number): SessionName {
  const m = etMinutes(ms);
  if (m >= 1080 || m < 120) return 'asia';
  if (m < 570) return 'london';
  if (m < 960) return 'ny';
  return null;
}

/** A wall-clock date + time on the given clock -> UTC ms. */
export function wallToUtc(date: string, time: string, clock: Clock): number {
  const wall = Date.parse(`${date}T${time || '00:00'}:00Z`);
  if (Number.isNaN(wall)) return NaN;
  const guess = wall - clockOffset(wall, clock);
  return wall - clockOffset(guess, clock);
}

/** UTC ms -> 'YYYY-MM-DD HH:MM' (or with seconds) on the given clock. */
export function fmtWall(ms: number, clock: Clock, seconds = false): string {
  const iso = new Date(ms + clockOffset(ms, clock)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, seconds ? 19 : 16)}`;
}

export function utcLabel(ms: number, clock: Clock): string {
  const h = clockOffset(ms, clock) / HOUR;
  return `UTC${h >= 0 ? '+' : ''}${h}`;
}
