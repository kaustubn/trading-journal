// Price-action reading engine: common bar-by-bar ideas (bar types, "always in" direction, trend vs
// trading range, pullback bar counts H1/H2 and L1/L2, wedges = three pushes, double tops/bottoms,
// micro channels, breakouts with follow-through). These are widely taught price-action concepts
// (popularised by Al Brooks among others); the definitions and wording here are the journal's own
// simplified versions, not anyone's course material.
//
// NO LOOKAHEAD: paAnalyze walks the bars once, left to right; state[i] uses bars 0..i only. Swings are
// fractals with 2 bars each side, so a swing at bar s is only known at bar s + 2.
import { registerIndicator, KLineData } from 'klinecharts';
import { etMinutes, etOffset } from './time';

// FOMC statement days (federalreserve.gov), for the day-context note
const FOMC = new Set(['2021-11-03', '2021-12-15', '2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15', '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14',
  '2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13', '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
  '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18', '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']);

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
  trap: 1 | -1 | 0;               // failed breakout on this bar: 1 = failed bear BO (bear trap -> buy), -1 = failed bull BO (bull trap -> sell)
  climax: 1 | -1 | 0;             // buy climax (1) / sell climax (-1): 3 strong bars in a row far from the EMA
  maGap: 1 | -1 | 0;              // first touch of the EMA after 20+ bars away from it: 1 = in a bull trend (buy), -1 = bear
  tight: boolean;                 // tight trading range (breakout mode): last 10 bars inside ~2 ATR, overlapping
  io: 'inside' | 'outside' | 'ii' | 'ioi' | null;
  mm: number | null;              // measured-move target projected from a breakout bar
  open: { gap: number; gapPct: number; fomc: boolean } | null;   // first New York bar: gap vs yesterday's close (gapPct = share of yesterday's NY range)
  openType: 'trend from the open up' | 'trend from the open down' | 'trading range open' | null; // read after the first 30 min
  mtr: 1 | -1 | 0;                // major trend reversal signal bar: 1 = bull MTR (buy), -1 = bear MTR (sell)
  bp: 1 | -1 | 0;                 // breakout pullback signal bar (pullback that held the breakout point)
  mc1: 1 | -1 | 0;                // first pullback out of a micro channel (5+ bars), with-trend signal bar
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
  let lastBo: { i: number; dir: 1 | -1; level: number } | null = null;
  let aboveRun = 0, belowRun = 0;
  let rthClose = NaN, rthOpenI = -1, rthHi = -Infinity, rthLo = Infinity, prevRange = NaN;
  let tfMin = bars.length > 1 ? Math.max(1, Math.round((bars[1].timestamp - bars[0].timestamp) / 60000)) : 5;
  for (let k = 2; k < Math.min(bars.length, 50); k++) tfMin = Math.min(tfMin, Math.max(1, Math.round((bars[k].timestamp - bars[k - 1].timestamp) / 60000)));
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

    // failed breakout (trap): a 20-bar breakout in the last 1-3 bars, now closed back through the breakout level
    if (bo) lastBo = { i, dir: bo, level: bo > 0 ? hh : ll };
    let trap: 1 | -1 | 0 = 0;
    if (lastBo && !bo && i - lastBo.i <= 3) {
      if (lastBo.dir > 0 && b.close < lastBo.level) { trap = -1; lastBo = null; }
      else if (lastBo.dir < 0 && b.close > lastBo.level) { trap = 1; lastBo = null; }
    }
    // climax: 3 strong bars in a row, closing more than 2 ATR from the EMA
    let climax: 1 | -1 | 0 = 0;
    if (i >= 2) {
      const k3 = [out[i - 2]?.kind, out[i - 1]?.kind, kind];
      if (k3.every(k => k === 'bull trend' || k === 'bull') && k3.filter(k => k === 'bull trend').length >= 2 && b.close > ema + 2 * atr) climax = 1;
      else if (k3.every(k => k === 'bear trend' || k === 'bear') && k3.filter(k => k === 'bear trend').length >= 2 && b.close < ema - 2 * atr) climax = -1;
    }
    // EMA gap bar: first touch of the EMA after 20+ bars entirely on one side
    let maGap: 1 | -1 | 0 = 0;
    if (b.low <= ema && aboveRun >= 20 && ai >= 0) maGap = 1;
    else if (b.high >= ema && belowRun >= 20 && ai <= 0) maGap = -1;
    aboveRun = b.low > ema ? aboveRun + 1 : 0;
    belowRun = b.high < ema ? belowRun + 1 : 0;
    // tight trading range (breakout mode)
    let tight = false;
    if (i >= 10) {
      let th = -Infinity, tl = Infinity, small = 0;
      for (let k = i - 9; k <= i; k++) { th = Math.max(th, bars[k].high); tl = Math.min(tl, bars[k].low); if (out[k]?.kind === 'doji' || (k === i && kind === 'doji') || Math.abs(bars[k].close - bars[k].open) < 0.5 * atr) small++; }
      tight = th - tl <= 2 * atr && small >= 6;
    }
    // inside / outside bars
    const ins = !!p && b.high <= p.high && b.low >= p.low, outs = !!p && b.high > p.high && b.low < p.low;
    const pio = out[i - 1]?.io, ppio = out[i - 2]?.io;
    const io: PAState['io'] = ins && (pio === 'inside' || pio === 'ii') ? 'ii' : ins && pio === 'outside' && (ppio === 'inside' || ppio === 'ii') ? 'ioi' : ins ? 'inside' : outs ? 'outside' : null;
    // measured move from a breakout bar (its height projected beyond its close)
    const mm = bo ? b.close + bo * (b.high - b.low) : null;
    // New York open context
    let open: PAState['open'] = null, openType: PAState['openType'] = null;
    const em = etMinutes(b.timestamp);
    if (em >= 570 && em < 570 + tfMin && (i === 0 || etMinutes(bars[i - 1].timestamp) < 570 || bars[i - 1].timestamp < b.timestamp - 6 * 3600000)) {
      const date = new Date(b.timestamp + etOffset(b.timestamp)).toISOString().slice(0, 10);
      if (rthHi > -Infinity) prevRange = rthHi - rthLo;
      rthHi = -Infinity; rthLo = Infinity;
      const gap = Number.isNaN(rthClose) ? NaN : b.open - rthClose; // unknown without yesterday's session on the chart
      open = { gap, gapPct: prevRange > 0 ? gap / prevRange : 0, fomc: FOMC.has(date) };
      rthOpenI = i;
    }
    const nOpen = Math.max(1, Math.round(30 / tfMin));
    if (rthOpenI >= 0 && i === rthOpenI + nOpen - 1) {
      const o0 = bars[rthOpenI].open;
      let up = 0, dn = 0, hi = -Infinity, lo = Infinity;
      for (let k = rthOpenI; k <= i; k++) { if (bars[k].close > bars[k].open) up++; else if (bars[k].close < bars[k].open) dn++; hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
      const move = b.close - o0, span = hi - lo;
      openType = Math.abs(move) >= 0.6 * span && Math.abs(move) >= 1.5 * atr && Math.max(up, dn) >= 0.65 * nOpen
        ? (move > 0 ? 'trend from the open up' : 'trend from the open down') : 'trading range open';
    }
    if (em >= 570 && em < 960) { rthClose = b.close; rthHi = Math.max(rthHi, b.high); rthLo = Math.min(rthLo, b.low); }
    const bullish = count?.startsWith('H') || kind === 'bull reversal' || dbl === 'DB' || wedge === 'bottom';
    const bearish = count?.startsWith('L') || kind === 'bear reversal' || dbl === 'DT' || wedge === 'top';
    const signalQuality = bullish ? (cf >= 0.6 && kind !== 'doji' ? 'good' : 'weak') : bearish ? (cf <= 0.4 && kind !== 'doji' ? 'good' : 'weak') : null;
    out.push({ kind, atr, ema, ai, aiFlip, ctx, count, pushes, wedge, dbl, micro, bo, ft, signalQuality, trap, climax, maGap, tight, io, mm, open, openType, mtr: 0, bp: 0, mc1: 0 });
  }
  // second pass: setups that look back over many bars (still only bars 0..i for bar i, so no lookahead).
  // Same rules as trading-system/roboquant/brooks_more_test.cjs (tested on NQ 5m 2021-2026).
  for (let i = 30; i < bars.length; i++) {
    for (const dir of [1, -1] as const) {
      if (!out[i].mtr && mtrAt(bars, out, i, dir)) out[i].mtr = dir;
      if (!out[i].bp && bpAt(bars, out, i, dir)) out[i].bp = dir;
      if (!out[i].mc1 && mc1At(bars, out, i, dir)) out[i].mc1 = dir;
    }
  }
  cache.set(bars, out);
  return out;
}

