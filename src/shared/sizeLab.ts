// Size & Pass Lab: play a strategy's research trades through a prop evaluation with the size rules you choose.
// Pure (no imports except the drawdown type): used by the browser page and tested in tests/sizeLab.test.ts.
//
// Every number is editable on the page because the right size is not known yet. Nothing here is advice; it
// replays past trades. Two ways to judge an account + size:
//   historical: start a fresh evaluation at the first trading day of every month and play the real trades in order
//   bootstrap : shuffle whole trading days (keeps each day's trades together) thousands of times
import type { DdType } from './propRules';

/** [date ET, entry minute ET, dir, risk pts, gross R, worst adverse move pts, news 0/1] */
export type LabTrade = [string, number, number, number, number, number, number];

export interface Account {
  start: number; target: number; maxDd: number; ddType: DdType; lockAtStart: boolean;
  dailyLoss: number | null; dailyLossFails: boolean;      // firm daily loss: ends the day, or fails the account
  consistencyPct: number | null;                         // best day must be <= this % of total profit to pass
  minDays: number | null; maxContracts: number;           // max contracts of the chosen size (NQ or MNQ)
}
export type SizeMode = 'fixed' | 'risk' | 'pctRoom';
export interface Sizing {
  contract: 'NQ' | 'MNQ';
  mode: SizeMode; contracts: number; riskUsd: number; pctRoom: number;   // fixed N / $ risk per trade / % of drawdown room left
  maxStopUsd: number | null;                              // skip trades whose stop (1 contract) is wider than this
  halveAfterLosses: number;                               // 0 = off; after N losses in a row, half size until a win
  myDailyStop: number | null; myDailyTarget: number | null; maxTradesDay: number | null;
}
export interface Costs { commission: number; slipPts: number; }   // per contract round trip ($) / extra slippage per trade (pts)
export interface Filter { from: string; to: string; startMin: number; endMin: number; skipNews: boolean; }

export const POINT_VALUE = { NQ: 20, MNQ: 2 } as const;

export function filterTrades(trades: LabTrade[], f: Filter): LabTrade[] {
  return trades.filter(t => (!f.from || t[0] >= f.from) && (!f.to || t[0] <= f.to) && t[1] >= f.startMin && t[1] <= f.endMin && !(f.skipNews && t[6]));
}
/** Trades grouped by day, in date order. */
export function byDay(trades: LabTrade[]): LabTrade[][] {
  const out: LabTrade[][] = [];
  for (const t of trades) { const last = out[out.length - 1]; if (last && last[0][0] === t[0]) last.push(t); else out.push([t]); }
  return out;
}

/** Contracts for one trade (0 = skipped). room = $ left above the drawdown floor. */
export function contractsFor(t: LabTrade, s: Sizing, a: Account, lossStreak: number, room: number): number {
  const pv = POINT_VALUE[s.contract], stop1 = t[3] * pv;
  if (s.maxStopUsd && stop1 > s.maxStopUsd) return 0;
  let q = s.mode === 'fixed' ? s.contracts : s.mode === 'risk' ? Math.floor(s.riskUsd / stop1) : Math.floor((room * s.pctRoom / 100) / stop1);
  if (s.halveAfterLosses > 0 && lossStreak >= s.halveAfterLosses) q = Math.floor(q / 2);
  return Math.max(0, Math.min(q, a.maxContracts));
}
export function tradeUsd(t: LabTrade, q: number, s: Sizing, c: Costs) {
  const pv = POINT_VALUE[s.contract];
  return q * (t[4] * t[3] * pv - c.slipPts * pv - c.commission);
}

export interface EvalResult { result: 'pass' | 'fail' | 'open'; days: number; trades: number; profit: number; bestDay: number; why: string; endDate: string | null; }

