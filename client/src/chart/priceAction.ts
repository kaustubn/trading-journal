// Price-action reading engine: common bar-by-bar ideas (bar types, "always in" direction, trend vs
// trading range, pullback bar counts H1/H2 and L1/L2, wedges = three pushes, double tops/bottoms,
// micro channels, breakouts with follow-through). These are widely taught price-action concepts
// (popularised by Al Brooks among others); the definitions and wording here are the journal's own
// simplified versions, not anyone's course material.
//
// NO LOOKAHEAD: paAnalyze walks the bars once, left to right; state[i] uses bars 0..i only. Swings are
// fractals with 2 bars each side, so a swing at bar s is only known at bar s + 2.
import { registerIndicator, KLineData } from 'klinecharts';

export type BarKind = 'bull trend' | 'bear trend' | 'doji' | 'bull reversal' | 'bear reversal' | 'bull' | 'bear';
export interface PAState {
  kind: BarKind; atr: number; ema: number;
  ai: 1 | -1 | 0;                 // always-in direction: 1 long, -1 short, 0 not clear yet
  aiFlip: boolean;                // this bar flipped the always-in direction
  ctx: 'trend' | 'range';
  count: string | null;           // 'H1', 'H2', 'H3+' (bull pullback) / 'L1', 'L2', 'L3+' (bear pullback) on this bar
  pushes: number;                 // pushes in the current trend leg (3 = wedge)
  wedge: 'top' | 'bottom' | null; // third push reached on this bar
  dbl: 'DT' | 'DB' | null;        // this bar tests a prior swing high / low
  micro: number;                  // bars in a row with higher lows (+) / lower highs (-)
  bo: 1 | -1 | 0;                 // this bar is a breakout of the last 20 bars' range (trend bar)
  ft: boolean;                    // this bar is follow-through of a breakout on the previous bar
  signalQuality: 'good' | 'weak' | null; // for a count / reversal bar: does it close strongly?
}

const cache = new WeakMap<KLineData[], PAState[]>();

