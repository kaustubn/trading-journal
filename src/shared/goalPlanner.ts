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
    tradesPerDay: days ? ok.length / days : null,
    sizeStep,
    lotPv: Number.isFinite(unitPv) ? unitPv * sizeStep : null,
    typicalLots: qtys.length ? Math.max(1, Math.round(median(qtys) / sizeStep)) : null,
    avgDayPnl: days ? [...byDay.values()].reduce((s, x) => s + x, 0) / days : null,
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
