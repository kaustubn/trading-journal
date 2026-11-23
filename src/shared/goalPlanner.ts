// Goal planner: "I want to make X by date D — how?" Pure maths, tested in tests/goalPlanner.test.ts.
// Everything starts from the trader's own closed trades on the chosen account (win rate, average win and loss in
// points, trades per day, size step) and turns a money goal into concrete plans: size, target and stop in points,
// trades per day, the win rate each plan needs, and a seeded simulation of how often it reaches the goal before the
// loss limits stop it. Estimates, not promises.

export interface TradeLite { pnl: number; qty: number; pv: number; day: string }   // pv = money per point per 1 qty

export interface Baseline {
  trades: number; days: number;
  winRate: number | null;            // 0..1
  avgWinPts: number | null; avgLossPts: number | null;
  tradesPerDay: number | null;
  sizeStep: number;                  // smallest size you trade in (1 contract, or a lot like 75 qty)
  lotPv: number | null;              // money per point for one size step
  typicalLots: number | null;        // median size, in size steps
  avgDayPnl: number | null;
  greenDayRate: number | null;       // share of trading days that closed green (0..1)
  dayProfitFactor: number | null;    // money made on green days / money lost on red days
  avgGreenDay: number | null; avgRedDay: number | null;   // red day as a positive loss
  profitFactor: number | null;       // per trade
  avgWinMoney: number | null; avgLossMoney: number | null;   // per trade, loss as a positive number
}

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function baseline(trades: TradeLite[]): Baseline {
  const ok = trades.filter(t => Number.isFinite(t.pnl) && t.qty > 0 && t.pv > 0 && t.pnl !== 0);
  const days = new Set(ok.map(t => t.day)).size;
  const qtys = ok.map(t => Math.round(t.qty)).filter(q => q > 0);
  const sizeStep = qtys.length ? Math.max(1, qtys.reduce((g, q) => gcd(g, q))) : 1;
  const pts = (t: TradeLite) => Math.abs(t.pnl) / (t.qty * t.pv);
  const wins = ok.filter(t => t.pnl > 0), losses = ok.filter(t => t.pnl < 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const unitPv = median(ok.map(t => t.pv));
  const byDay = new Map<string, number>();
  for (const t of ok) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.pnl);
  return {
    trades: ok.length, days,
    winRate: ok.length ? wins.length / ok.length : null,
    avgWinPts: avg(wins.map(pts)), avgLossPts: avg(losses.map(pts)),
    avgWinMoney: avg(wins.map(t => t.pnl)), avgLossMoney: avg(losses.map(t => -t.pnl)),
    tradesPerDay: days ? ok.length / days : null,
    sizeStep,
    lotPv: Number.isFinite(unitPv) ? unitPv * sizeStep : null,
    typicalLots: qtys.length ? Math.max(1, Math.round(median(qtys) / sizeStep)) : null,
    avgDayPnl: days ? [...byDay.values()].reduce((s, x) => s + x, 0) / days : null,
    ...dayStats([...byDay.values()]),
    profitFactor: losses.length ? wins.reduce((s, t) => s + t.pnl, 0) / -losses.reduce((s, t) => s + t.pnl, 0) : null,
  };
}