export function paAnalyze(bars: KLineData[]): PAState[] {
  const hit = cache.get(bars);
  if (hit && hit.length === bars.length) return hit;
  const out: PAState[] = [];
  let atr = NaN, ema = NaN;
  let ai: 1 | -1 | 0 = 0;
  let trendHi = -Infinity, trendLo = Infinity;
  let bullCount = 0, bearCount = 0, bullState: 'none' | 'down' | 'up' = 'none', bearState: 'none' | 'down' | 'up' = 'none';
  let pushes = 0, pulledBack = false;
  let micro = 0;
  const swingHi: { i: number; p: number }[] = [], swingLo: { i: number; p: number }[] = [];
  const side: number[] = []; // close above (1) / below (-1) the EMA
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    const pc = p ? p.close : b.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    atr = Number.isNaN(atr) ? tr : atr + (tr - atr) / 14;
    ema = Number.isNaN(ema) ? b.close : ema + (2 / 21) * (b.close - ema);
    const r = b.high - b.low || 1e-9, body = Math.abs(b.close - b.open), cf = (b.close - b.low) / r;
    let kind: BarKind;
    if (body / r <= 0.25) kind = 'doji';
    else if (body / r >= 0.6 && r >= 0.7 * atr) kind = b.close > b.open ? 'bull trend' : 'bear trend';
    else if (cf >= 0.66 && (Math.min(b.open, b.close) - b.low) >= r / 3 && p && p.close < p.open) kind = 'bull reversal';
    else if (cf <= 0.34 && (b.high - Math.max(b.open, b.close)) >= r / 3 && p && p.close > p.open) kind = 'bear reversal';
    else kind = b.close >= b.open ? 'bull' : 'bear';

    // breakout of the prior 20 bars + follow-through
    let hh = -Infinity, ll = Infinity;
    for (let k = Math.max(0, i - 20); k < i; k++) { hh = Math.max(hh, bars[k].high); ll = Math.min(ll, bars[k].low); }
    const bo: 1 | -1 | 0 = i >= 20 && kind === 'bull trend' && b.close > hh ? 1 : i >= 20 && kind === 'bear trend' && b.close < ll ? -1 : 0;
    const prevBo = out[i - 1]?.bo ?? 0;
    const ft = prevBo !== 0 && (prevBo > 0 ? b.close > p!.close && b.close > b.open : b.close < p!.close && b.close < b.open);

    // always-in: flips on a strong breakout (big trend bar beyond the EMA, or breakout + follow-through)
    let aiFlip = false;
    const prevKind = out[i - 1]?.kind;
    const strongUp = (kind === 'bull trend' && r >= 1.5 * atr && b.close > ema) || (ft && prevBo > 0)
      || (kind === 'bull trend' && prevKind === 'bull trend' && b.close > ema && p!.close > ema);
    const strongDn = (kind === 'bear trend' && r >= 1.5 * atr && b.close < ema) || (ft && prevBo < 0)
      || (kind === 'bear trend' && prevKind === 'bear trend' && b.close < ema && p!.close < ema);
    if (strongUp && ai !== 1) { ai = 1; aiFlip = true; trendHi = b.high; pushes = 1; pulledBack = false; bullCount = 0; bullState = 'none'; }
    else if (strongDn && ai !== -1) { ai = -1; aiFlip = true; trendLo = b.low; pushes = 1; pulledBack = false; bearCount = 0; bearState = 'none'; }

    // trading range vs trend: price keeps crossing the EMA / bars overlap
    side.push(b.close >= ema ? 1 : -1);
    let crosses = 0;
    for (let k = Math.max(1, side.length - 20); k < side.length; k++) if (side[k] !== side[k - 1]) crosses++;
    const ctx: 'trend' | 'range' = ai === 0 || crosses >= 4 ? 'range' : 'trend';

    // pullback counts + pushes (wedges)
    let count: string | null = null, wedge: 'top' | 'bottom' | null = null;
    if (ai === 1 && p && !aiFlip) {
      if (b.high > trendHi) {
        if (pulledBack) { pushes++; pulledBack = false; if (pushes === 3) wedge = 'top'; }
        trendHi = b.high; bullCount = 0; bullState = 'none';
      } else {
        if (b.high < p.high) { bullState = 'down'; if (trendHi - b.low >= 0.5 * atr) pulledBack = true; }
        else if (b.high > p.high && bullState === 'down') { bullCount++; bullState = 'up'; count = bullCount >= 3 ? 'H3+' : `H${bullCount}`; }
      }
    } else if (ai === -1 && p && !aiFlip) {
      if (b.low < trendLo) {
        if (pulledBack) { pushes++; pulledBack = false; if (pushes === 3) wedge = 'bottom'; }
        trendLo = b.low; bearCount = 0; bearState = 'none';
      } else {
        if (b.low > p.low) { bearState = 'down'; if (b.high - trendLo >= 0.5 * atr) pulledBack = true; }
        else if (b.low < p.low && bearState === 'down') { bearCount++; bearState = 'up'; count = bearCount >= 3 ? 'L3+' : `L${bearCount}`; }
      }
    }

    // swings (confirmed 2 bars later) and double tops / bottoms
    if (i >= 4) {
      const s = i - 2, sb = bars[s];
      if (sb.high >= Math.max(bars[s - 1].high, bars[s - 2].high, bars[s + 1].high, bars[s + 2].high)) swingHi.push({ i: s, p: sb.high });
      if (sb.low <= Math.min(bars[s - 1].low, bars[s - 2].low, bars[s + 1].low, bars[s + 2].low)) swingLo.push({ i: s, p: sb.low });
    }
    let dbl: 'DT' | 'DB' | null = null;
    const tol = 0.25 * atr;
    const realHi = (sw: { i: number; p: number }) => {
      for (let k = Math.max(0, sw.i - 5); k <= Math.min(i - 1, sw.i + 5); k++) if (bars[k].high > sw.p) return false;
      for (let k = sw.i + 1; k < i; k++) if (bars[k].high > sw.p + tol) return false;
      return true;
    };
    const realLo = (sw: { i: number; p: number }) => {
      for (let k = Math.max(0, sw.i - 5); k <= Math.min(i - 1, sw.i + 5); k++) if (bars[k].low < sw.p) return false;
      for (let k = sw.i + 1; k < i; k++) if (bars[k].low < sw.p - tol) return false;
      return true;
    };
    let top5 = true, bot5 = true;
    for (let k = Math.max(0, i - 4); k < i; k++) { if (bars[k].high > b.high) top5 = false; if (bars[k].low < b.low) bot5 = false; }
    if (top5 && cf <= 0.45 && swingHi.some(sw => i - sw.i >= 8 && i - sw.i <= 60 && Math.abs(b.high - sw.p) <= tol && b.close < sw.p && realHi(sw))) dbl = 'DT';
    else if (bot5 && cf >= 0.55 && swingLo.some(sw => i - sw.i >= 8 && i - sw.i <= 60 && Math.abs(b.low - sw.p) <= tol && b.close > sw.p && realLo(sw))) dbl = 'DB';

    micro = p ? (b.low >= p.low && b.high > p.high ? Math.max(1, micro + 1) : b.high <= p.high && b.low < p.low ? Math.min(-1, micro - 1) : 0) : 0;
    const bullish = count?.startsWith('H') || kind === 'bull reversal' || dbl === 'DB' || wedge === 'bottom';
    const bearish = count?.startsWith('L') || kind === 'bear reversal' || dbl === 'DT' || wedge === 'top';
    const signalQuality = bullish ? (cf >= 0.6 && kind !== 'doji' ? 'good' : 'weak') : bearish ? (cf <= 0.4 && kind !== 'doji' ? 'good' : 'weak') : null;
    out.push({ kind, atr, ema, ai, aiFlip, ctx, count, pushes, wedge, dbl, micro, bo, ft, signalQuality });
  }
  cache.set(bars, out);
  return out;
}

