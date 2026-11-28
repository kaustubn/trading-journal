// Eval Guard: prop-firm evaluation progress computed from the broker's END-OF-DAY closing balances.
// The closing balance the trader types from the broker (e.g. Tradovate) is the source of truth; the journal's
// own P&L is only compared against it. Pure (no imports) so the server and the browser share it.
// All arithmetic is done in whole cents. Tested in tests/evalGuard.test.ts.

export interface EvalConfig {
  start: number;                 // starting balance, dollars
  target: number;                // profit target, dollars
  maxLoss: number;               // max loss limit: distance below the highest end-of-day close
  lockTrigger: number | null;    // once an end-of-day close reaches this balance ...
  lockFloor: number | null;      // ... the floor stops rising at this balance
  consistencyPct: number | null; // largest day must be <= this % of total profit (null = no rule)
  dailyLossLimit: number | null; // firm daily loss limit, positive dollars (null = off)
  dailyStop: number | null;      // personal daily stop, positive dollars (null = off)
}

export interface DailyClose { day: string; balance: number }   // day = 'YYYY-MM-DD'

export interface EvalToday {
  day: string;          // the trading day the status is for
  pnl: number | null;   // live P&L for that day from the journal (null = unknown); ignored when a close exists for the day
}

export type GuardStatus = 'PUSH' | 'CAUTION' | 'DONE_TODAY' | 'PASSED' | 'BREACHED';

export interface DayCheck {
  day: string;
  closePnl: number | null;    // change in closing balance vs the previous close (null = no close typed)
  journalPnl: number | null;  // journal net P&L for the day (null = no journal trades)
  gap: number | null;         // closePnl − journalPnl
  flagged: boolean;           // |gap| > $5, or journal trades with no close typed
}

export interface EvalStatus {
  status: GuardStatus;
  reasons: string[];
  balance: number;            // last close + today's live P&L (if today's close is not typed yet)
  lastClose: number;
  profit: number;             // balance − start
  highestClose: number;
  floor: number;              // max-loss floor
  floorLocked: boolean;
  buffer: number;             // balance − floor
  largestDay: number;         // largest winning day so far, today included
  requiredTotal: number;      // max(target, largestDay ÷ consistency%)
  toTarget: number;           // requiredTotal − profit (≤ 0 means met)
  todayPnl: number | null;
  todayFromClose: boolean;    // true when today's P&L comes from a typed close (truth) rather than the journal
  todayCap: number | null;    // most today can make before requiredTotal rises (null = no consistency rule)
  todayRoom: number | null;   // todayCap − todayPnl
  greenStreak: number;        // consecutive winning days ending at the last completed day (today excluded)
  daysTraded: number;
  breachDay: string | null;   // first end-of-day close at or below the floor
  checks: DayCheck[];         // close vs journal comparison, newest first
}

const GAP_CENTS = 500;
const cents = (dollars: number) => Math.round(dollars * 100);
const dollars = (c: number) => c / 100;
const positive = (x: number | null | undefined) => x != null && Number.isFinite(x) && x > 0;

export function validConfig(cfg: EvalConfig): boolean {
  return positive(cfg.start) && positive(cfg.maxLoss) && Number.isFinite(cfg.target) && cfg.target >= 0 &&
    (cfg.consistencyPct == null || (cfg.consistencyPct > 0 && cfg.consistencyPct <= 100)) &&
    (cfg.lockTrigger == null) === (cfg.lockFloor == null);
}

/**
 * Evaluation status from end-of-day closes.
 * - Floor = highest end-of-day close − maxLoss; once a close reaches lockTrigger the floor stops at lockFloor.
 * - Breach = an end-of-day close at or below the floor that stood before that close (or today's live balance at/below it).
 * - requiredTotal = max(target, largestDay ÷ consistency%): one big day raises the profit you need.
 * - todayCap = max(consistency% × target, largest earlier day): today can make up to this without raising requiredTotal.
 * Returns null for an invalid config.
 */
