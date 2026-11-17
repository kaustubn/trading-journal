/**
 * Backtest Lab statistics. Pure TypeScript, no imports: runs in the browser and under Node.
 */

export interface TradeLite {
  t: number; // entry time, epoch ms
  day: string; // trading day 'YYYY-MM-DD'
  pnl: number; // net P&L in account currency
  r?: number | null; // R multiple if known
}

export interface DayPnl {
  day: string;
  pnl: number;
}

export interface Metrics {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  net: number;
  grossProfit: number;
  grossLoss: number;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  expectancyR: number | null;
  tradingDays: number;
  avgTradesPerDay: number | null;
  greenDays: number;
  redDays: number;
  greenDayRate: number | null;
  bestDay: DayPnl | null;
  worstDay: DayPnl | null;
  bestTrade: number | null;
  worstTrade: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  maxDrawdownDays: number;
  recoveryFactor: number | null;
  sharpe: number | null;
  sortino: number | null;
  dailyStdev: number | null;
}

export interface DailyRow {
  day: string;
  pnl: number;
  trades: number;
  cum: number;
  peak: number;
  dd: number;
}

// ---------------------------------------------------------------- helpers

function timeKey(t: number): number {
  return Number.isFinite(t) ? t : 0;
}

/** Drop non-finite pnl, return a copy sorted by entry time (stable). */
function cleanSorted(trades: TradeLite[]): TradeLite[] {
  const out: TradeLite[] = [];
  for (let i = 0; i < trades.length; i++) {
    const tr = trades[i];
    if (typeof tr.pnl === 'number' && Number.isFinite(tr.pnl)) out.push(tr);
  }
  out.sort((a, b) => timeKey(a.t) - timeKey(b.t));
  return out;
}

interface DayGroup {
  day: string;
  trades: TradeLite[]; // in time order
}

/** Group time-sorted trades by day, days in date order. */
function groupByDay(sorted: TradeLite[]): DayGroup[] {
  const map = new Map<string, TradeLite[]>();
  for (let i = 0; i < sorted.length; i++) {
    const tr = sorted[i];
    const arr = map.get(tr.day);
    if (arr) arr.push(tr);
    else map.set(tr.day, [tr]);
  }
  const days = Array.from(map.keys()).sort();
  return days.map((day) => ({ day, trades: map.get(day) as TradeLite[] }));
}

function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const rank = Math.ceil((p / 100) * n);
  return sortedAsc[Math.min(n - 1, Math.max(0, rank - 1))];
}

// ---------------------------------------------------------------- daily series

export function dailySeries(trades: TradeLite[]): DailyRow[] {
  return dailyFromGroups(groupByDay(cleanSorted(trades)));
}

function dailyFromGroups(groups: DayGroup[]): DailyRow[] {
  const rows: DailyRow[] = [];
  let cum = 0;
  let peak = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    let pnl = 0;
    for (let j = 0; j < g.trades.length; j++) pnl += g.trades[j].pnl;
    cum += pnl;
    if (cum > peak) peak = cum;
    rows.push({ day: g.day, pnl, trades: g.trades.length, cum, peak, dd: Math.max(0, peak - cum) });
  }
  return rows;
}

// ---------------------------------------------------------------- metrics