/** One line of live commentary for bar i (what a price-action trader would say about it). */
export function paNarrate(bars: KLineData[], i: number): { title: string; text: string } | null {
  const S = paAnalyze(bars), s = S[i], b = bars[i];
  if (!s || !b) return null;
  const r = b.high - b.low, cf = r > 0 ? (b.close - b.low) / r : 0.5;
  const trend = s.kind === 'bull trend' || s.kind === 'bear trend';
  const where = cf > 0.75 ? 'closed near its high' : cf < 0.25 ? 'closed near its low'
    : trend ? (s.kind === 'bull trend' ? 'closed in its upper half' : 'closed in its lower half') : 'closed in the middle';
  const parts: string[] = [];
  const kindTxt: Record<BarKind, string> = {
    'bull trend': 'Strong bull trend bar', 'bear trend': 'Strong bear trend bar', doji: 'Doji (no one in control)',
    'bull reversal': 'Bull reversal bar (sellers pushed down, buyers closed it near the high)', 'bear reversal': 'Bear reversal bar (buyers pushed up, sellers closed it near the low)',
    bull: 'Bull bar (modest body)', bear: 'Bear bar (modest body)',
  };
  parts.push(`${kindTxt[s.kind]}, ${(r / (s.atr || 1)).toFixed(1)}× ATR, ${where}.`);
  if (s.aiFlip) parts.push(s.ai > 0 ? 'Always-in direction flips to LONG: the strong breakout means buyers are now in charge until proven otherwise.' : 'Always-in direction flips to SHORT: the strong breakout means sellers are now in charge until proven otherwise.');
  else parts.push(s.ai > 0 ? `Always in LONG${s.ctx === 'range' ? ', but price keeps crossing the EMA: trading-range behaviour, so buy low / sell high, not breakouts' : ' and trending: look to buy pullbacks, not to short'}.` : s.ai < 0 ? `Always in SHORT${s.ctx === 'range' ? ', but price keeps crossing the EMA: trading-range behaviour, fade the extremes' : ' and trending: look to sell rallies, not to buy'}.` : 'No clear always-in direction yet: treat it as a trading range and wait.');
  if (s.bo) parts.push(`Breakout bar: closed beyond the last 20 bars' ${s.bo > 0 ? 'high' : 'low'}. The next bar decides it: follow-through = real, a reversal bar = likely failed breakout.`);
  if (s.ft) parts.push('Follow-through: the bar after the breakout continued. Breakouts with follow-through usually get at least a second leg.');
  if (s.count) {
    const bull = s.count.startsWith('H');
    const n = s.count === 'H1' || s.count === 'L1' ? 1 : s.count === 'H2' || s.count === 'L2' ? 2 : 3;
    parts.push(n === 1 ? `${s.count}: first attempt to resume the ${bull ? 'bull' : 'bear'} trend in this pullback. In a strong trend that is enough; otherwise traders wait for the second entry.`
      : n === 2 ? `${s.count}: SECOND attempt to resume the ${bull ? 'up' : 'down'} trend — the classic with-trend entry. Signal bar is ${s.signalQuality}; the entry is a ${bull ? 'buy stop 1 tick above' : 'sell stop 1 tick below'} this bar.`
        : `${s.count}: third or later attempt — the pullback is getting long. That often turns into a wedge ${bull ? 'bull flag' : 'bear flag'} or a trading range: smaller size, or wait.`);
  }
  if (s.wedge) parts.push(`Third push ${s.wedge === 'top' ? 'up' : 'down'} in this leg: a wedge. Three pushes often exhaust a move — watch for a ${s.wedge === 'top' ? 'bear' : 'bull'} reversal bar to fade it, aiming for at least a two-legged pullback.`);
  if (s.dbl) parts.push(s.dbl === 'DT' ? 'Double top: this bar tested an earlier swing high and closed back below it. Sellers defended the same price twice.' : 'Double bottom: this bar tested an earlier swing low and closed back above it. Buyers defended the same price twice.');
  if (Math.abs(s.micro) >= 6) parts.push(s.micro > 0 ? `Bull micro channel: ${s.micro} bars without a lower low. Strong: the first pullback is usually bought, so do not short it yet.` : `Bear micro channel: ${-s.micro} bars without a higher high. Strong: the first bounce is usually sold, so do not buy it yet.`);
  const title = s.count ? `${s.count} bar` : s.wedge ? 'Wedge (3 pushes)' : s.dbl ? (s.dbl === 'DT' ? 'Double top' : 'Double bottom') : s.aiFlip ? 'Always-in flip' : s.bo ? 'Breakout' : 'Bar read';
  return { title, text: parts.join(' ') };
}