export function computeEvalStatus(cfg: EvalConfig, closes: readonly DailyClose[], today: EvalToday,
  journalByDay: Readonly<Record<string, number>> = {}): EvalStatus | null {
  if (!validConfig(cfg)) return null;
  const start = cents(cfg.start), mll = cents(cfg.maxLoss), target = cents(cfg.target);
  const lockTrigger = cfg.lockTrigger == null ? null : cents(cfg.lockTrigger);
  const lockFloor = cfg.lockFloor == null ? null : cents(cfg.lockFloor);
  const floorFrom = (highest: number) => {
    const trailing = highest - mll;
    return lockTrigger !== null && lockFloor !== null && highest >= lockTrigger ? Math.min(trailing, lockFloor) : trailing;
  };

  const sorted = [...closes].filter(c => Number.isFinite(c.balance)).sort((a, b) => a.day.localeCompare(b.day));
  let prev = start, highest = start, breachDay: string | null = null;
  const days: { day: string; pnl: number }[] = [];
  for (const close of sorted) {
    const balance = cents(close.balance);
    if (breachDay === null && balance <= floorFrom(highest)) breachDay = close.day;
    days.push({ day: close.day, pnl: balance - prev });
    highest = Math.max(highest, balance);
    prev = balance;
  }
  const lastClose = prev;
  const floor = floorFrom(highest);
  const floorLocked = lockTrigger !== null && highest >= lockTrigger;

  const todayClose = days.find(d => d.day === today.day);
  const todayFromClose = !!todayClose;
  const todayPnl = todayClose ? todayClose.pnl : today.pnl != null && Number.isFinite(today.pnl) ? cents(today.pnl) : null;
  const balance = todayClose ? lastClose : lastClose + (todayPnl ?? 0);
  const earlier = days.filter(d => d.day < today.day);

  const largestEarlier = Math.max(0, ...earlier.map(d => d.pnl));
  const largestDay = Math.max(largestEarlier, todayPnl ?? 0);
  const pct = cfg.consistencyPct;
  const requiredTotal = pct ? Math.max(target, Math.ceil(largestDay * 100 / pct)) : target;
  const profit = balance - start;
  const todayCap = pct ? Math.max(Math.floor(target * pct / 100), largestEarlier) : null;
  const todayRoom = todayCap !== null && todayPnl !== null ? todayCap - todayPnl : null;

  let greenStreak = 0;
  for (let i = earlier.length - 1; i >= 0 && earlier[i].pnl > 0; i--) greenStreak++;

  const reasons: string[] = [];
  let status: GuardStatus = 'PUSH';
  const buffer = balance - floor;
  if (breachDay !== null || buffer <= 0) {
    status = 'BREACHED';
    reasons.push(breachDay !== null ? `Close on ${breachDay} was at or below the max-loss floor.` : 'Balance is at or below the max-loss floor.');
  } else if (target > 0 && profit >= requiredTotal) {
    status = 'PASSED';
    reasons.push('Profit meets the required total by your closes. Confirm in the firm dashboard before stopping.');
  } else {
    const stops: string[] = [];
    if (todayCap !== null && todayPnl !== null && todayPnl >= todayCap)
      stops.push(`Today is at the consistency cap (${fmt(todayCap)}). More profit today raises your target.`);
    if (positive(cfg.dailyStop) && todayPnl !== null && todayPnl <= -cents(cfg.dailyStop!))
      stops.push(`Personal daily stop hit (−${fmt(cents(cfg.dailyStop!))}).`);
    if (positive(cfg.dailyLossLimit) && todayPnl !== null && todayPnl <= -cents(cfg.dailyLossLimit!))
      stops.push(`Firm daily loss limit hit (−${fmt(cents(cfg.dailyLossLimit!))}).`);
    if (stops.length) { status = 'DONE_TODAY'; reasons.push(...stops); }
    else {
      if (greenStreak >= 3) reasons.push(`${greenStreak} green days in a row. This is where you have given it back before: smaller size, A+ setups only.`);
      if (buffer < mll / 4) reasons.push(`Only ${fmt(buffer)} above the max-loss floor.`);
      if (reasons.length) status = 'CAUTION';
    }
  }

  // Close vs journal: every day with a close or journal trades, except the open day without a close.
  const closePnl = new Map(days.map(d => [d.day, d.pnl]));
  const allDays = new Set([...closePnl.keys(), ...Object.keys(journalByDay)]);
  const checks: DayCheck[] = [...allDays].filter(day => closePnl.has(day) || day < today.day).sort().reverse().map(day => {
    const close = closePnl.has(day) ? closePnl.get(day)! : null;
    const journal = Object.prototype.hasOwnProperty.call(journalByDay, day) && Number.isFinite(journalByDay[day])
      ? cents(journalByDay[day]) : null;
    const gap = close !== null && journal !== null ? close - journal : null;
    return { day, closePnl: close === null ? null : dollars(close), journalPnl: journal === null ? null : dollars(journal),
      gap: gap === null ? null : dollars(gap), flagged: close === null ? journal !== null && journal !== 0 : gap !== null && Math.abs(gap) > GAP_CENTS };
  });

  return {
    status, reasons,
    balance: dollars(balance), lastClose: dollars(lastClose), profit: dollars(profit),
    highestClose: dollars(highest), floor: dollars(floor), floorLocked, buffer: dollars(buffer),
    largestDay: dollars(largestDay), requiredTotal: dollars(requiredTotal), toTarget: dollars(requiredTotal - profit),
    todayPnl: todayPnl === null ? null : dollars(todayPnl), todayFromClose,
    todayCap: todayCap === null ? null : dollars(todayCap), todayRoom: todayRoom === null ? null : dollars(todayRoom),
    greenStreak, daysTraded: days.length + (!todayClose && todayPnl !== null && todayPnl !== 0 ? 1 : 0),
    breachDay, checks,
  };
}

function fmt(c: number) {
  const sign = c < 0 ? '−' : '';
  return `${sign}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