export function metrics(trades: TradeLite[], startBalance?: number): Metrics {
  const sorted = cleanSorted(trades);
  const count = sorted.length;

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let net = 0;
  let rSum = 0;
  let rCount = 0;
  let bestTrade: number | null = null;
  let worstTrade: number | null = null;
  let winStreak = 0;
  let lossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let peakAtMaxDd = 0;

  for (let i = 0; i < count; i++) {
    const tr = sorted[i];
    const p = tr.pnl;
    net += p;
    if (p > 0) {
      wins++;
      grossProfit += p;
      winStreak++;
      lossStreak = 0;
    } else if (p < 0) {
      losses++;
      grossLoss += -p;
      lossStreak++;
      winStreak = 0;
    } else {
      breakeven++;
      winStreak = 0;
      lossStreak = 0;
    }
    if (winStreak > longestWinStreak) longestWinStreak = winStreak;
    if (lossStreak > longestLossStreak) longestLossStreak = lossStreak;
    if (bestTrade === null || p > bestTrade) bestTrade = p;
    if (worstTrade === null || p < worstTrade) worstTrade = p;
    if (typeof tr.r === 'number' && Number.isFinite(tr.r)) {
      rSum += tr.r;
      rCount++;
    }
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      peakAtMaxDd = peak;
    }
  }

  let maxDrawdownPct: number | null = null;
  if (typeof startBalance === 'number' && Number.isFinite(startBalance) && maxDrawdown > 0) {
    const denom = startBalance + peakAtMaxDd;
    maxDrawdownPct = denom > 0 ? maxDrawdown / denom : null;
  }

  // Daily level
  const daily = dailyFromGroups(groupByDay(sorted));
  const tradingDays = daily.length;
  let greenDays = 0;
  let redDays = 0;
  let bestDay: DayPnl | null = null;
  let worstDay: DayPnl | null = null;
  let maxDrawdownDays = 0;
  let underwater = 0;
  let sum = 0;
  for (let i = 0; i < daily.length; i++) {
    const d = daily[i];
    sum += d.pnl;
    if (d.pnl > 0) greenDays++;
    else if (d.pnl < 0) redDays++;
    if (bestDay === null || d.pnl > bestDay.pnl) bestDay = { day: d.day, pnl: d.pnl };
    if (worstDay === null || d.pnl < worstDay.pnl) worstDay = { day: d.day, pnl: d.pnl };
    if (d.dd > 1e-9) {
      underwater++;
      if (underwater > maxDrawdownDays) maxDrawdownDays = underwater;
    } else {
      underwater = 0;
    }
  }

  let dailyStdev: number | null = null;
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (tradingDays >= 2) {
    const mean = sum / tradingDays;
    let ss = 0;
    let dsq = 0;
    for (let i = 0; i < daily.length; i++) {
      const x = daily[i].pnl;
      ss += (x - mean) * (x - mean);
      if (x < 0) dsq += x * x;
    }
    const sd = Math.sqrt(ss / (tradingDays - 1)); // sample stdev
    dailyStdev = sd;
    const ann = Math.sqrt(252);
    if (sd > 1e-12) sharpe = (mean / sd) * ann;
    const dsd = Math.sqrt(dsq / tradingDays);
    if (dsd > 1e-12) sortino = (mean / dsd) * ann;
  }

  const avgWin = wins > 0 ? grossProfit / wins : null;
  const avgLoss = losses > 0 ? grossLoss / losses : null;

  return {
    count,
    wins,
    losses,
    breakeven,
    winRate: count > 0 ? wins / count : 0,
    net,
    grossProfit,
    grossLoss,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss !== null && avgLoss > 0 ? avgWin / avgLoss : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: count > 0 ? net / count : null,
    expectancyR: rCount > 0 ? rSum / rCount : null,
    tradingDays,
    avgTradesPerDay: tradingDays > 0 ? count / tradingDays : null,
    greenDays,
    redDays,
    greenDayRate: tradingDays > 0 ? greenDays / tradingDays : null,
    bestDay,
    worstDay,
    bestTrade,
    worstTrade,
    longestWinStreak,
    longestLossStreak,
    maxDrawdown,
    maxDrawdownPct,
    maxDrawdownDays,
    recoveryFactor: maxDrawdown > 0 ? net / maxDrawdown : null,
    sharpe,
    sortino,
    dailyStdev,
  };
}

// ---------------------------------------------------------------- prop-firm simulator

export interface PropRules {
  start: number; // starting balance, e.g. 50000
  target: number; // profit target, e.g. 3000
  maxDrawdown: number; // e.g. 2000
  trailing: 'eod' | 'intraday' | 'static';
  lockAtStart: boolean; // trailing floor stops rising once it reaches the starting balance
  dailyLoss: number | null; // fail if a day's P&L <= -dailyLoss
  consistencyPct: number | null; // best day must be <= pct% of total profit to pass
  minDays: number; // minimum trading days before passing
}