// ---------------------------------------------------------------- chart overlay
export function registerPriceAction() {
  registerIndicator<Record<string, number>, number>({
    name: 'JC_PA', shortName: 'PA', series: 'price', precision: 2, calcParams: [], figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: () => ({ name: 'Price action: bar counts, wedges, always-in', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, bounding, xAxis, yAxis }) => {
      const data = chart.getDataList();
      if (data.length < 30) return true;
      const S = paAnalyze(data);
      const range = chart.getVisibleRange();
      const bar = chart.getBarSpace().bar;
      if (bar < 4) return true;
      const x = (i: number) => xAxis.convertToPixel(i), y = (p: number) => yAxis.convertToPixel(p);
      ctx.save();
      ctx.font = `${bar >= 10 ? 11 : 9}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      // always-in strip at the bottom of the pane
      for (let i = Math.max(0, range.from); i < Math.min(data.length, range.to); i++) {
        const s = S[i];
        ctx.fillStyle = s.ai > 0 ? 'rgba(8,153,129,.55)' : s.ai < 0 ? 'rgba(242,54,69,.55)' : 'rgba(128,128,128,.3)';
        ctx.fillRect(x(i) - bar / 2, bounding.height - 4, bar + 1, 4);
        const b = data[i];
        const label = s.count || (s.wedge ? 'W3' : '') || s.dbl || '';
        if (!label) continue;
        const bull = s.count?.startsWith('H') || s.dbl === 'DB' || s.wedge === 'bottom';
        ctx.fillStyle = bull ? '#089981' : '#f23645';
        if (s.signalQuality === 'weak') ctx.globalAlpha = 0.55;
        if (bull) { ctx.textBaseline = 'top'; ctx.fillText(label, x(i), y(b.low) + 4); }
        else { ctx.textBaseline = 'bottom'; ctx.fillText(label, x(i), y(b.high) - 4); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return true;
    },
  });
}