/** One evaluation played through the given days in order. */
export function runEval(days: LabTrade[][], a: Account, s: Sizing, c: Costs): EvalResult {
  let eq = a.start, peakEod = a.start, peakIn = a.start, bestDay = 0, tradingDays = 0, trades = 0, streak = 0;
  const pv = POINT_VALUE[s.contract];
  const floorOf = () => {
    const pk = a.ddType === 'static' ? a.start : a.ddType === 'eod' ? peakEod : peakIn;
    let f = pk - a.maxDd; if (a.ddType !== 'static' && a.lockAtStart && f > a.start) f = a.start; return f;
  };
  for (const day of days) {
    let dayPnl = 0, n = 0, traded = false;
    for (const t of day) {
      if (s.maxTradesDay && n >= s.maxTradesDay) break;
      if (s.myDailyStop && dayPnl <= -s.myDailyStop) break;
      if (s.myDailyTarget && dayPnl >= s.myDailyTarget) break;
      if (a.dailyLoss && dayPnl <= -a.dailyLoss) break;
      const floor = floorOf(), q = contractsFor(t, s, a, streak, eq - floor);
      if (!q) continue;
      // worst moment while the trade was open (adverse move + costs) vs the floor
      const worst = eq - q * (t[5] * pv + c.slipPts * pv + c.commission);
      if (worst <= floor) return { result: 'fail', days: tradingDays + 1, trades: trades + 1, profit: worst - a.start, bestDay, why: 'hit the max drawdown', endDate: t[0] };
      const pnl = tradeUsd(t, q, s, c);
      eq += pnl; dayPnl += pnl; n++; trades++; traded = true;
      streak = pnl < 0 ? streak + 1 : 0;
      peakIn = Math.max(peakIn, eq);
      if (eq <= floorOf()) return { result: 'fail', days: tradingDays + 1, trades, profit: eq - a.start, bestDay, why: 'hit the max drawdown', endDate: t[0] };
      if (a.dailyLoss && dayPnl <= -a.dailyLoss && a.dailyLossFails) return { result: 'fail', days: tradingDays + 1, trades, profit: eq - a.start, bestDay, why: 'hit the daily loss limit', endDate: t[0] };
    }
    if (!traded) continue;
    tradingDays++;
    peakEod = Math.max(peakEod, eq);
    bestDay = Math.max(bestDay, dayPnl);
    const profit = eq - a.start;
    const consistent = !a.consistencyPct || profit <= 0 || bestDay <= (a.consistencyPct / 100) * profit;
    if (profit >= a.target && consistent && (!a.minDays || tradingDays >= a.minDays))
      return { result: 'pass', days: tradingDays, trades, profit, bestDay, why: 'reached the target', endDate: day[0][0] };
  }
  return { result: 'open', days: tradingDays, trades, profit: eq - a.start, bestDay, why: 'ran out of data', endDate: null };
}

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
const monthsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.44 * 864e5);

/** A fresh evaluation started on the first trade day of every month. */
export function historical(days: LabTrade[][], a: Account, s: Sizing, c: Costs) {
  const starts: number[] = [];
  for (let i = 0; i < days.length; i++) if (i === 0 || days[i][0][0].slice(0, 7) !== days[i - 1][0][0].slice(0, 7)) starts.push(i);
  const runs = starts.map(i => ({ start: days[i][0][0], ...runEval(days.slice(i), a, s, c) }));
  const done = runs.filter(r => r.result !== 'open');
  const pass = done.filter(r => r.result === 'pass'), fail = done.filter(r => r.result === 'fail');
  // every started evaluation counts: one still running when the data ends has not passed (yet)
  return {
    runs: runs.length, open: runs.length - done.length,
    passRate: runs.length ? pass.length / runs.length : NaN, failRate: runs.length ? fail.length / runs.length : NaN,
    monthsToPass: median(pass.map(r => monthsBetween(r.start, r.endDate!))), monthsToFail: median(fail.map(r => monthsBetween(r.start, r.endDate!))),
    tradesToPass: median(pass.map(r => r.trades)),
    failReasons: fail.reduce((m, r) => { m[r.why] = (m[r.why] || 0) + 1; return m; }, {} as Record<string, number>),
    list: runs,
  };
}

/** Random order of whole trading days; signal days per month converts days to months. */
export function bootstrap(days: LabTrade[][], a: Account, s: Sizing, c: Costs, runs = 2000, seed = 11) {
  if (!days.length) return { passRate: NaN, failRate: NaN, monthsToPass: NaN, monthsToFail: NaN, runs: 0 };
  let x = seed; const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const span = monthsBetween(days[0][0][0], days[days.length - 1][0][0]) || 1, perMonth = days.length / span;
  let pass = 0, fail = 0; const tp: number[] = [], tf: number[] = [];
  for (let r = 0; r < runs; r++) {
    const seq: LabTrade[][] = [];
    for (let k = 0; k < 1500; k++) seq.push(days[Math.floor(rnd() * days.length)]);
    const e = runEval(seq, a, s, c);
    if (e.result === 'pass') { pass++; tp.push(e.days / perMonth); } else if (e.result === 'fail') { fail++; tf.push(e.days / perMonth); }
  }
  return { passRate: pass / runs, failRate: fail / runs, monthsToPass: median(tp), monthsToFail: median(tf), runs };
}

