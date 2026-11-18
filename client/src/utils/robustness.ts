// Can you trust a backtest? Slippage stress, bootstrap confidence ranges, a walk-forward split
// (the same trades cut into time periods, oldest first) and how many trades a result needs.
import type { TradeLite } from './backtestStats';

/** Each trade after `slipPts` extra points of cost per round trip (needs $ per point on the trade). */
export function withSlippage(trades: TradeLite[], slipPts: number): TradeLite[] {
  if (!slipPts) return trades;
  return trades.map(t => {
    if (!t.ppt) return t;
    const pnl = t.pnl - slipPts * t.ppt;
    return { ...t, pnl, r: t.riskUsd ? pnl / t.riskUsd : t.r };
  });
}

// small deterministic RNG so the numbers don't jump on every render
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export interface Boot { mean: number; lo: number; hi: number; pPositive: number; n: number }
/** Bootstrap the average: resample the trades with replacement `runs` times. */
export function bootstrapMean(values: number[], runs = 2000): Boot | null {
  const n = values.length;
  if (n < 5) return null;
  const rand = rng(n * 7919 + Math.round(values.reduce((a, b) => a + b, 0)));
  const means: number[] = [];
  for (let k = 0; k < runs; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return { mean, lo: means[Math.floor(0.025 * (runs - 1))], hi: means[Math.floor(0.975 * (runs - 1))], pPositive: means.filter(m => m > 0).length / runs, n };
}

/** Trades needed before a 95% range around this average would stay above zero (null = average not positive). */
export function tradesNeeded(values: number[]): number | null {
  const n = values.length;
  if (n < 5) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return Math.ceil((1.96 * sd / mean) ** 2);
}

export interface Period { from: string; to: string; n: number; win: number; net: number; avg: number; avgR: number | null; pf: number | null }
/** Walk-forward view: the trades in time order, cut into `k` periods of equal trade count. */
export function walkForward(trades: TradeLite[], k = 4): Period[] {
  const list = [...trades].sort((a, b) => a.t - b.t);
  if (list.length < k * 5) return [];
  const out: Period[] = [];
  for (let i = 0; i < k; i++) {
    const part = list.slice(Math.floor((i * list.length) / k), Math.floor(((i + 1) * list.length) / k));
    const net = part.reduce((s, t) => s + t.pnl, 0);
    const rs = part.map(t => t.r).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    const gp = part.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0), gl = -part.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
    out.push({
      from: part[0].day, to: part[part.length - 1].day, n: part.length, win: part.filter(t => t.pnl > 0).length / part.length,
      net, avg: net / part.length, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, pf: gl > 0 ? gp / gl : null,
    });
  }
  return out;
}

export type Verdict = 'holds' | 'losing' | 'unproven';
export function verdictOf(b: Boot | null): Verdict | null {
  if (!b) return null;
  return b.lo > 0 ? 'holds' : b.hi < 0 ? 'losing' : 'unproven';
}
