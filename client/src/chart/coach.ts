// Practice coach for replay (and forward testing): the trader's own written rules,
// checked instantly in the browser. Claude's reviews (server: /api/coach/replay) come on top.
import type { ClosedTrade, OrderInput, Position } from './replay';
import { etMinutes, sessionDay } from './time';
import { POINT_VALUE } from './drawings';

export type AiMode = 'off' | 'ask' | 'trades';
export interface Window { from: string; to: string; }   // 'HH:MM' ET
export interface CoachRules {
  enabled: boolean;
  pauseOnBreak: boolean;     // pause replay and ask before a rule-breaking order
  windows: Window[];         // prime-time windows (ET); empty = any time
  minRR: number;             // reward:risk at entry
  maxRiskUsd: number;        // $ at risk per trade (0 = no cap)
  maxTradesPerDay: number;   // 0 = no cap
  maxLossesPerDay: number;   // stop trading after this many losers (0 = no cap)
  dailyLossUsd: number;      // stop trading after this $ loss in a day (0 = no cap)
  cooldownMin: number;       // minutes to wait after a loss (0 = none)
  requireSetup: boolean;     // entry must name a setup
  noWidenStop: boolean;      // moving the stop further away is a rule break
  ai: AiMode;                // Claude: off, only when asked, or review every entry and exit
}
export const DEFAULT_RULES: CoachRules = {
  enabled: true,
  pauseOnBreak: true,
  windows: [{ from: '09:30', to: '11:30' }, { from: '15:00', to: '16:00' }],
  minRR: 2,
  maxRiskUsd: 500,
  maxTradesPerDay: 3,
  maxLossesPerDay: 2,
  dailyLossUsd: 1000,
  cooldownMin: 10,
  requireSetup: true,
  noWidenStop: true,
  ai: 'ask',
};

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
export function mergeRules(saved: any): CoachRules {
  const r: CoachRules = JSON.parse(JSON.stringify(DEFAULT_RULES));
  if (!saved || typeof saved !== 'object') return r;
  for (const k of ['enabled', 'pauseOnBreak', 'requireSetup', 'noWidenStop'] as const) if (typeof saved[k] === 'boolean') r[k] = saved[k];
  for (const k of ['minRR', 'maxRiskUsd', 'maxTradesPerDay', 'maxLossesPerDay', 'dailyLossUsd', 'cooldownMin'] as const) {
    const v = Number(saved[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 100000) r[k] = v;
  }
  if (Array.isArray(saved.windows)) {
    r.windows = saved.windows.filter((w: any) => hhmm.test(w?.from) && hhmm.test(w?.to)).slice(0, 4);
  }
  if (saved.ai === 'off' || saved.ai === 'ask' || saved.ai === 'trades') r.ai = saved.ai;
  return r;
}

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export const fmtWindows = (w: Window[]) => (w.length ? w.map(x => `${x.from}–${x.to}`).join(', ') : 'any time');

/** Trades closed on the same trading day as `t` (6pm ET roll). */
export function tradesToday(trades: ClosedTrade[], t: number): ClosedTrade[] {
  const day = sessionDay(t);
  return trades.filter(x => sessionDay(x.entryTime) === day);
}

/** Rules an order would break, as short sentences. Empty = fine. */
export function checkOrder(rules: CoachRules, o: OrderInput, now: number, trades: ClosedTrade[]): string[] {
  if (!rules.enabled) return [];
  const out: string[] = [];
  const m = etMinutes(now);
  if (rules.windows.length && !rules.windows.some(w => m >= toMin(w.from) && m < toMin(w.to))) {
    out.push(`Outside your prime-time windows (${fmtWindows(rules.windows)} ET).`);
  }
  const reward = o.targetUnit === 'R' ? o.stopPts * o.target : o.target;
  const rr = o.stopPts > 0 ? reward / o.stopPts : 0;
  if (rules.minRR > 0 && rr + 1e-9 < rules.minRR) out.push(`Reward:risk is ${rr.toFixed(2)} — your minimum is ${rules.minRR}.`);
  const risk = o.stopPts * POINT_VALUE[o.contract] * o.qty;
  if (rules.maxRiskUsd > 0 && risk > rules.maxRiskUsd) out.push(`Risk is $${risk.toFixed(0)} — your cap is $${rules.maxRiskUsd}.`);
  if (rules.requireSetup && !o.setup) out.push('No setup chosen. Name the setup (S1/S2/S3/ORB) or don\'t take it.');
  const today = tradesToday(trades, now);
  if (rules.maxTradesPerDay > 0 && today.length >= rules.maxTradesPerDay) out.push(`Already ${today.length} trades today — your max is ${rules.maxTradesPerDay}.`);
  const losers = today.filter(t => t.pnl < 0);
  if (rules.maxLossesPerDay > 0 && losers.length >= rules.maxLossesPerDay) out.push(`${losers.length} losing trades today — your rule is to stop after ${rules.maxLossesPerDay}.`);
  const dayPnl = today.reduce((s, t) => s + t.pnl, 0);
  if (rules.dailyLossUsd > 0 && dayPnl <= -rules.dailyLossUsd) out.push(`Down $${Math.abs(dayPnl).toFixed(0)} today — your daily stop is $${rules.dailyLossUsd}.`);
  const lastLoss = [...today].reverse().find(t => t.pnl < 0);
  if (rules.cooldownMin > 0 && lastLoss && now - lastLoss.exitTime < rules.cooldownMin * 60000) {
    const left = Math.ceil((rules.cooldownMin * 60000 - (now - lastLoss.exitTime)) / 60000);
    out.push(`Only ${Math.round((now - lastLoss.exitTime) / 60000)} min since a loss — wait ${left} more min (cooldown ${rules.cooldownMin} min). Revenge-trade risk.`);
  }
  return out;
}

/** After a trade closes: should the session stop? (daily stop / loss count) */
export function checkAfterClose(rules: CoachRules, now: number, trades: ClosedTrade[]): string[] {
  if (!rules.enabled) return [];
  const today = tradesToday(trades, now);
  const out: string[] = [];
  const losers = today.filter(t => t.pnl < 0).length;
  if (rules.maxLossesPerDay > 0 && losers >= rules.maxLossesPerDay) out.push(`That's ${losers} losing trades today — your rule says stop for the day.`);
  const dayPnl = today.reduce((s, t) => s + t.pnl, 0);
  if (rules.dailyLossUsd > 0 && dayPnl <= -rules.dailyLossUsd) out.push(`Daily stop hit: down $${Math.abs(dayPnl).toFixed(0)} (limit $${rules.dailyLossUsd}).`);
  if (rules.maxTradesPerDay > 0 && today.length >= rules.maxTradesPerDay) out.push(`Trade limit reached (${today.length}/${rules.maxTradesPerDay}) — no more entries today.`);
  return out;
}

/** Stop moved further from entry than it was. */
export function widenedStop(p: Position, newStop: number): boolean {
  return Math.abs(p.entry - newStop) > Math.abs(p.entry - p.stop) + 1e-9;
}
