// Backtest session timing rules, as pure functions (unit-tested in tests/btSessions.test.ts).
// The server is the source of truth: the browser sends deltas every ~30 s; the server decides what counts.

export const LOCK_SEC = 90;        // a tab keeps the timer for 90 s after its last heartbeat
export const STALE_SEC = 30 * 60;  // a session with no heartbeat for 30 min is closed at its last heartbeat
export const MIN_CAP_SEC = 45;     // a beat may always carry up to 45 s ...
export const SLACK_SEC = 5;        // ... or the real time since the previous beat + 5 s, whichever is larger

export type Status = 'running' | 'paused' | 'idle' | 'stopped';

export interface SessionState {
  status: Status;
  last_seq: number;
  last_beat_at: Date;
  lock_tab: string | null;
  lock_until: Date | null;
}

export interface Beat {
  tabId: string;
  seq: number;
  activeSec: number;
  idleSec: number;
  pauseSec: number;
  status?: Status;
}

export type LockState = 'mine' | 'free' | 'other';

export function lockState(s: Pick<SessionState, 'lock_tab' | 'lock_until'>, tabId: string, now: Date): LockState {
  if (!s.lock_tab || !s.lock_until || s.lock_until.getTime() <= now.getTime()) return 'free';
  return s.lock_tab === tabId ? 'mine' : 'other';
}

export function isStale(s: Pick<SessionState, 'status' | 'last_beat_at'>, now: Date): boolean {
  return s.status !== 'stopped' && now.getTime() - s.last_beat_at.getTime() > STALE_SEC * 1000;
}

const clampSec = (x: unknown): number => {
  const n = Math.floor(Number(x));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface BeatResult {
  ok: boolean;
  reason?: 'stopped' | 'locked' | 'duplicate' | 'bad';
  add: { active: number; idle: number; pause: number };
  /** Active seconds per UTC minute (epoch ms of the minute start), counted backwards from `now`. */
  minutes: { minute: number; sec: number }[];
}

/**
 * Decide what a heartbeat adds.
 * - Only the tab holding the lock (or any tab when the lock is free) may write.
 * - seq must move forward; a repeated or older seq adds nothing (no double counting on retries).
 * - The total of one beat can't exceed the real time since the previous beat (+5 s slack), with a 45 s floor,
 *   so a tab that was offline can hand in the time it really spent, but never more than wall-clock time.
 *   Over-long beats are scaled down proportionally.
 */
export function acceptBeat(s: SessionState, beat: Beat, now: Date): BeatResult {
  const none = { active: 0, idle: 0, pause: 0 };
  if (!beat || typeof beat.tabId !== 'string' || !beat.tabId || !Number.isInteger(beat.seq)) return { ok: false, reason: 'bad', add: none, minutes: [] };
  if (s.status === 'stopped') return { ok: false, reason: 'stopped', add: none, minutes: [] };
  if (lockState(s, beat.tabId, now) === 'other') return { ok: false, reason: 'locked', add: none, minutes: [] };
  if (beat.seq <= s.last_seq) return { ok: false, reason: 'duplicate', add: none, minutes: [] };

  let active = clampSec(beat.activeSec), idle = clampSec(beat.idleSec), pause = clampSec(beat.pauseSec);
  const elapsed = Math.max(0, Math.round((now.getTime() - s.last_beat_at.getTime()) / 1000));
  const cap = Math.max(MIN_CAP_SEC, elapsed + SLACK_SEC);
  const total = active + idle + pause;
  if (total > cap) {
    const k = cap / total;
    active = Math.floor(active * k); idle = Math.floor(idle * k); pause = Math.floor(pause * k);
  }
  return { ok: true, add: { active, idle, pause }, minutes: spreadBackwards(active, now) };
}

/** Put `sec` seconds into the UTC minutes that end at `now`, newest minute first. */
export function spreadBackwards(sec: number, now: Date): { minute: number; sec: number }[] {
  const out: { minute: number; sec: number }[] = [];
  let left = sec, t = now.getTime();
  while (left > 0) {
    const minuteStart = Math.floor((t - 1) / 60000) * 60000; // the minute that contains the second ending at t
    const room = Math.max(1, Math.round((t - minuteStart) / 1000));
    const take = Math.min(left, room);
    const prev = out.find(m => m.minute === minuteStart);
    if (prev) prev.sec += take; else out.push({ minute: minuteStart, sec: take });
    left -= take;
    t = minuteStart;
  }
  return out;
}

/**
 * Manual edit: scale the stored minute buckets so they add up to the new active total
 * (keeps the shape of the session; rounding remainder goes to the last bucket).
 */
export function rescaleMinutes(minutes: { minute: number; sec: number }[], newActive: number): { minute: number; sec: number }[] {
  const total = minutes.reduce((a, m) => a + m.sec, 0);
  if (!minutes.length || total <= 0) return [];
  const k = Math.max(0, newActive) / total;
  const out = minutes.map(m => ({ minute: m.minute, sec: Math.floor(m.sec * k) }));
  const diff = Math.max(0, Math.round(newActive)) - out.reduce((a, m) => a + m.sec, 0);
  out[out.length - 1].sec += diff;
  return out.filter(m => m.sec > 0);
}