/** Major trend reversal: a trend extreme (after 20 of 30 bars on the trend side of the EMA), a strong break of the
 *  EMA within 20 bars, then a test of the extreme, and a strong reversal bar on the test. */
function mtrAt(bars: KLineData[], S: PAState[], i: number, dir: 1 | -1): boolean {
  const a = S[i].atr;
  for (let x = i - 2; x >= Math.max(30, i - 40); x--) {
    const ext = dir > 0 ? bars[x].low : bars[x].high;
    let isExt = true;
    for (let y = x - 30; y < x; y++) if (dir > 0 ? bars[y].low < ext : bars[y].high > ext) { isExt = false; break; }
    if (!isExt) continue;
    let against = 0;
    for (let y = x - 29; y <= x; y++) if (dir > 0 ? bars[y].close < S[y].ema : bars[y].close > S[y].ema) against++;
    if (against < 20) continue;
    let brk = -1;
    for (let y = x + 1; y <= Math.min(i - 1, x + 20); y++) if (dir > 0 ? bars[y].close >= S[y].ema + 0.5 * S[y].atr : bars[y].close <= S[y].ema - 0.5 * S[y].atr) { brk = y; break; }
    if (brk < 0) return false;
    for (let y = x + 1; y <= i; y++) if (dir > 0 ? bars[y].low < ext - 0.25 * a : bars[y].high > ext + 0.25 * a) return false;
    if (i - brk > 20) return false;
    let test = -1;
    for (let y = brk + 1; y <= i; y++) if (Math.abs((dir > 0 ? bars[y].low : bars[y].high) - ext) <= 0.25 * a) test = y;
    if (test < 0) return false;
    const b = bars[i], rng = b.high - b.low;
    if (!(rng > 0)) return false;
    return dir > 0 ? b.close > b.open && b.close >= b.low + (rng * 2) / 3 : b.close < b.open && b.close <= b.high - (rng * 2) / 3;
  }
  return false;
}