/** Weekdays from `from` to `to` inclusive (YYYY-MM-DD). Holidays are not removed. */
export function tradingDays(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  let n = 0;
  for (let t = a; t <= b; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}

/** Chance of hitting a target of T points before a stop of S points with no edge (random walk). */
export const coinFlipWinRate = (targetPts: number, stopPts: number) => stopPts / (targetPts + stopPts);

/** Your edge over a coin flip at your own average target:stop, carried to a plan with a different target:stop. */
export function estimateWinRate(b: Baseline, targetPts: number, stopPts: number): number | null {
  if (b.winRate == null || !b.avgWinPts || !b.avgLossPts || b.trades < 10) return null;
  const edge = b.winRate - coinFlipWinRate(b.avgWinPts, b.avgLossPts);
  return Math.min(0.95, Math.max(0.05, coinFlipWinRate(targetPts, stopPts) + edge));
}

export interface Style { key: string; name: string; blurb: string; stopMult: number; rr: number; tradesPerDay: number }
export const STYLES: Style[] = [
  { key: 'steady', name: 'Slow and steady', blurb: 'More size, small targets (1:1), a few trades a day. Wins often, each win is small.', stopMult: 0.6, rr: 1, tradesPerDay: 3 },
  { key: 'balanced', name: 'Balanced', blurb: 'Your usual stop, target twice the stop, two trades a day.', stopMult: 1, rr: 2, tradesPerDay: 2 },
  { key: 'runner', name: 'Fewer contracts, bigger targets', blurb: 'Smaller size, let one trade run (target 3.5x the stop). Wins less often, each win is big.', stopMult: 1.2, rr: 3.5, tradesPerDay: 1 },
  { key: 'oneshot', name: 'One good trade a day', blurb: 'Take the single best setup, target twice the stop, then stop for the day.', stopMult: 1, rr: 2, tradesPerDay: 1 },
];

export interface PlanInput {
  goal: number; days: number;                // money goal, trading days left
  targetPts: number; stopPts: number; tradesPerDay: number;
  lots: number | null;                       // null = smallest size that reaches the goal on average
  winRate: number | null;                    // null = no measured edge
  lotPv: number; costPerLot: number;         // money per point per lot; costs per lot per trade (round trip)
  dailyLossLimit?: number | null; maxDrawdown?: number | null;
  maxLots?: number | null;
}

export interface PlanResult {
  lots: number | null; lotsNeeded: number | null; capped: boolean; maxLotsByRisk: number | null;
  perDay: number;                            // money needed per trading day
  riskPerTrade: number | null; worstDay: number | null;
  winRateNeeded: number | null;              // at the chosen size
  expectancy: number | null;                 // money per trade at the chosen size
  pReach: number | null; pLimit: number | null; medianEnd: number | null;
  verdict: 'realistic' | 'stretch' | 'unrealistic' | 'dangerous' | 'no-edge' | 'invalid';
  why: string;
}

/** Seeded random numbers so the same inputs always show the same chances. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Simulate `runs` attempts: trade until the goal is reached (then stop), the day's loss limit stops the day,
 *  or the drawdown limit ends the attempt. */
export function simulate(p: { goal: number; days: number; tradesPerDay: number; win: number; loss: number; winRate: number;
  dailyLossLimit?: number | null; maxDrawdown?: number | null }, runs = 2000, seed = 7): { pReach: number; pLimit: number; medianEnd: number } {
  const r = rng(seed); let reach = 0, limit = 0; const ends: number[] = [];
  const n = Math.max(1, Math.round(p.tradesPerDay));
  for (let k = 0; k < runs; k++) {
    let eq = 0, peak = 0, done = false, blown = false;
    for (let d = 0; d < p.days && !done && !blown; d++) {
      let day = 0;
      for (let i = 0; i < n; i++) {
        const x = r() < p.winRate ? p.win : -p.loss;
        day += x; eq += x; peak = Math.max(peak, eq);
        if (eq >= p.goal) { done = true; break; }
        if (p.maxDrawdown && peak - eq >= p.maxDrawdown) { blown = true; break; }
        if (p.dailyLossLimit && -day >= p.dailyLossLimit) break;
      }
    }
    if (done) reach++; if (blown) limit++;
    ends.push(eq);
  }
  return { pReach: reach / runs, pLimit: limit / runs, medianEnd: median(ends) };
}

export function plan(p: PlanInput): PlanResult {
  const perDay = p.days > 0 ? p.goal / p.days : NaN;
  const base: PlanResult = { lots: null, lotsNeeded: null, capped: false, maxLotsByRisk: null, perDay, riskPerTrade: null, worstDay: null,
    winRateNeeded: null, expectancy: null, pReach: null, pLimit: null, medianEnd: null, verdict: 'invalid', why: '' };
  if (!(p.goal > 0) || !(p.days > 0) || !(p.targetPts > 0) || !(p.stopPts > 0) || !(p.tradesPerDay >= 1) || !(p.lotPv > 0))
    return { ...base, why: 'Fill in the goal, a date in the future, target and stop points, and the money per point.' };
  const n = Math.round(p.tradesPerDay);
  const lossPerLot = p.stopPts * p.lotPv + p.costPerLot, winPerLot = p.targetPts * p.lotPv - p.costPerLot;
  // biggest size where a full losing day stays inside the daily loss limit (and one loss inside the drawdown limit)
  let maxLots: number | null = p.maxLots && p.maxLots > 0 ? Math.floor(p.maxLots) : null;
  if (p.dailyLossLimit && p.dailyLossLimit > 0) maxLots = Math.min(maxLots ?? Infinity, Math.floor(p.dailyLossLimit / (n * lossPerLot)));
  if (p.maxDrawdown && p.maxDrawdown > 0) maxLots = Math.min(maxLots ?? Infinity, Math.floor(p.maxDrawdown / (3 * lossPerLot)));
  const res: PlanResult = { ...base, maxLotsByRisk: maxLots };
  const w = p.winRate;
  const evPerLot = w == null ? null : w * winPerLot - (1 - w) * lossPerLot;
  res.lotsNeeded = evPerLot != null && evPerLot > 0 ? Math.max(1, Math.ceil(p.goal / (p.days * n * evPerLot))) : null;
  let lots = p.lots && p.lots > 0 ? Math.floor(p.lots) : res.lotsNeeded ?? 1;
  if (maxLots != null && lots > maxLots) { res.capped = !(p.lots && p.lots > 0); if (res.capped) lots = Math.max(1, maxLots); }
  res.lots = lots;
  res.riskPerTrade = lots * lossPerLot;
  res.worstDay = res.riskPerTrade * n;
  // win rate needed so the average result reaches the goal: w*win - (1-w)*loss = goal/(days*n) per trade
  res.winRateNeeded = (p.goal / (p.days * n) + lots * lossPerLot) / (lots * (winPerLot + lossPerLot));
  if (maxLots != null && maxLots < 1)
    return { ...res, verdict: 'dangerous', why: 'Even 1 lot risks more than your loss limits allow with this stop and trades per day.' };
  if (w == null)
    return { ...res, verdict: 'no-edge', why: 'Not enough closed trades on this account to measure your win rate (need 10). Type a win rate to test the plan.' };
  res.expectancy = lots * evPerLot!;
  const sim = simulate({ goal: p.goal, days: p.days, tradesPerDay: n, win: lots * winPerLot, loss: lots * lossPerLot, winRate: w,
    dailyLossLimit: p.dailyLossLimit, maxDrawdown: p.maxDrawdown });
  Object.assign(res, sim);
  const over = maxLots != null && lots > maxLots;
  if (over || sim.pLimit > 0.25) return { ...res, verdict: 'dangerous', why: over ? `This size breaks your loss limit on a bad day (max ${maxLots} lots).` : `About ${Math.round(sim.pLimit * 100)}% of attempts hit the drawdown limit first.` };
  if (evPerLot! <= 0) return { ...res, verdict: 'unrealistic', why: 'With your measured win rate this plan loses money on average, whatever the size.' };
  if (res.winRateNeeded > 1) return { ...res, verdict: 'unrealistic', why: 'Even winning every trade at this size does not reach the goal in time.' };
  if (sim.pReach >= 0.6) return { ...res, verdict: 'realistic', why: `Reached the goal in ${Math.round(sim.pReach * 100)}% of simulated attempts.` };
  if (sim.pReach >= 0.3) return { ...res, verdict: 'stretch', why: `Reached the goal in only ${Math.round(sim.pReach * 100)}% of simulated attempts.` };
  return { ...res, verdict: 'unrealistic', why: `Reached the goal in ${Math.round(sim.pReach * 100)}% of simulated attempts. More time or a smaller goal helps.` };
}

/** Target and stop in points for a style, scaled to your own average loss (your usual stop). */
export function styleLevels(s: Style, b: Baseline, fallbackStop: number): { stopPts: number; targetPts: number } {
  const s0 = b.avgLossPts && b.avgLossPts > 0 ? b.avgLossPts : fallbackStop;
  const round = (x: number) => (x >= 20 ? Math.round(x) : x >= 2 ? Math.round(x * 4) / 4 : Math.round(x * 100) / 100);
  const stopPts = round(s0 * s.stopMult);
  return { stopPts, targetPts: round(stopPts * s.rr) };
}

/** Where a saved goal stands today. */
export function progress(goal: number, earned: number, daysLeft: number, daysTotal: number) {
  const pct = goal > 0 ? earned / goal : 0;
  const needPerDay = daysLeft > 0 ? Math.max(0, goal - earned) / daysLeft : null;
  const expected = daysTotal > 0 ? goal * (1 - daysLeft / daysTotal) : goal;
  const status = earned >= goal ? 'done' : daysLeft <= 0 ? 'missed' : earned >= expected ? 'ahead' : 'behind';
  return { pct, needPerDay, status: status as 'done' | 'missed' | 'ahead' | 'behind' };
}

function dayStats(dayPnl: number[]) {
  const green = dayPnl.filter(x => x > 0), red = dayPnl.filter(x => x < 0);
  const won = green.reduce((s, x) => s + x, 0), lost = -red.reduce((s, x) => s + x, 0);
  return {
    greenDayRate: dayPnl.length ? green.length / dayPnl.length : null,
    dayProfitFactor: lost > 0 ? won / lost : null,
    avgGreenDay: green.length ? won / green.length : null,
    avgRedDay: red.length ? lost / red.length : null,
  };
}

/** Money per green day and the most per red day that reach `goal` over `days` trading days, if green days come
 *  `greenRate` of the time and the profit factor (money won / money lost) is `pf`:
 *  won - lost = goal and won = pf * lost  ->  lost = goal / (pf - 1), won = pf * goal / (pf - 1). */
export function dayTargets(goal: number, days: number, greenRate: number, pf: number) {
  if (!(goal > 0) || !(days >= 1) || !(greenRate > 0 && greenRate < 1) || !(pf > 0)) return null;
  if (pf <= 1) return { ok: false as const, why: 'With a profit factor of 1 or less you lose money or break even, so no daily target reaches the goal.' };
  const greenDays = greenRate * days, redDays = (1 - greenRate) * days;
  const lost = goal / (pf - 1), won = pf * lost;
  return { ok: true as const, greenDays, redDays, won, lost, perGreenDay: won / greenDays, perRedDay: lost / redDays };
}

/** Convert between currencies with CAD rates (CAD value of 1 unit of each). */
export const convert = (amount: number, from: string, to: string, cad: Record<string, number>) =>
  (cad[from] && cad[to] ? (amount * cad[from]) / cad[to] : NaN);

/** Trading days (Mon-Fri) from `from` to `to` inclusive, as YYYY-MM-DD. */
export function tradingDayList(from: string, to: string): string[] {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z'), out: string[] = [];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return out;
  for (let t = a; t <= b && out.length < 400; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) out.push(new Date(t).toISOString().slice(0, 10)); }
  return out;
}

