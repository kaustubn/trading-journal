// Size & Pass Lab: play a strategy's research trades through a prop evaluation with the size rules you choose.
// Pure (no imports except the drawdown type): used by the browser page and tested in tests/sizeLab.test.ts.
//
// Every number is editable on the page because the right size is not known yet. Nothing here is advice; it
// replays past trades. Ways to judge an account + size:
//   historical: start a fresh evaluation at the first trading day of every month and play the real trades in order
//   bootstrap : shuffle whole trading days (keeps each day's trades together) thousands of times
//   eras      : the same, split into 2016-19 / 2020-22 / 2023-26 (does it still work lately?)
//   no-edge   : the same trades with their average result after costs moved to zero (what luck alone passes)
//   funded    : after a pass, keep trading the funded account and count payouts vs blow-ups
import type { DdType } from './propRules';

/**
 * [date ET, entry minute ET, dir, risk pts, gross R, worst adverse pts, news 0/1,
 *  exit kind (0 target / 1 stop / 2 time; -1 or missing = unknown), exit minute ET, best favourable pts]
 * The last three are optional (CSV uploads may not have them).
 */
export type LabTrade = [string, number, number, number, number, number, number, number?, number?, number?];

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
  oneAtATime?: boolean;                                   // skip a signal while the previous trade is still open
}
/**
 * commission per contract round trip ($); slippage in points on the entry (a stop order) and on exits by stop or
 * time (market); targets are limit orders (no slippage). slipPts = old single "per trade" field (still read).
 */
export interface Costs { commission: number; slipEntry?: number; slipExit?: number; slipPts?: number; }
export interface Filter { from: string; to: string; startMin: number; endMin: number; skipNews: boolean; }
export interface Funded { payoutEvery: number; buffer: number; split: number; months: number; }

export const POINT_VALUE = { NQ: 20, MNQ: 2 } as const;
const slips = (c: Costs) => (c.slipEntry !== undefined || c.slipExit !== undefined
  ? { e: c.slipEntry ?? 0, x: c.slipExit ?? 0 } : { e: c.slipPts ?? 0, x: 0 });

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
/** $ cost of one trade's fills (commission + slippage on the entry and on a stop / time / unknown exit). */
export function costUsd(t: LabTrade, q: number, s: Sizing, c: Costs) {
  const pv = POINT_VALUE[s.contract], sl = slips(c), kind = t[7] ?? -1;
  return q * ((sl.e + (kind === 0 ? 0 : sl.x)) * pv + c.commission);
}
export function tradeUsd(t: LabTrade, q: number, s: Sizing, c: Costs) {
  return q * t[4] * t[3] * POINT_VALUE[s.contract] - costUsd(t, q, s, c);
}

export interface EvalResult { result: 'pass' | 'fail' | 'open'; days: number; trades: number; profit: number; bestDay: number; why: string; endDate: string | null; endIdx: number; }

/** Account state carried from trade to trade (eval or funded). */
interface State { eq: number; peakEod: number; peakIn: number; streak: number; }
const floorOf = (st: State, a: Account) => {
  const pk = a.ddType === 'static' ? a.start : a.ddType === 'eod' ? st.peakEod : st.peakIn;
  let f = pk - a.maxDd; if (a.ddType !== 'static' && a.lockAtStart && f > a.start) f = a.start; return f;
};

