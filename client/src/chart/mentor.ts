// Mentor engine: turns a course strategy into a bar-by-bar teacher.
//   DETECTORS  — rule functions that find a strategy's setup on closed bars (no future bars)
//   MentorFeed — walks the bars as replay reveals them and emits teaching messages:
//                market phase changes, smart-money events, each checklist step of the
//                strategy turning true, and the setup itself (which pauses for a quiz).
import type { Analysis, Bars, MarketEvent, Phase, Strategy } from './mentorTypes';
import { analyze, phaseAt } from './patterns';
import { etMinutes, sessionDay } from './time';
import { paAnalyze, paNarrate } from './priceAction';

export interface Step { label: string; done: boolean; }
export interface Signal {
  i: number; side: 'long' | 'short'; entry: number; stop: number; t1: number; t2: number; reason: string;
}
export interface DetectResult { steps: Step[]; signal: Signal | null; }
type Params = Record<string, number | string | boolean>;
export type Detector = (bars: Bars, i: number, a: Analysis, p: Params, tfMin: number) => DetectResult;

const num = (p: Params, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const tick = (v: number) => Math.round(v * 4) / 4;

function emaSeries(bars: Bars, n: number): number[] {
  const out: number[] = [];
  const k = 2 / (n + 1);
  let e = bars[0]?.close ?? 0;
  bars.forEach((b, i) => { e = i === 0 ? b.close : b.close * k + e * (1 - k); out.push(e); });
  return out;
}
const emaCache = new WeakMap<Bars, Map<number, number[]>>();
function ema(bars: Bars, n: number): number[] {
  let m = emaCache.get(bars);
  if (!m) { m = new Map(); emaCache.set(bars, m); }
  if (!m.has(n)) m.set(n, emaSeries(bars, n));
  return m.get(n)!;
}
const recent = (a: Analysis, i: number, kinds: MarketEvent['kind'][], within: number) =>
  [...a.events].reverse().find(e => e.i <= i && e.i >= i - within && kinds.includes(e.kind)) ?? null;
const closeFrac = (b: Bars[number]) => { const r = b.high - b.low; return r > 0 ? (b.close - b.low) / r : 0.5; };
function plan(i: number, side: 'long' | 'short', entry: number, stop: number, t1R: number, t2R: number, reason: string, t1?: number): Signal {
  const risk = Math.abs(entry - stop) || 1;
  const dir = side === 'long' ? 1 : -1;
  // a structural target (range edge, midpoint) closer than 1R is not worth the risk: use 1R
  const t1v = t1 !== undefined && (t1 - entry) * dir >= risk ? t1 : entry + dir * risk * Math.max(1, t1R);
  return { i, side, entry: tick(entry), stop: tick(stop), t1: tick(t1v), t2: tick(Math.max(t2R, Math.abs(t1v - entry) / risk + 0.5) * risk * dir + entry), reason };
}

// ---------------------------------------------------------------- detectors
export const DETECTORS: Record<string, { name: string; describe: string; fn: Detector }> = {
  wyckoff_spring: {
    name: 'Spring in accumulation (long)',
    describe: 'Range after a fall, a stop-run under the range low that closes back inside, then a bar closing above the spring bar high.',
    fn: (bars, i, a, p) => {
      const ph = phaseAt(a, i);
      const inAcc = !!ph && (ph.phase === 'accumulation' || ph.phase === 'range');
      const spring = recent(a, i, ['SPRING', 'SWEEP_LO'], num(p, 'within', 12));
      const sb = spring ? bars[spring.i] : null;
      const confirm = !!sb && i > spring!.i && bars[i].close > sb.high && closeFrac(bars[i]) >= 0.5;
      const steps = [
        { label: 'Trading range after a down-move (accumulation)', done: inAcc },
        { label: 'Spring: price runs the stops under the range low and closes back inside', done: inAcc && !!spring },
        { label: 'Confirmation: a bar closes above the spring bar high', done: inAcc && confirm },
      ];
      const signal = steps.every(s => s.done) && sb && ph
        ? plan(i, 'long', bars[i].close, Math.min(sb.low, spring!.price) - 0.25 * (a.atr[i] || 1), 1, 2, 'Spring confirmed inside accumulation', ph.hi > bars[i].close ? ph.hi : undefined)
        : null;
      return { steps, signal };
    },
  },
  wyckoff_upthrust: {
    name: 'Upthrust in distribution (short)',
    describe: 'Range after a rise, a stop-run over the range high that closes back inside, then a bar closing below the upthrust bar low.',
    fn: (bars, i, a, p) => {
      const ph = phaseAt(a, i);
      const inDist = !!ph && (ph.phase === 'distribution' || ph.phase === 'range');
      const ut = recent(a, i, ['UTAD', 'UT', 'SWEEP_HI'], num(p, 'within', 12));
      const ub = ut ? bars[ut.i] : null;
      const confirm = !!ub && i > ut!.i && bars[i].close < ub.low && closeFrac(bars[i]) <= 0.5;
      const steps = [
        { label: 'Trading range after an up-move (distribution)', done: inDist },
        { label: 'Upthrust: price runs the stops over the range high and closes back inside', done: inDist && !!ut },
        { label: 'Confirmation: a bar closes below the upthrust bar low', done: inDist && confirm },
      ];
      const signal = steps.every(s => s.done) && ub && ph
        ? plan(i, 'short', bars[i].close, Math.max(ub.high, ut!.price) + 0.25 * (a.atr[i] || 1), 1, 2, 'Upthrust confirmed inside distribution', ph.lo < bars[i].close ? ph.lo : undefined)
        : null;
      return { steps, signal };
    },
  },
  ema_pullback: {
    name: 'Trend pullback to the EMA',
    describe: 'Structure trending (HH/HL or LH/LL), a pullback that touches the EMA, a rejection bar closing at least half its range away.',
    fn: (bars, i, a, p) => {
      const n = num(p, 'ema', 21), rej = num(p, 'rejection', 0.5);
      const e = ema(bars, n)[i], b = bars[i], atr = a.atr[i] || 1;
      const tr = a.trend[i];
      const side: 'long' | 'short' | null = tr === 'up' ? 'long' : tr === 'down' ? 'short' : null;
      const touch = side === 'long' ? b.low <= e + 0.1 * atr && b.close > e : side === 'short' ? b.high >= e - 0.1 * atr && b.close < e : false;
      const reject = side === 'long' ? closeFrac(b) >= rej : side === 'short' ? 1 - closeFrac(b) >= rej : false;
      const steps = [
        { label: 'Trend: higher highs and higher lows (or lower highs and lower lows)', done: !!side },
        { label: `Pullback reaches the EMA ${n}`, done: !!side && touch },
        { label: `Rejection: the bar closes at least ${Math.round(rej * 100)}% of its range away from the EMA`, done: !!side && touch && reject },
      ];
      const signal = steps.every(s => s.done) && side
        ? plan(i, side, b.close, side === 'long' ? b.low - 0.25 * atr : b.high + 0.25 * atr, num(p, 't1R', 2.5), num(p, 't2R', 4), `Pullback to EMA ${n} with the trend`)
        : null;
      return { steps, signal };
    },
  },
  liquidity_sweep: {
    name: 'Liquidity sweep reversal',
    describe: 'A wick beyond a prior swing (stops taken) that closes back inside, not against a strong trend, confirmed by the next bar.',
    fn: (bars, i, a, p) => {
      const sw = recent(a, i, ['SWEEP_LO', 'SWEEP_HI', 'SPRING', 'UTAD', 'UT'], num(p, 'within', 2));
      const side: 'long' | 'short' | null = !sw ? null : ['SWEEP_LO', 'SPRING'].includes(sw.kind) ? 'long' : 'short';
      const strongAgainst = side === 'long' ? a.trend.slice(Math.max(0, i - 10), i + 1).filter(t => t === 'down').length >= 8
        : side === 'short' ? a.trend.slice(Math.max(0, i - 10), i + 1).filter(t => t === 'up').length >= 8 : false;
      const b = bars[i];
      const confirm = !!sw && i > sw.i && (side === 'long' ? b.close > bars[sw.i].high || b.close > b.open && closeFrac(b) > 0.6 : b.close < bars[sw.i].low || b.close < b.open && closeFrac(b) < 0.4);
      const steps = [
        { label: 'Sweep: a wick runs beyond a prior swing and closes back inside', done: !!sw },
        { label: 'Not against a strong trend (no 8 of the last 10 bars trending the other way)', done: !!sw && !strongAgainst },
        { label: 'Reclaim: the next bar confirms back in the sweep-failure direction', done: !!sw && !strongAgainst && confirm },
      ];
      const atr = a.atr[i] || 1;
      const signal = steps.every(s => s.done) && side && sw
        ? plan(i, side, b.close, side === 'long' ? bars[sw.i].low - 0.15 * atr : bars[sw.i].high + 0.15 * atr, num(p, 't1R', 2), num(p, 't2R', 3), 'Failed sweep: trapped traders fuel the reversal')
        : null;
      return { steps, signal };
    },
  },
  breakout_retest: {
    name: 'Break of structure and retest',
    describe: 'Price closes beyond the last swing (break of structure), comes back to test the broken level, and holds.',
    fn: (bars, i, a, p) => {
      const bos = recent(a, i, ['BOS_UP', 'BOS_DN', 'SOS', 'SOW'], num(p, 'within', 15));
      const side: 'long' | 'short' | null = !bos ? null : ['BOS_UP', 'SOS'].includes(bos.kind) ? 'long' : 'short';
      const b = bars[i], atr = a.atr[i] || 1, lvl = bos?.price ?? 0;
      const retest = !!bos && i > bos.i + 1 && (side === 'long' ? b.low <= lvl + 0.2 * atr && b.low >= lvl - 0.6 * atr : b.high >= lvl - 0.2 * atr && b.high <= lvl + 0.6 * atr);
      const hold = retest && (side === 'long' ? b.close > lvl && closeFrac(b) >= 0.5 : b.close < lvl && closeFrac(b) <= 0.5);
      const steps = [
        { label: 'Break of structure: a close beyond the last swing', done: !!bos },
        { label: 'Retest: price comes back to the broken level', done: retest },
        { label: 'Hold: the retest bar closes back on the breakout side', done: hold },
      ];
      const signal = hold && side
        ? plan(i, side, b.close, side === 'long' ? Math.min(b.low, lvl) - 0.3 * atr : Math.max(b.high, lvl) + 0.3 * atr, num(p, 't1R', 2), num(p, 't2R', 3), 'Broken level held on the retest')
        : null;
      return { steps, signal };
    },
  },
  range_fade: {
    name: 'Range extreme fade',
    describe: 'Inside a trading range, price tags the top or bottom and rejects with a long wick; fade back toward the middle.',
    fn: (bars, i, a, p) => {
      const ph = phaseAt(a, i);
      const inRange = !!ph && ['range', 'accumulation', 'distribution'].includes(ph.phase);
      const b = bars[i], atr = a.atr[i] || 1;
      const atTop = inRange && b.high >= ph!.hi - 0.2 * atr, atBot = inRange && b.low <= ph!.lo + 0.2 * atr;
      const side: 'long' | 'short' | null = atBot ? 'long' : atTop ? 'short' : null;
      const wick = side === 'long' ? (Math.min(b.open, b.close) - b.low) / Math.max(1e-9, b.high - b.low) >= num(p, 'wick', 0.5) && b.close > ph!.lo
        : side === 'short' ? (b.high - Math.max(b.open, b.close)) / Math.max(1e-9, b.high - b.low) >= num(p, 'wick', 0.5) && b.close < ph!.hi : false;
      const steps = [
        { label: 'A trading range is in play', done: inRange },
        { label: 'Price reaches the range extreme', done: !!side },
        { label: 'Wick rejection: the bar closes back inside with a long wick', done: !!side && wick },
      ];
      const mid = ph ? (ph.hi + ph.lo) / 2 : 0;
      const signal = steps.every(s => s.done) && side && ph
        ? plan(i, side, b.close, side === 'long' ? b.low - 0.2 * atr : b.high + 0.2 * atr, 1.5, 2, 'Fade at the range extreme', mid)
        : null;
      return { steps, signal };
    },
  },
  orb: {
    name: 'Opening range breakout',
    describe: 'The 9:30–9:45 ET range; a bar body closes fully beyond it with size; stop back inside.',
    fn: (bars, i, a, p) => {
      const b = bars[i];
      const m = etMinutes(b.timestamp);
      let hi = -Infinity, lo = Infinity, have = false;
      for (let j = i; j >= 0 && j > i - 200; j--) {
        const mj = etMinutes(bars[j].timestamp);
        if (mj < 570 && j < i) break;
        if (mj >= 570 && mj < 585 && Math.abs(bars[j].timestamp - b.timestamp) < 8 * 3600000) { hi = Math.max(hi, bars[j].high); lo = Math.min(lo, bars[j].low); have = true; }
      }
      const inWindow = m >= 585 && m < 660;
      // size filter: 0.15-0.50x the average New York session range of the earlier days on the chart
      const byDay = new Map<number, [number, number]>();
      const today = sessionDay(b.timestamp);
      for (let j = 0; j < i; j++) {
        const t = bars[j].timestamp, mj = etMinutes(t), d = sessionDay(t);
        if (mj < 570 || mj >= 960 || d === today) continue;
        const cur = byDay.get(d);
        byDay.set(d, cur ? [Math.max(cur[0], bars[j].high), Math.min(cur[1], bars[j].low)] : [bars[j].high, bars[j].low]);
      }
      const dayRanges = [...byDay.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v[0] - v[1]);
      const last = dayRanges.slice(-14);
      const dayAtr = last.length >= 3 ? last.reduce((s, v) => s + v, 0) / last.length : NaN;
      const lo2 = num(p, 'minAtr', 0.15), hi2 = num(p, 'maxAtr', 0.5);
      const rng = hi - lo, okRange = have && (Number.isNaN(dayAtr) || (rng >= lo2 * dayAtr && rng <= hi2 * dayAtr));
      const sizeTxt = Number.isNaN(dayAtr) ? 'size not checked (fewer than 3 days loaded)' : `${Math.round(rng)} pts = ${(rng / dayAtr).toFixed(2)}× day ATR, needs ${lo2}–${hi2}×`;
      const body = Math.abs(b.close - b.open);
      const side: 'long' | 'short' | null = Math.min(b.open, b.close) > hi ? 'long' : Math.max(b.open, b.close) < lo ? 'short' : null;
      const steps = [
        { label: `Opening range 9:30–9:45 ET built (${have ? sizeTxt : '0.15–0.50× day ATR'})`, done: okRange },
        { label: 'Inside the ORB trade window (9:45–11:00 ET)', done: okRange && inWindow },
        { label: `Break and hold: the whole body closes outside the range (body ≥ ${num(p, 'minBody', 8)} pts)`, done: okRange && inWindow && !!side && body >= num(p, 'minBody', 8) },
      ];
      const signal = steps.every(s => s.done) && side
        ? plan(i, side, b.close, side === 'long' ? hi - 3 : lo + 3, 2, 3, 'Opening range broken with a full body')
        : null;
      return { steps, signal };
    },
  },
};

// ---- price action (course 'Price action bar by bar'): uses chart/priceAction.ts
const paSide = (ai: number): 'long' | 'short' | null => (ai > 0 ? 'long' : ai < 0 ? 'short' : null);
const minRisk = (entry: number, stop: number, atr: number, side: 'long' | 'short') =>
  Math.abs(entry - stop) >= 0.4 * atr ? stop : side === 'long' ? entry - 0.4 * atr : entry + 0.4 * atr;
Object.assign(DETECTORS, {
  pa_second_entry: {
    name: 'Second entry with the trend (H2 / L2)',
    describe: 'Always-in direction clear and trending, a pullback, and the second attempt to resume the trend (H2 buy / L2 sell) on a strong signal bar.',
    fn: (bars: Bars, i: number) => {
      const S = paAnalyze(bars), s = S[i], b = bars[i];
      const side = paSide(s?.ai ?? 0);
      const want = side === 'long' ? 'H2' : 'L2';
      const steps = [
        { label: 'Always-in direction is clear and the market is trending (not a trading range)', done: !!side && s.ctx === 'trend' },
        { label: `A pullback is under way and price tries to resume the trend (${side === 'short' ? 'L1, L2' : 'H1, H2'})`, done: !!side && s.ctx === 'trend' && !!s.count && s.count[0] === (side === 'long' ? 'H' : 'L') },
        { label: `Second attempt: ${want} bar`, done: !!side && s.ctx === 'trend' && s.count === want },
        { label: 'Good signal bar: closes strongly in the trade direction, not a doji', done: !!side && s.ctx === 'trend' && s.count === want && s.signalQuality === 'good' },
      ];
      let signal = null;
      if (steps.every(x => x.done) && side) {
        const entry = side === 'long' ? b.high + 0.25 : b.low - 0.25;
        const stop = minRisk(entry, side === 'long' ? b.low - 0.25 : b.high + 0.25, s.atr, side);
        signal = plan(i, side, entry, stop, 1, 2, `${want}: second entry ${side === 'long' ? 'buy' : 'sell'} in an always-in ${side} trend. Entry = ${side === 'long' ? 'buy stop 1 tick above' : 'sell stop 1 tick below'} the signal bar, stop beyond its other end.`);
      }
      return { steps, signal };
    },
  },
  pa_wedge: {
    name: 'Wedge reversal (three pushes)',
    describe: 'Three pushes in a trend leg, then a reversal bar against it: fade for a two-legged pullback.',
    fn: (bars: Bars, i: number) => {
      const S = paAnalyze(bars), s = S[i], b = bars[i];
      let w: 'top' | 'bottom' | null = null, at = -1;
      for (let k = i; k >= Math.max(0, i - 3); k--) if (S[k]?.wedge) { w = S[k].wedge; at = k; break; }
      const side: 'long' | 'short' | null = w === 'top' ? 'short' : w === 'bottom' ? 'long' : null;
      const rev = side === 'short' ? (s.kind === 'bear reversal' || s.kind === 'bear trend') : side === 'long' ? (s.kind === 'bull reversal' || s.kind === 'bull trend') : false;
      const steps = [
        { label: 'A trend leg made three pushes (wedge) in the last few bars', done: !!w },
        { label: `A ${side === 'short' ? 'bear' : 'bull'} reversal bar after the third push`, done: !!w && i > at && rev },
      ];
      let signal = null;
      if (steps.every(x => x.done) && side) {
        let ext = side === 'short' ? -Infinity : Infinity;
        for (let k = at; k <= i; k++) ext = side === 'short' ? Math.max(ext, bars[k].high) : Math.min(ext, bars[k].low);
        const entry = side === 'short' ? b.low - 0.25 : b.high + 0.25;
        const stop = minRisk(entry, side === 'short' ? ext + 0.25 : ext - 0.25, s.atr, side);
        signal = plan(i, side, entry, stop, 1, 2, `Wedge ${w}: three pushes, then a reversal bar. Fade it for at least a two-legged pullback; stop beyond the wedge extreme.`);
      }
      return { steps, signal };
    },
  },
  pa_double: {
    name: 'Double top / double bottom',
    describe: 'Price tests an earlier swing high (low) and closes back strongly: the level held twice.',
    fn: (bars: Bars, i: number) => {
      const S = paAnalyze(bars), s = S[i], b = bars[i];
      const side: 'long' | 'short' | null = s?.dbl === 'DB' ? 'long' : s?.dbl === 'DT' ? 'short' : null;
      const steps = [
        { label: 'Price tests an earlier swing high / low (8-60 bars ago, within a quarter ATR) and closes back on the other side', done: !!side },
        { label: 'Good signal bar: strong close away from the level', done: !!side && s.signalQuality === 'good' },
        { label: 'Not fighting a strong micro channel', done: !!side && !(side === 'long' ? s.micro <= -6 : s.micro >= 6) },
      ];
      let signal = null;
      if (steps.every(x => x.done) && side) {
        const entry = side === 'long' ? b.high + 0.25 : b.low - 0.25;
        const stop = minRisk(entry, side === 'long' ? b.low - 0.25 : b.high + 0.25, s.atr, side);
        signal = plan(i, side, entry, stop, 1, 2, `${s.dbl === 'DB' ? 'Double bottom' : 'Double top'}: the same price was defended twice. Entry beyond the signal bar, stop beyond the test.`);
      }
      return { steps, signal };
    },
  },
  pa_trap: {
    name: 'Failed breakout (trap)',
    describe: 'A breakout of the last 20 bars reverses back through the breakout level within 3 bars: trade against the trapped traders.',
    fn: (bars: Bars, i: number) => {
      const S = paAnalyze(bars), s = S[i], b = bars[i];
      const side: 'long' | 'short' | null = s?.trap > 0 ? 'long' : s?.trap < 0 ? 'short' : null;
      const steps = [
        { label: 'A breakout of the last 20 bars happened 1-3 bars ago', done: !!side },
        { label: 'This bar closed back through the breakout level (the breakout failed)', done: !!side },
        { label: 'Not in a tight trading range (where everything fails both ways)', done: !!side && !s.tight },
      ];
      let signal = null;
      if (steps.every(x => x.done) && side) {
        let ext = side === 'long' ? Infinity : -Infinity;
        for (let k = Math.max(0, i - 3); k <= i; k++) ext = side === 'long' ? Math.min(ext, bars[k].low) : Math.max(ext, bars[k].high);
        const stop = minRisk(b.close, side === 'long' ? ext - 0.25 : ext + 0.25, s.atr, side);
        signal = plan(i, side, b.close, stop, 1, 2, `Failed ${side === 'long' ? 'bear' : 'bull'} breakout: trapped traders have to get out, which pushes price the other way. Stop beyond the failed breakout's extreme.`);
      }
      return { steps, signal };
    },
  },
  pa_ma_gap: {
    name: 'EMA gap bar (first touch of the 20-bar EMA)',
    describe: 'After 20+ bars on one side of the EMA, the first touch is usually a with-trend entry.',
    fn: (bars: Bars, i: number) => {
      const S = paAnalyze(bars), s = S[i], b = bars[i];
      const side: 'long' | 'short' | null = s?.maGap > 0 ? 'long' : s?.maGap < 0 ? 'short' : null;
      const steps = [
        { label: 'Price stayed on one side of the 20-bar EMA for 20+ bars (strong trend)', done: !!side },
        { label: 'This bar is the first to touch the EMA', done: !!side },
        { label: 'It closes back on the trend side of the EMA', done: !!side && (side === 'long' ? b.close > s.ema : b.close < s.ema) },
      ];
      let signal = null;
      if (steps.every(x => x.done) && side) {
        const entry = side === 'long' ? b.high + 0.25 : b.low - 0.25;
        const stop = minRisk(entry, side === 'long' ? b.low - 0.25 : b.high + 0.25, s.atr, side);
        signal = plan(i, side, entry, stop, 1, 2, `EMA gap bar: the first touch of the EMA in a strong ${side === 'long' ? 'bull' : 'bear'} trend is usually ${side === 'long' ? 'bought' : 'sold'}, aiming for a test of the trend extreme.`);
      }
      return { steps, signal };
    },
  },
  pa_bo_ft: {
    name: 'Breakout with follow-through',
    describe: 'A trend bar closes beyond the last 20 bars, the next bar follows through: join it for a second leg.',
    fn: (bars: Bars, i: number) => {
      const S = paAnalyze(bars), s = S[i], b = bars[i], prev = S[i - 1];
      const side: 'long' | 'short' | null = prev?.bo > 0 ? 'long' : prev?.bo < 0 ? 'short' : null;
      const steps = [
        { label: 'Breakout bar: a trend bar closed beyond the last 20 bars', done: !!side },
        { label: 'Follow-through: the next bar closes further in the breakout direction', done: !!side && !!s?.ft },
      ];
      let signal = null;
      if (steps.every(x => x.done) && side) {
        const bo = bars[i - 1];
        const stop = minRisk(b.close, side === 'long' ? bo.low - 0.25 : bo.high + 0.25, s.atr, side);
        signal = plan(i, side, b.close, stop, 1, 2, 'Breakout with follow-through: traders who missed it buy the first pullback, so a second leg is likely. Stop beyond the breakout bar.');
      }
      return { steps, signal };
    },
  },
});

// ---------------------------------------------------------------- teaching text
export const PHASE_TEACH: Record<Phase, string> = {
  accumulation: 'Accumulation: after a fall, price goes sideways. Big buyers absorb selling inside the range without chasing price up. Watch for a spring (stop-run under the lows) and a sign of strength.',
  markup: 'Markup: the buyers are done filling and price trends up with higher highs and higher lows. Pullbacks to support or the EMA are the entries; do not fade it.',
  distribution: 'Distribution: after a rise, price goes sideways. Big sellers unload into late buyers. Watch for an upthrust (stop-run over the highs) and a sign of weakness.',
  markdown: 'Markdown: supply wins and price trends down with lower highs and lower lows. Rallies into resistance are the entries; do not buy dips blindly.',
  range: 'Range: no clear side yet. Fade the edges or wait for a break of structure.',
};

// ---------------------------------------------------------------- feed
export type FeedKind = 'phase' | 'event' | 'step' | 'setup' | 'info';
export interface FeedMsg { id: number; kind: FeedKind; t: number; title: string; text: string; tag?: string; }

/**
 * Walks closed bars and reports what changed since the last call. Call `update` with the
 * window's bars (the last one may still be forming, so it is ignored) whenever replay moves.
 */
export class MentorFeed {
  private lastI = -1;
  private lastPhase: Phase | null = null;
  private seenEvents = new Set<string>();
  private stepState: boolean[] = [];
  private seq = 0;
  private lastSignal = -1000;
  /** A setup found by the search (practice): fire it at this bar even if this window's history differs a little. */
  expected: (Signal & { t: number }) | null = null;
  analysis: Analysis | null = null;
  steps: Step[] = [];
  constructor(public strategy: Strategy | null, public tfMin: number) {}

  reset() { this.lastI = -1; this.lastPhase = null; this.seenEvents.clear(); this.stepState = []; this.analysis = null; this.steps = []; this.lastSignal = -1000; }

  update(all: Bars, opts: { events: boolean } = { events: true }): { msgs: FeedMsg[]; signal: Signal | null } {
    const bars = all.slice(0, -1);              // drop the forming candle
    const n = bars.length;
    const msgs: FeedMsg[] = [];
    if (n < 30) return { msgs, signal: null };
    if (n - 1 < this.lastI) this.reset();       // went back in time (new replay)
    const a = analyze(bars, this.tfMin);
    this.analysis = a;
    const i = n - 1;
    const first = this.lastI < 0;
    const push = (kind: FeedKind, t: number, title: string, text: string, tag?: string) => msgs.push({ id: ++this.seq, kind, t, title, text, tag });

    const narrate = !!this.strategy?.detector?.params?.narrate;
    if (narrate) {                              // price-action course: read every new bar aloud
      for (let k = first ? i : Math.max(this.lastI + 1, i - 2); k <= i; k++) {
        const nr = paNarrate(bars, k);
        if (nr) push('info', bars[k].timestamp, nr.title, nr.text);
      }
    }
    const ph = narrate ? null : phaseAt(a, i);
    if (ph && ph.phase !== this.lastPhase) {
      push('phase', bars[i].timestamp, `Phase: ${ph.phase[0].toUpperCase()}${ph.phase.slice(1)}`, PHASE_TEACH[ph.phase]);
      this.lastPhase = ph.phase;
    }
    if (opts.events && !narrate) {
      const from = first ? i - 3 : this.lastI + 1;
      for (const e of a.events) {
        if (e.i < from || e.i > i) continue;
        const key = `${bars[e.i].timestamp}:${e.kind}`;
        if (this.seenEvents.has(key)) continue;
        this.seenEvents.add(key);
        if (['INSIDE', 'DOJI'].includes(e.kind)) continue;   // too common to narrate
        push('event', bars[e.i].timestamp, e.text, e.teach, e.kind);
      }
    }
    let signal: Signal | null = null;
    if (this.strategy?.detector && DETECTORS[this.strategy.detector.key]) {
      const r = DETECTORS[this.strategy.detector.key].fn(bars, i, a, this.strategy.detector.params ?? {}, this.tfMin);
      this.steps = r.steps;
      r.steps.forEach((s, k) => {
        if (s.done && !this.stepState[k]) push('step', bars[i].timestamp, `Step ${k + 1} ✓`, s.label);
      });
      this.stepState = r.steps.map(s => s.done);
      if (r.signal && r.signal.i === i && i - this.lastSignal > 6) signal = r.signal;
    }
    const ex = this.expected;
    if (!signal && ex && bars[i].timestamp === ex.t && i - this.lastSignal > 6) {
      signal = { ...ex, i };
      this.steps = this.steps.map(s => ({ ...s, done: true }));
    }
    if (signal && this.strategy) {
      this.lastSignal = i;
      if (ex && bars[i].timestamp >= ex.t) this.expected = null;
      push('setup', bars[i].timestamp, `${this.strategy.name}: setup`, signal.reason);
    }
    this.lastI = i;
    return { msgs, signal };
  }
}

/** Every bar where a strategy's detector fires, scanning bars as they would have appeared (no future). */
export function findSetups(bars: Bars, strategy: Strategy, tfMin: number, max = 20): Signal[] {
  const det = strategy.detector && DETECTORS[strategy.detector.key];
  if (!det || bars.length < 40) return [];
  // A full pass finds candidates fast, but phases can be relabelled by later bars; so each
  // candidate is re-checked with only the bars up to it, exactly as replay would see it.
  const a = analyze(bars, tfMin);
  const out: Signal[] = [];
  for (let i = 30; i < bars.length && out.length < max; i++) {
    const r = det.fn(bars, i, a, strategy.detector!.params ?? {}, tfMin);
    if (!r.signal || (out.length && i - out[out.length - 1].i <= 6)) continue;
    const upTo = bars.slice(0, i + 1);
    const again = det.fn(upTo, i, analyze(upTo, tfMin), strategy.detector!.params ?? {}, tfMin).signal;
    if (again) out.push(again);
  }
  return out;
}

/** Plain description of one bar for "Explain this bar". */
export function explainBar(bars: Bars, i: number, a: Analysis): string[] {
  const b = bars[i];
  if (!b) return [];
  const out: string[] = [];
  const r = b.high - b.low, body = Math.abs(b.close - b.open), atr = a.atr[i] || 1;
  out.push(`${b.close >= b.open ? 'Up' : 'Down'} bar, range ${r.toFixed(2)} pts (${(r / atr).toFixed(1)}× ATR), body ${r ? Math.round((body / r) * 100) : 0}% of range, closed in the ${closeFrac(b) > 0.66 ? 'top' : closeFrac(b) < 0.34 ? 'bottom' : 'middle'} third.`);
  const tr = a.trend[i];
  out.push(tr === 'up' ? 'Structure: higher highs and higher lows (buyers in control).' : tr === 'down' ? 'Structure: lower highs and lower lows (sellers in control).' : 'Structure: mixed, no clear trend.');
  const ph = phaseAt(a, i);
  if (ph) out.push(PHASE_TEACH[ph.phase]);
  for (const e of a.events.filter(e => e.i === i)) out.push(`${e.text}: ${e.teach}`);
  return out;
}