/** The whole history at this size with no account limits (personal rules still apply): curve, drawdown, streaks, years. */
export function fullHistory(days: LabTrade[][], a: Account, s: Sizing, c: Costs) {
  let eq = 0, peak = 0, maxDd = 0, streak = 0, worstStreak = 0, taken = 0, skipped = 0, wins = 0;
  const curve: { d: string; eq: number }[] = []; const years: Record<string, { n: number; usd: number }> = {}; const per: number[] = [];
  for (const day of days) {
    let dayPnl = 0, n = 0;
    for (const t of day) {
      if (s.maxTradesDay && n >= s.maxTradesDay) break;
      if (s.myDailyStop && dayPnl <= -s.myDailyStop) break;
      if (s.myDailyTarget && dayPnl >= s.myDailyTarget) break;
      const q = contractsFor(t, s, a, streak, a.maxDd + Math.min(0, eq - peak));
      if (!q) { skipped++; continue; }
      const pnl = tradeUsd(t, q, s, c);
      eq += pnl; dayPnl += pnl; n++; taken++; per.push(pnl); if (pnl > 0) wins++;
      streak = pnl < 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak);
      peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq);
      const y = t[0].slice(0, 4); (years[y] ??= { n: 0, usd: 0 }); years[y].n++; years[y].usd += pnl;
    }
    curve.push({ d: day[0][0], eq });
  }
  return { totalUsd: eq, maxDdUsd: maxDd, worstLosingStreak: worstStreak, taken, skipped, winRate: taken ? wins / taken : NaN,
    avgUsd: taken ? eq / taken : NaN, curve, years: Object.entries(years).map(([y, v]) => ({ year: y, trades: v.n, usd: v.usd })) };
}

/**
 * Trades from a CSV so any strategy can be tested. Header names (any order, case-insensitive):
 *   date (YYYY-MM-DD, New York), time (HH:MM New York), dir (long/short/buy/sell/1/-1), stop_pts, r,
 *   optional adverse_pts (worst move against the trade while open) and news (0/1).
 * Without adverse_pts the open-trade drawdown check uses the stop for losers and 0 for winners.
 */
export function parseTradesCsv(text: string): { trades: LabTrade[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const errors: string[] = []; const trades: LabTrade[] = [];
  if (lines.length < 2) return { trades, errors: ['The file needs a header row and at least one trade.'] };
  const head = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  const col = (...names: string[]) => head.findIndex(h => names.includes(h));
  const iD = col('date', 'day'), iT = col('time', 'entrytime', 'entry_time'), iDir = col('dir', 'side', 'direction'), iS = col('stop_pts', 'stoppts', 'stop', 'risk_pts', 'riskpts'),
    iR = col('r', 'gross_r', 'grossr', 'result_r'), iA = col('adverse_pts', 'adversepts', 'mae', 'mae_pts'), iN = col('news');
  if ([iD, iT, iDir, iS, iR].some(i => i < 0)) return { trades, errors: ['Header must have date, time, dir, stop_pts and r (adverse_pts and news are optional).'] };
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(',').map(x => x.trim());
    const d = c[iD], tm = /^(\d{1,2}):(\d{2})/.exec(c[iT] || ''), ds = (c[iDir] || '').toLowerCase();
    const dir = ['long', 'buy', '1', 'l', 'b'].includes(ds) ? 1 : ['short', 'sell', '-1', 's'].includes(ds) ? -1 : 0;
    const stop = Number(c[iS]), r = Number(c[iR]);
    const adv = iA >= 0 && c[iA] !== '' ? Number(c[iA]) : r < 0 ? stop : 0, news = iN >= 0 && ['1', 'true', 'yes', 'y'].includes((c[iN] || '').toLowerCase()) ? 1 : 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || !tm || !dir || !(stop > 0) || !Number.isFinite(r) || !(adv >= 0)) { if (errors.length < 5) errors.push(`Row ${k + 1} skipped: ${lines[k].slice(0, 80)}`); continue; }
    trades.push([d, Number(tm[1]) * 60 + Number(tm[2]), dir, stop, r, adv, news]);
  }
  trades.sort((a, b) => (a[0] + String(a[1]).padStart(4, '0')).localeCompare(b[0] + String(b[1]).padStart(4, '0')));
  return { trades, errors };
}