export interface ScheduleRow { date: string; n: number; target: number; green: number | null; red: number | null; total: number; balance: number | null }
/** Day-by-day targets. 'flat' = the same amount every day; 'compound' = the same % of the balance every day
 *  (needs a starting balance). With a green-day rate and profit factor, each day's target becomes "make at least
 *  X on a green day / lose at most Y on a red day" (same maths as dayTargets, for one day). */
export function schedule(dates: string[], goal: number, mode: 'flat' | 'compound', startBalance: number | null,
  greenRate: number | null, pf: number | null): { rows: ScheduleRow[]; dailyPct: number | null } {
  const n = dates.length;
  if (!n || !(goal > 0)) return { rows: [], dailyPct: null };
  const comp = mode === 'compound' && startBalance != null && startBalance > 0;
  const r = comp ? Math.pow((startBalance! + goal) / startBalance!, 1 / n) - 1 : null;
  const split = greenRate != null && pf != null && greenRate > 0 && greenRate < 1 && pf > 1;
  let total = 0, bal = startBalance != null && startBalance > 0 ? startBalance : null;
  const rows = dates.map((date, i) => {
    const target = comp ? bal! * r! : goal / n;
    total += target; if (bal != null) bal += target;
    return { date, n: i + 1, target, total, balance: bal,
      green: split ? (target * pf!) / ((pf! - 1) * greenRate!) : null,
      red: split ? target / ((pf! - 1) * (1 - greenRate!)) : null };
  });
  return { rows, dailyPct: r };
}

