// "Is this backtest real?" checks used by the Backtest Lab (journal trades or an uploaded backtest file).
// Pure; tested in tests/edgeCheck.test.ts.

export interface EcTrade { day: string; pnl: number }

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Inverse standard normal (Acklam's rational approximation, relative error < 1.2e-9). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export function tStat(a: number[]): number | null {
  const s = sd(a);
  return a.length >= 2 && s > 0 ? mean(a) / (s / Math.sqrt(a.length)) : null;
}

export interface Part { label: string; from: string | null; to: string | null; n: number; net: number; avg: number }

/** Split by trading DAYS (not trades): oldest 50% of days, next 25%, newest 25%. */
export function splitByDate(trades: EcTrade[]): Part[] {
  const days = [...new Set(trades.map(t => t.day))].sort();
  const c1 = days[Math.floor(days.length * 0.5)], c2 = days[Math.floor(days.length * 0.75)];
  const mk = (label: string, pred: (d: string) => boolean): Part => {
    const xs = trades.filter(t => pred(t.day));
    const ds = xs.map(t => t.day).sort();
    return { label, from: ds[0] ?? null, to: ds[ds.length - 1] ?? null, n: xs.length, net: xs.reduce((s, t) => s + t.pnl, 0), avg: mean(xs.map(t => t.pnl)) };
  };
  if (days.length < 4) return [mk('All', () => true)];
  return [mk('Oldest 50%', d => d < c1), mk('Next 25% (validation)', d => d >= c1 && d < c2), mk('Newest 25% (holdout)', d => d >= c2)];
}

export interface Dsr { sr: number; sr0: number; prob: number; variants: number }
/**
 * Deflated Sharpe ratio (Bailey & López de Prado, 2014) on per-trade P&L: the probability that the true
 * Sharpe is above what the best of `variants` independent tries would show by luck alone.
 */
export function deflatedSharpe(pnls: number[], variants: number): Dsr | null {
  const T = pnls.length, s = sd(pnls);
  if (T < 10 || s <= 0) return null;
  const m = mean(pnls), sr = m / s;
  const N = Math.max(1, Math.floor(variants));
  const g = 0.5772156649;
  const sr0 = N <= 1 ? 0 : Math.sqrt(1 / (T - 1)) * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E)));
  const m3 = pnls.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / T;
  const m4 = pnls.reduce((a, x) => a + ((x - m) / s) ** 4, 0) / T;
  const denom = Math.sqrt(Math.max(1e-9, 1 - m3 * sr + ((m4 - 1) / 4) * sr * sr));
  return { sr, sr0, prob: normCdf(((sr - sr0) * Math.sqrt(T - 1)) / denom), variants: N };
}

/** Share of all profit that came from the single best day (prop consistency rules cap this, often at 30-50%). */
export function bestDayShare(trades: EcTrade[]): number | null {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.pnl);
  const vals = [...byDay.values()], total = vals.reduce((a, x) => a + x, 0);
  return total > 0 ? Math.max(...vals) / total : null;
}

export function byYear(trades: EcTrade[]): { year: string; n: number; net: number; avg: number; win: number }[] {
  const g = new Map<string, number[]>();
  for (const t of trades) { const y = t.day.slice(0, 4); g.set(y, [...(g.get(y) ?? []), t.pnl]); }
  return [...g.entries()].sort().map(([year, xs]) => ({ year, n: xs.length, net: xs.reduce((a, x) => a + x, 0), avg: mean(xs), win: xs.filter(x => x > 0).length / xs.length }));
}

export interface GateCheck { key: string; label: string; pass: boolean | null; value: string }
export interface GateResult { verdict: 'pass' | 'watch' | 'reject' | 'too few'; checks: GateCheck[]; reason: string }

/**
 * Kay's go-live gate + research hurdles, applied to a trade list after costs.
 * maxDrawdownLimit: the prop account's max drawdown in $ (the test's worst drawdown must be <= 50% of it).
 */
export function goLiveGate(trades: EcTrade[], opts: { variants: number; maxDrawdownLimit: number | null }): GateResult {
  const p = trades.map(t => t.pnl), n = p.length;
  const net = p.reduce((a, x) => a + x, 0);
  const parts = splitByDate(trades);
  const val = parts.length === 3 ? parts[1] : null, hold = parts.length === 3 ? parts[2] : null;
  const t = tStat(p), dsr = deflatedSharpe(p, opts.variants);
  let eq = 0, peak = 0, dd = 0;
  for (const x of p) { eq += x; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const ddOk = opts.maxDrawdownLimit && opts.maxDrawdownLimit > 0 ? -dd <= 0.5 * opts.maxDrawdownLimit : null;
  const checks: GateCheck[] = [
    { key: 'n', label: '50+ trades', pass: n >= 50, value: String(n) },
    { key: 'net', label: 'Profitable after costs', pass: net > 0, value: `$${net.toFixed(0)}` },
    { key: 'val', label: 'Validation period (next 25%) positive', pass: val ? val.avg > 0 : null, value: val ? `$${val.avg.toFixed(1)}/trade, n ${val.n}` : 'not enough days' },
    { key: 'hold', label: 'Holdout (newest 25%) positive', pass: hold ? hold.avg > 0 : null, value: hold ? `$${hold.avg.toFixed(1)}/trade, n ${hold.n}` : 'not enough days' },
    { key: 't', label: 't-stat 3 or more', pass: t == null ? null : t >= 3, value: t == null ? '—' : t.toFixed(2) },
    { key: 'dsr', label: `Beats luck after ${opts.variants} variant${opts.variants === 1 ? '' : 's'} tried (deflated Sharpe ≥ 95%)`, pass: dsr ? dsr.prob >= 0.95 : null, value: dsr ? `${(dsr.prob * 100).toFixed(0)}%` : '—' },
    { key: 'dd', label: 'Worst drawdown ≤ 50% of the account max drawdown', pass: ddOk, value: `$${(-dd).toFixed(0)}${opts.maxDrawdownLimit ? ` vs limit $${opts.maxDrawdownLimit.toFixed(0)}` : ''}` },
  ];
  if (n < 20) return { verdict: 'too few', checks, reason: 'Fewer than 20 trades: nothing can be concluded yet.' };
  const bothOosBad = val && hold && val.avg <= 0 && hold.avg <= 0;
  if (net <= 0 || bothOosBad) return { verdict: 'reject', checks, reason: net <= 0 ? 'It loses money after costs.' : 'It loses on both out-of-sample periods.' };
  if (checks.every(c => c.pass === true)) return { verdict: 'pass', checks, reason: 'Every check passes. Next step of the gate: a forward paper test (3-4+ weeks, 30+ trades).' };
  const failed = checks.filter(c => c.pass === false).map(c => c.label.toLowerCase());
  return { verdict: 'watch', checks, reason: failed.length ? `Promising but not proven: ${failed.join('; ')}.` : 'Some checks could not be run (see dashes).' };
}