/** Plays one day's trades. Returns the day's P&L, how many trades were taken, and a failure (or null). */
function playDay(day: LabTrade[], st: State, a: Account, s: Sizing, c: Costs): { dayPnl: number; n: number; fail: string | null } {
  const pv = POINT_VALUE[s.contract], sl = slips(c);
  let dayPnl = 0, n = 0, openUntil = -1;
  for (const t of day) {
    if (s.maxTradesDay && n >= s.maxTradesDay) break;
    if (s.myDailyStop && dayPnl <= -s.myDailyStop) break;
    if (s.myDailyTarget && dayPnl >= s.myDailyTarget) break;
    if (a.dailyLoss && dayPnl <= -a.dailyLoss) break;
    if (s.oneAtATime && t[8] !== undefined && t[1] < openUntil) continue;
    const floor = floorOf(st, a), q = contractsFor(t, s, a, st.streak, st.eq - floor);
    if (!q) continue;
    n++;
    if (t[8] !== undefined) openUntil = t[8];
    // worst moment while the trade was open (adverse move + entry costs + a stop's exit slippage) vs the floor
    const worstDrop = q * (t[5] * pv + (sl.e + sl.x) * pv + c.commission);
    if (st.eq - worstDrop <= floor) { st.eq -= worstDrop; return { dayPnl: dayPnl - worstDrop, n, fail: 'hit the max drawdown' }; }
    // the firm's daily loss is checked while the trade is open too
    if (a.dailyLoss && dayPnl - worstDrop <= -a.dailyLoss) {
      if (a.dailyLossFails) { st.eq -= worstDrop; return { dayPnl: dayPnl - worstDrop, n, fail: 'hit the daily loss limit' }; }
      const lost = -a.dailyLoss - dayPnl;                     // flattened at the limit; the day ends
      st.eq += lost; dayPnl = -a.dailyLoss; st.streak++;
      break;
    }
    // intraday trailing follows open profit: the best point during the trade raises the floor
    if (a.ddType === 'intraday' && t[9] !== undefined) st.peakIn = Math.max(st.peakIn, st.eq + q * t[9] * pv - q * (sl.e * pv + c.commission));
    const pnl = tradeUsd(t, q, s, c);
    st.eq += pnl; dayPnl += pnl;
    st.streak = pnl < 0 ? st.streak + 1 : 0;
    st.peakIn = Math.max(st.peakIn, st.eq);
    if (st.eq <= floorOf(st, a)) return { dayPnl, n, fail: 'hit the max drawdown' };
  }
  return { dayPnl, n, fail: null };
}

/** One evaluation played through the given days in order. */
export function runEval(days: LabTrade[][], a: Account, s: Sizing, c: Costs): EvalResult {
  const st: State = { eq: a.start, peakEod: a.start, peakIn: a.start, streak: 0 };
  let bestDay = 0, tradingDays = 0, trades = 0;
  for (let di = 0; di < days.length; di++) {
    const r = playDay(days[di], st, a, s, c);
    trades += r.n;
    if (r.fail) return { result: 'fail', days: tradingDays + 1, trades, profit: st.eq - a.start, bestDay, why: r.fail, endDate: days[di][0][0], endIdx: di };
    if (!r.n) continue;
    tradingDays++;
    st.peakEod = Math.max(st.peakEod, st.eq);
    bestDay = Math.max(bestDay, r.dayPnl);
    const profit = st.eq - a.start;
    const consistent = !a.consistencyPct || profit <= 0 || bestDay <= (a.consistencyPct / 100) * profit;
    if (profit >= a.target && consistent && (!a.minDays || tradingDays >= a.minDays))
      return { result: 'pass', days: tradingDays, trades, profit, bestDay, why: 'reached the target', endDate: days[di][0][0], endIdx: di };
  }
  return { result: 'open', days: tradingDays, trades, profit: st.eq - a.start, bestDay, why: 'ran out of data', endDate: null, endIdx: days.length - 1 };
}

/**
 * Funded account after a pass: same drawdown rules, fresh balance. At the end of a day, when profit above the
 * start reaches buffer + payoutEvery, payoutEvery is withdrawn (you get split %) and the drawdown floor stays where
 * it was (withdrawals eat into the room). Ends at a breach or after `months`. Simplified: real payout rules
 * (minimum days, caps, consistency) differ by firm.
 */
export function runFunded(days: LabTrade[][], a: Account, s: Sizing, c: Costs, f: Funded) {
  if (!days.length) return { paid: 0, payouts: 0, lost: false };
  const endBy = Date.parse(days[0][0][0]) + f.months * 30.44 * 864e5;
  const st: State = { eq: a.start, peakEod: a.start, peakIn: a.start, streak: 0 };
  let paid = 0, payouts = 0;
  for (const day of days) {
    if (Date.parse(day[0][0]) > endBy) break;
    const r = playDay(day, st, a, s, c);
    if (r.fail) return { paid, payouts, lost: true };
    if (!r.n) continue;
    st.peakEod = Math.max(st.peakEod, st.eq);
    if (f.payoutEvery > 0 && st.eq - a.start >= f.buffer + f.payoutEvery) {
      st.eq -= f.payoutEvery; paid += f.payoutEvery * f.split / 100; payouts++;
      if (st.eq <= floorOf(st, a)) return { paid, payouts, lost: true };
    }
  }
  return { paid, payouts, lost: false };
}

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
const monthsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.44 * 864e5);