/** Breakout pullback: a strong breakout bar of the last 20 bars' range 1-5 bars ago, then a pullback bar, and the
 *  pullback never got back to the breakout point. */
function bpAt(bars: KLineData[], S: PAState[], i: number, dir: 1 | -1): boolean {
  const b = bars[i];
  if (!(dir > 0 ? b.close < b.open : b.close > b.open)) return false;
  for (let x = i - 1; x >= Math.max(20, i - 5); x--) {
    const bo = bars[x], rng = bo.high - bo.low;
    if (!(rng >= S[x].atr && Math.abs(bo.close - bo.open) >= 0.6 * rng)) continue;
    let lvl = dir > 0 ? -Infinity : Infinity;
    for (let y = x - 20; y < x; y++) lvl = dir > 0 ? Math.max(lvl, bars[y].high) : Math.min(lvl, bars[y].low);
    if (!(dir > 0 ? bo.close > lvl && bo.close > bo.open : bo.close < lvl && bo.close < bo.open)) continue;
    for (let y = x + 1; y <= i; y++) if (dir > 0 ? bars[y].low <= lvl : bars[y].high >= lvl) return false;
    return true;
  }
  return false;
}

/** First pullback out of a micro channel: 5 bars in a row without a lower low (bull) on the trend side of the EMA,
 *  and this bar is the first to break the channel. */