export interface SimOutcome {
  startDay: string;
  result: 'pass' | 'fail' | 'open';
  days: number;
  trades: number;
  reason: string;
  endBalance: number;
}

export interface PropSimSummary {
  runs: number;
  pass: number;
  fail: number;
  open: number;
  passRate: number;
  failRate: number;
  medianDaysToPass: number | null;
  avgDaysToPass: number | null;
  reasons: Record<string, number>;
}

function pickStarts(n: number, maxStarts: number): number[] {
  const cap = Math.max(1, Math.floor(maxStarts));
  if (n <= cap) {
    const all: number[] = [];
    for (let i = 0; i < n; i++) all.push(i);
    return all;
  }
  if (cap === 1) return [0];
  const set = new Set<number>();
  for (let i = 0; i < cap; i++) set.add(Math.round((i * (n - 1)) / (cap - 1)));
  return Array.from(set).sort((a, b) => a - b);
}

function runChallenge(groups: DayGroup[], startIdx: number, rules: PropRules): SimOutcome {
  const startDay = groups[startIdx].day;
  const intraday = rules.trailing === 'intraday';
  const eod = rules.trailing === 'eod';
  const trails = intraday || eod;

  let balance = rules.start;
  let high = rules.start; // highest balance seen (per-trade for intraday, end-of-day for eod)
  let days = 0;
  let nTrades = 0;
  let bestDayProfit = -Infinity;
  let consistencyBlocked = false;

  const floorFor = (h: number): number => {
    let f = trails ? h - rules.maxDrawdown : rules.start - rules.maxDrawdown;
    if (rules.lockAtStart && f > rules.start) f = rules.start;
    return f;
  };

  for (let i = startIdx; i < groups.length; i++) {
    const g = groups[i];
    days++;
    let dayPnl = 0;
    for (let j = 0; j < g.trades.length; j++) {
      const p = g.trades[j].pnl;
      nTrades++;
      balance += p;
      dayPnl += p;
      if (intraday && balance > high) high = balance;
      if (balance <= floorFor(high)) {
        return { startDay, result: 'fail', days, trades: nTrades, reason: 'Max drawdown', endBalance: balance };
      }
      if (rules.dailyLoss !== null && dayPnl <= -rules.dailyLoss) {
        return { startDay, result: 'fail', days, trades: nTrades, reason: 'Daily loss limit', endBalance: balance };
      }
    }
    if (eod && balance > high) high = balance;
    if (dayPnl > bestDayProfit) bestDayProfit = dayPnl;

    const profit = balance - rules.start;
    if (profit >= rules.target && days >= rules.minDays) {
      if (rules.consistencyPct === null || bestDayProfit <= (rules.consistencyPct / 100) * profit) {
        return { startDay, result: 'pass', days, trades: nTrades, reason: 'Target reached', endBalance: balance };
      }
      consistencyBlocked = true;
    }
  }

  return {
    startDay,
    result: 'open',
    days,
    trades: nTrades,
    reason: consistencyBlocked ? 'Target hit but consistency not met' : 'Ran out of data',
    endBalance: balance,
  };
}

export function propSim(
  trades: TradeLite[],
  rules: PropRules,
  maxStarts = 400,
): { outcomes: SimOutcome[]; summary: PropSimSummary } {
  const groups = groupByDay(cleanSorted(trades));
  const outcomes: SimOutcome[] = [];
  if (groups.length > 0) {
    const starts = pickStarts(groups.length, maxStarts);
    for (let i = 0; i < starts.length; i++) outcomes.push(runChallenge(groups, starts[i], rules));
  }

  let pass = 0;
  let fail = 0;
  let open = 0;
  const reasons: Record<string, number> = {};
  const passDays: number[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    if (o.result === 'pass') {
      pass++;
      passDays.push(o.days);
    } else if (o.result === 'fail') fail++;
    else open++;
    reasons[o.reason] = (reasons[o.reason] || 0) + 1;
  }
  const runs = outcomes.length;

  let medianDaysToPass: number | null = null;
  let avgDaysToPass: number | null = null;
  if (passDays.length > 0) {
    passDays.sort((a, b) => a - b);
    const m = passDays.length >> 1;
    medianDaysToPass = passDays.length % 2 === 1 ? passDays[m] : (passDays[m - 1] + passDays[m]) / 2;
    let s = 0;
    for (let i = 0; i < passDays.length; i++) s += passDays[i];
    avgDaysToPass = s / passDays.length;
  }

  return {
    outcomes,
    summary: {
      runs,
      pass,
      fail,
      open,
      passRate: runs > 0 ? pass / runs : 0,
      failRate: runs > 0 ? fail / runs : 0,
      medianDaysToPass,
      avgDaysToPass,
      reasons,
    },
  };
}