/** A fresh evaluation started on the first trade day of every month (optionally followed by the funded phase). */
export function historical(days: LabTrade[][], a: Account, s: Sizing, c: Costs, funded?: Funded) {
  const starts: number[] = [];
  for (let i = 0; i < days.length; i++) if (i === 0 || days[i][0][0].slice(0, 7) !== days[i - 1][0][0].slice(0, 7)) starts.push(i);
  const runs = starts.map(i => {
    const r = runEval(days.slice(i), a, s, c);
    const f = funded && r.result === 'pass' ? runFunded(days.slice(i + r.endIdx + 1), a, s, c, funded) : null;
    return { start: days[i][0][0], ...r, funded: f };
  });
  const done = runs.filter(r => r.result !== 'open');
  const pass = done.filter(r => r.result === 'pass'), fail = done.filter(r => r.result === 'fail');
  const fundedRuns = pass.map(r => r.funded).filter(Boolean) as ReturnType<typeof runFunded>[];
  // every started evaluation counts: one still running when the data ends has not passed (yet)
  return {
    runs: runs.length, open: runs.length - done.length,
    passRate: runs.length ? pass.length / runs.length : NaN, failRate: runs.length ? fail.length / runs.length : NaN,
    passIn6: runs.length ? pass.filter(r => monthsBetween(r.start, r.endDate!) <= 6).length / runs.length : NaN,
    monthsToPass: median(pass.map(r => monthsBetween(r.start, r.endDate!))), monthsToFail: median(fail.map(r => monthsBetween(r.start, r.endDate!))),
    tradesToPass: median(pass.map(r => r.trades)),
    failReasons: fail.reduce((m, r) => { m[r.why] = (m[r.why] || 0) + 1; return m; }, {} as Record<string, number>),
    funded: fundedRuns.length ? {
      n: fundedRuns.length, avgPaid: fundedRuns.reduce((x, y) => x + y.paid, 0) / fundedRuns.length,
      lostRate: fundedRuns.filter(x => x.lost).length / fundedRuns.length, anyPayout: fundedRuns.filter(x => x.payouts > 0).length / fundedRuns.length,
    } : null,
    list: runs,
  };
}

/** Pass rates by era: does the account + size still work in recent years? */
export function byEra(days: LabTrade[][], a: Account, s: Sizing, c: Costs) {
  const eras: [string, string, string][] = [['2016–2019', '2016-01-01', '2019-12-31'], ['2020–2022', '2020-01-01', '2022-12-31'], ['2023–2026', '2023-01-01', '2026-12-31']];
  return eras.map(([label, from, to]) => {
    const d = days.filter(x => x[0][0] >= from && x[0][0] <= to);
    const h = historical(d, a, s, c);
    return { label, days: d.length, runs: h.runs, passRate: h.passRate, failRate: h.failRate, monthsToPass: h.monthsToPass };
  });
}

/** The same trades with the average result after costs moved to zero: what pass rate luck alone gives. */
export function noEdgeTrades(trades: LabTrade[], s: Sizing, c: Costs): LabTrade[] {
  if (!trades.length) return trades;
  const pv = POINT_VALUE[s.contract];
  const net = trades.map(t => t[4] - costUsd(t, 1, s, c) / (t[3] * pv));
  const m = net.reduce((x, y) => x + y, 0) / net.length;
  return trades.map(t => { const u = [...t] as LabTrade; u[4] = t[4] - m; return u; });
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
  const curve: { d: string; eq: number }[] = []; const years: Record<string, { n: number; usd: number }> = {};
  for (const day of days) {
    let dayPnl = 0, n = 0, openUntil = -1;
    for (const t of day) {
      if (s.maxTradesDay && n >= s.maxTradesDay) break;
      if (s.myDailyStop && dayPnl <= -s.myDailyStop) break;
      if (s.myDailyTarget && dayPnl >= s.myDailyTarget) break;
      if (s.oneAtATime && t[8] !== undefined && t[1] < openUntil) { skipped++; continue; }
      const q = contractsFor(t, s, a, streak, a.maxDd + Math.min(0, eq - peak));
      if (!q) { skipped++; continue; }
      if (t[8] !== undefined) openUntil = t[8];
      const pnl = tradeUsd(t, q, s, c);
      eq += pnl; dayPnl += pnl; n++; taken++; if (pnl > 0) wins++;
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