function mc1At(bars: KLineData[], S: PAState[], i: number, dir: 1 | -1): boolean {
  const b = bars[i];
  if (!(dir > 0 ? b.low < bars[i - 1].low : b.high > bars[i - 1].high)) return false;
  for (let y = i - 5; y <= i - 1; y++) {
    if (dir > 0 ? !(bars[y].low >= bars[y - 1].low && bars[y].close > S[y].ema) : !(bars[y].high <= bars[y - 1].high && bars[y].close < S[y].ema)) return false;
  }
  return true;
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
  if (s.open) {
    const g = s.open.gap;
    parts.unshift(s.open.fomc ? 'FOMC DAY: the Fed statement is at 2:00 pm ET — mornings are often quiet and two-sided, the big move usually comes after 2:00.' : '');
    parts.unshift(Number.isNaN(g) ? 'New York open (yesterday is not on the chart, so the gap is unknown): the first bars decide between a trend from the open and a trading range.'
      : Math.abs(s.open.gapPct) < 0.1 ? `New York open with no real gap (${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(0)} pts vs yesterday's close): expect the first bars to decide between a trend from the open and a trading range.`
      : `New York open, gap ${g > 0 ? 'UP' : 'DOWN'} ${Math.abs(g).toFixed(0)} pts (${Math.round(Math.abs(s.open.gapPct) * 100)}% of yesterday's range). Common outcomes: a trend from the open in the gap direction, a reversal that fills the gap, or a trading range. The first few bars tell you which.`);
  }
  if (s.openType) parts.push(s.openType === 'trading range open'
    ? 'First 30 minutes = trading range open: overlapping two-sided bars. Odds favour a trading-range day or a late breakout; fade the extremes and do not chase.'
    : `First 30 minutes = ${s.openType.toUpperCase()}: one-sided bars from the open. On these days pullbacks are small and short; the with-trend side is the only side worth trading until a clear reversal.`);
  if (s.trap) parts.push(s.trap > 0 ? 'Failed bear breakout (bear trap): the break below the recent range reversed back above it. Trapped shorts must buy to get out, which often fuels a move up.' : 'Failed bull breakout (bull trap): the break above the recent range reversed back below it. Trapped longs must sell to get out, which often fuels a move down.');
  if (s.climax) parts.push(s.climax > 0 ? 'Buy climax: three strong bull bars, far above the EMA. Late buyers are paying a high price; climaxes usually lead to a trading range or a two-legged pullback — do not buy late here.' : 'Sell climax: three strong bear bars, far below the EMA. Late sellers are selling low; climaxes usually lead to a trading range or a two-legged bounce — do not sell late here.');
  if (s.maGap) parts.push(s.maGap > 0 ? 'EMA gap bar: the first touch of the 20-bar EMA after 20+ bars above it. In a strong bull trend that first touch is usually bought and leads to a test of the high.' : 'EMA gap bar: the first touch of the 20-bar EMA after 20+ bars below it. In a strong bear trend that first touch is usually sold and leads to a test of the low.');
  if (s.tight) parts.push('Tight trading range: small overlapping bars inside about 2 ATR — breakout mode. Most breakouts from here fail at first; wait for a clear breakout with follow-through, or fade the edges with small size.');
  if (s.io === 'ii') parts.push('ii: two inside bars in a row — the market is coiling. Expect a breakout soon; it often fails first.');
  else if (s.io === 'ioi') parts.push('ioi: inside, outside, inside — breakout mode. A stop entry beyond this bar in the trend direction is the usual play.');
  else if (s.io === 'outside') parts.push('Outside bar: it went above and below the prior bar — both sides got stopped out; the close shows who won.');
  if (s.mm != null) parts.push(`Measured-move target from this breakout bar: about ${s.mm.toFixed(0)} (its height projected beyond the close).`);
  if (s.mtr) parts.push(s.mtr > 0
    ? 'Major trend reversal (MTR) buy: the bear trend made a low, broke strongly above the EMA, came back to test the low and this bull reversal bar held it. Tested on NQ 5m 2021-2026: not proven, a study mark.'
    : 'Major trend reversal (MTR) sell: the bull trend made a high, broke strongly below the EMA, came back to test the high and this bear reversal bar held it. Tested on NQ 5m 2021-2026: not proven, a study mark.');
  if (s.bp) parts.push(s.bp > 0
    ? 'Breakout pullback (BP) buy: a strong bull breakout 1-5 bars ago, and this pullback held above the breakout point. On NQ 5m 2021-2026 it was slightly positive in all three test periods, but not beyond luck: watch-list only.'
    : 'Breakout pullback (BP) sell: a strong bear breakout 1-5 bars ago, and this rally held below the breakout point. On NQ 5m 2021-2026 it was slightly positive in all three test periods, but not beyond luck: watch-list only.');
  if (s.mc1) parts.push(s.mc1 > 0
    ? 'First pullback out of a bull micro channel (MC1): strong trends usually resume after the first pullback, a with-trend buy setup. Careful: on NQ 5m 2021-2026 this LOST about -0.18R per trade in every test period (the first pullback often failed).'
    : 'First bounce out of a bear micro channel (MC1): strong trends usually resume after the first bounce, a with-trend sell setup. Careful: on NQ 5m 2021-2026 this LOST about -0.18R per trade in every test period (the first bounce often failed).');
  if (Math.abs(s.micro) >= 6) parts.push(s.micro > 0 ? `Bull micro channel: ${s.micro} bars without a lower low. Strong: the first pullback is usually bought, so do not short it yet.` : `Bear micro channel: ${-s.micro} bars without a higher high. Strong: the first bounce is usually sold, so do not buy it yet.`);
  const title = s.count ? `${s.count} bar` : s.wedge ? 'Wedge (3 pushes)' : s.dbl ? (s.dbl === 'DT' ? 'Double top' : 'Double bottom') : s.aiFlip ? 'Always-in flip' : s.bo ? 'Breakout' : 'Bar read';
  const t2 = s.mtr ? 'Major trend reversal' : s.bp ? 'Breakout pullback' : s.mc1 ? 'Micro-channel pullback' : s.open ? 'New York open' : s.openType ? 'Opening type' : s.trap ? (s.trap > 0 ? 'Bear trap' : 'Bull trap') : s.climax ? (s.climax > 0 ? 'Buy climax' : 'Sell climax') : s.maGap ? 'EMA gap bar' : title;
  return { title: t2, text: parts.filter(Boolean).join(' ') };
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
        // first matching label wins; its direction decides the colour (green = buy setup, red = sell setup)
        const marks: [string, boolean][] = [];
        if (s.mtr) marks.push(['MTR', s.mtr > 0]);
        if (s.bp) marks.push(['BP', s.bp > 0]);
        if (s.count) marks.push([s.count, s.count.startsWith('H')]);
        if (s.wedge) marks.push(['W3', s.wedge === 'bottom']);
        if (s.dbl) marks.push([s.dbl, s.dbl === 'DB']);
        if (s.trap) marks.push(['TRAP', s.trap > 0]);
        if (s.climax) marks.push(['CLX', s.climax < 0]);
        if (s.mc1) marks.push(['MC1', s.mc1 > 0]);
        if (s.maGap) marks.push(['MAG', s.maGap > 0]);
        if (s.bo) marks.push(['BO', s.bo > 0]);
        if (s.io === 'ii' || s.io === 'ioi') marks.push([s.io, false]);
        if (!marks.length) continue;
        const [label, bull] = marks[0];
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