// ---------------------------------------------------------------- Monte Carlo

export interface MonteCarloResult {
  runs: number;
  maxDrawdown: { p5: number; p50: number; p95: number };
  final: { p5: number; p50: number; p95: number };
  longestLossStreak: { p50: number; p95: number };
  ruinProb: number | null;
  sampleCurves: number[][];
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function downsample(curve: number[], maxPoints: number): number[] {
  const n = curve.length;
  if (n <= maxPoints) return curve.slice();
  const out: number[] = [];
  for (let k = 0; k < maxPoints; k++) out.push(curve[Math.round((k * (n - 1)) / (maxPoints - 1))]);
  return out;
}

export function monteCarlo(
  pnls: number[],
  opts?: { runs?: number; seed?: number; ruinDrawdown?: number | null },
): MonteCarloResult {
  const runs = Math.max(1, Math.floor(opts?.runs ?? 1000));
  const seed = opts?.seed ?? 12345;
  const ruin = opts?.ruinDrawdown ?? null;

  const clean: number[] = [];
  for (let i = 0; i < pnls.length; i++) if (typeof pnls[i] === 'number' && Number.isFinite(pnls[i])) clean.push(pnls[i]);
  const n = clean.length;

  if (n === 0) {
    return {
      runs,
      maxDrawdown: { p5: 0, p50: 0, p95: 0 },
      final: { p5: 0, p50: 0, p95: 0 },
      longestLossStreak: { p50: 0, p95: 0 },
      ruinProb: ruin === null ? null : 0,
      sampleCurves: [],
    };
  }

  const rand = mulberry32(seed);
  const buf = Float64Array.from(clean);
  const dds: number[] = new Array<number>(runs);
  const finals: number[] = new Array<number>(runs);
  const streaks: number[] = new Array<number>(runs);
  const sampleCurves: number[][] = [];
  const nSamples = Math.min(20, runs);
  let ruined = 0;

  for (let r = 0; r < runs; r++) {
    // Fisher-Yates
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = buf[i];
      buf[i] = buf[j];
      buf[j] = tmp;
    }
    const keepCurve = r < nSamples;
    const curve: number[] = keepCurve ? [0] : [];
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    let streak = 0;
    let longest = 0;
    for (let i = 0; i < n; i++) {
      const p = buf[i];
      cum += p;
      if (cum > peak) peak = cum;
      if (peak - cum > maxDd) maxDd = peak - cum;
      if (p < 0) {
        streak++;
        if (streak > longest) longest = streak;
      } else streak = 0;
      if (keepCurve) curve.push(cum);
    }
    dds[r] = maxDd;
    finals[r] = cum;
    streaks[r] = longest;
    if (ruin !== null && maxDd >= ruin) ruined++;
    if (keepCurve) sampleCurves.push(downsample(curve, 200));
  }

  dds.sort((a, b) => a - b);
  finals.sort((a, b) => a - b);
  streaks.sort((a, b) => a - b);

  return {
    runs,
    maxDrawdown: { p5: percentile(dds, 5), p50: percentile(dds, 50), p95: percentile(dds, 95) },
    final: { p5: percentile(finals, 5), p50: percentile(finals, 50), p95: percentile(finals, 95) },
    longestLossStreak: { p50: percentile(streaks, 50), p95: percentile(streaks, 95) },
    ruinProb: ruin === null ? null : ruined / runs,
    sampleCurves,
  };
}