export interface StyleIdea {
  target: number; stop: number; tradesPerDay: number;     // money per trade
  winRate: number; perTrade: number; perDay: number;      // estimated
  pReach: number; worstDay: number; current?: boolean;
}
/** Try many target / stop / trades-a-day combinations (in money per trade, scaled from your own average win and
 *  loss) and rank them by how often they reach the goal in time, using your edge over a coin flip. Combinations
 *  whose all-losing day breaks the daily loss limit are left out. */
export function suggestStyles(p: { goal: number; days: number; b: Baseline; cost: number; winRate?: number | null;
  dailyLossLimit?: number | null; maxDrawdown?: number | null; limit?: number }): { current: StyleIdea | null; ideas: StyleIdea[]; maxWorstDay: number | null; maxTrades: number } {
  const { b } = p;
  const W = b.avgWinMoney, L = b.avgLossMoney;
  const maxTrades = Math.min(8, Math.max(2, Math.ceil(2 * (b.tradesPerDay ?? 1))));   // at most about twice your pace
  // worst possible day: your daily loss limit, or else twice your average red day
  const maxWorstDay = p.dailyLossLimit && p.dailyLossLimit > 0 ? p.dailyLossLimit : b.avgRedDay ? 2 * b.avgRedDay : null;
  if (!(p.goal > 0) || !(p.days >= 1) || !W || !L) return { current: null, ideas: [], maxWorstDay, maxTrades };
  const edge = p.winRate != null ? null : (b.winRate != null && b.trades >= 10 ? b.winRate - coinFlipWinRate(W, L) : null);
  const wr = (T: number, S: number) => (p.winRate != null ? p.winRate : edge == null ? null : Math.min(0.95, Math.max(0.05, coinFlipWinRate(T, S) + edge)));
  const score = (T: number, S: number, n: number, runs: number): StyleIdea | null => {
    const w = wr(T, S); if (w == null) return null;
    const winNet = T - p.cost, lossNet = S + p.cost;
    const perTrade = w * winNet - (1 - w) * lossNet;
    const sim = simulate({ goal: p.goal, days: p.days, tradesPerDay: n, win: winNet, loss: lossNet, winRate: w, dailyLossLimit: p.dailyLossLimit, maxDrawdown: p.maxDrawdown }, runs, 11);
    return { target: T, stop: S, tradesPerDay: n, winRate: w, perTrade, perDay: perTrade * n, pReach: sim.pReach, worstDay: n * lossNet };
  };
  const curN = Math.max(1, Math.round(b.tradesPerDay ?? 1));
  const cur = score(W, L, curN, 2000);
  const cands: StyleIdea[] = [];
  for (const tm of [0.1, 0.25, 0.4, 0.5, 0.75, 1, 1.5, 2, 3])
    for (const sm of [0.5, 0.75, 1, 1.5])
      for (const n of [1, 2, 3, 4, 5, 6, 8].filter(k => k <= maxTrades)) {
        const T = W * tm, S = L * sm;
        if (tm / sm > 2 || tm / sm < 0.2) continue;                  // stay near the reward:risk you really trade (the estimate is weak far from it)
        if (T <= p.cost * 2) continue;                               // costs would eat the win
        if (maxWorstDay && n * (S + p.cost) > maxWorstDay) continue;
        const x = score(T, S, n, 500);
        if (x && x.perTrade > 0) cands.push(x);
      }
  // similar odds (same 5% band): the smaller worst day wins
  const band = (x: StyleIdea) => Math.floor(x.pReach * 20 + 1e-9);
  cands.sort((a, c) => band(c) - band(a) || a.worstDay - c.worstDay || c.pReach - a.pReach);
  // keep different styles (not five near-copies): distinct target size and trades a day
  const picked: StyleIdea[] = [];
  for (const c of cands) {
    if (picked.some(x => Math.abs(x.target - c.target) / c.target < 0.2 && x.tradesPerDay === c.tradesPerDay)) continue;
    picked.push(score(c.target, c.stop, c.tradesPerDay, 2000)!);
    if (picked.length >= (p.limit ?? 6)) break;
  }
  picked.sort((a, c) => band(c) - band(a) || a.worstDay - c.worstDay || c.pReach - a.pReach);
  return { current: cur ? { ...cur, current: true } : null, ideas: picked, maxWorstDay, maxTrades };
}
