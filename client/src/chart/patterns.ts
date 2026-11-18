// Market-structure / smart-money pattern engine for the market chart.
//   analyze()        swings, structure trend, candle patterns, BOS / sweeps and a Wyckoff-style
//                    phase read (accumulation -> spring -> markup -> distribution -> markdown)
//   registerPhases() the JC_PHASES overlay that draws it on the candle pane
//
// NO LOOKAHEAD. analyze() walks the bars once, left to right, and everything it reports at bar i
// was decided from bars 0..i only, so it is safe to run during bar replay:
//   - A swing at bar s (Swing.i = s) is a fractal: it needs `lookback` bars on each side, so it is
//     only known at bar s + lookback. It enters the structure at that bar, never earlier.
//     Trend, BOS and sweeps at bar i use only swings confirmed by bar i.
//   - Every event's `i` is the bar it was confirmed on. Events built from a swing or a climax
//     (AR, ST, LPS, LPSY, SC, BC) refer back to an earlier bar; that bar is in `at` (always <= i),
//     see PatternEvent. Events are emitted in order of `i` and never retracted.
//   - Phase spans CAN be revised as bars arrive (a box is only recognised after ~20 bars inside it,
//     a "range" becomes accumulation once a spring and a sign of strength follow, a failed range is
//     relabelled), but every revision is computed only from bars <= the last bar given.
//   - The swing list is the structure as of the last bar: a swing high that a later, higher swing
//     high replaced before the next swing low formed is dropped from the final list.
import { registerIndicator, KLineData } from 'klinecharts';
import type { Analysis, EventKind, MarketEvent, Phase, PhaseSpan, Swing } from './mentorTypes';

/** MarketEvent plus where to draw it. `at` <= `i`; `ref` = bar of the swing a BOS / sweep refers to. */
export interface PatternEvent extends MarketEvent { at: number; ref?: number }
export interface PhasesExt { tfMin: number }

/** Fractal swing lookback (bars each side) for a timeframe in minutes. */
export function swingLookback(tfMin: number): number {
  return tfMin <= 2 ? 5 : tfMin >= 240 ? 2 : 3;
}

// ---- tuning (ATR multiples unless noted) ----
const ATR_LEN = 14;
const SWING_SEP = 0.5;          // successive swings at least this far apart
const ENGULF_BODY = 0.6, PIN_RANGE = 0.8, DOJI_RANGE = 0.5, QUIET = 0.4;
const VOL_LEN = 20, VOL_SPIKE = 2;
const SWEEP_MIN = 0.15;
const RANGE_W = 20;             // bars a box must hold before it counts as a range
const RANGE_MAX = 3.5, RANGE_MIN = 1.5;
const MOVE_LOOK = 48;           // bars before a range searched for the move into it
const MOVE_MIN = 3;             // prior extreme at least this far beyond the box
const CLX_VOL = 1.8, CLX_RANGE = 1.2, CLX_DROP = 4, CLX_BOUNCE = 1.5, CLX_WAIT = 12;
const BREAK = 0.3, BREAK_BARS = 3, PROBE_MAX = 2, PROBE_GAP = 6;

const T: Record<string, [string, string]> = {
  SC: ['SC', 'Selling climax: after a long drop, sellers dumped in a burst of heavy volume. Large buyers tend to soak up that panic, which is why the slide often stops here.'],
  AR_ACC: ['AR', 'Automatic rally: once the panic selling dried up, price bounced hard. The top of this bounce often becomes the ceiling of the range where big buyers build their position.'],
  ST_ACC: ['ST', 'Secondary test: price came back near the climax low, but with less volume. Less selling at the same price suggests the supply is being absorbed by bigger buyers.'],
  SPRING: ['Spring', 'Price poked below the range floor, setting off the sell stops parked there, then closed back inside. Large buyers like to fill size against those forced sellers right before a markup.'],
  LPS: ['LPS', 'Last point of support: a pullback that held above the previous low. Sellers could not push price lower again, so big buyers appear to be defending this area.'],
  SOS: ['SOS', 'Sign of strength: price closed firmly above the range top. Buyers have taken control, and the base is likely turning into a markup.'],
  BC: ['BC', 'Buying climax: after a long rally, buyers piled in on heavy volume. Large holders often use that eager buying to unload, so the rise frequently stalls here.'],
  AR_DIST: ['AR', 'Automatic reaction: once the buying frenzy cooled, price dropped sharply. The low of this drop often becomes the floor of the range where big players keep selling.'],
  ST_DIST: ['ST', 'Secondary test: price returned near the climax high, but with less volume. Weaker buying at the same level hints that demand is fading while big sellers keep supplying.'],
  UT: ['UT', 'Upthrust: price pushed above the range top and fell back inside. That grabbed the buy stops of shorts and breakout buyers, handing big sellers someone to sell to.'],
  UTAD: ['UTAD', 'Upthrust after distribution: a late push above the range that failed and closed back inside. It traps breakout buyers, and large players often finish selling into it before a markdown.'],
  LPSY: ['LPSY', 'Last point of supply: a bounce that stalled below the prior high. Buyers are too weak to make new highs, so the easier path is turning down.'],
  SOW: ['SOW', 'Sign of weakness: price closed firmly below the range floor. Sellers have taken control, and the top is likely turning into a markdown.'],
  BOS_UP: ['BOS ↑', 'Break of structure: price closed above the last swing high. Buyers pushed through a level sellers had defended, so the down-structure is broken.'],
  BOS_DN: ['BOS ↓', 'Break of structure: price closed below the last swing low. Sellers pushed through a level buyers had defended, so the up-structure is broken.'],
  SWEEP_HI: ['Sweep ↑', 'Price wicked above a recent swing high and closed back below it. The stops resting above that high were triggered, and big sellers may have used that buying to get short.'],
  SWEEP_LO: ['Sweep ↓', 'Price wicked under a recent swing low and closed back above it. The stops resting below that low were taken, and big buyers may have used that selling to get long.'],
  ENGULF_UP: ['Engulf ↑', 'A strong up candle swallowed the body of the previous down candle. Buyers overpowered sellers in a single bar, a hint that demand stepped in.'],
  ENGULF_DN: ['Engulf ↓', 'A strong down candle swallowed the body of the previous up candle. Sellers overpowered buyers in a single bar, a hint that supply stepped in.'],
  PIN_UP: ['Pin ↑', 'Long lower wick: sellers drove price down but buyers forced it back up before the close. At support this shows lower prices being rejected.'],
  PIN_DN: ['Pin ↓', 'Long upper wick: buyers drove price up but sellers forced it back down before the close. At resistance this shows higher prices being rejected.'],
  INSIDE: ['Inside', 'This bar stayed within the previous bar\'s range. The market is pausing; a break of its high or low often shows where the next push goes.'],
  DOJI: ['Doji', 'Open and close are almost the same: buyers and sellers fought to a draw. After a strong move it can warn that momentum is fading.'],
  VOL_SPIKE: ['Vol', 'Volume is far above normal for this bar, so large participants were active here. The price level where that happened often matters again later.'],
};

interface Sw { i: number; price: number; type: 'H' | 'L'; broken: boolean; swept: boolean }
type RangeKind = 'accumulation' | 'distribution' | 'range';
interface Rng {
  from: number; to: number; hi: number; lo: number; kind: RangeKind;
  move: number; anchored: boolean; failed: boolean;
  hiAt: number; loAt: number; hiVol: number; loVol: number;
  springs: number; uts: number; sts: number; sos: boolean; sow: boolean;
  lastUp: number; lastDn: number;   // bar of the last upthrust / spring (keeps them apart)
  exc: { side: 1 | -1; start: number; ext: number; extAt: number } | null;
}
interface Clx { dir: 1 | -1; at: number; price: number; vol: number; A: number }
interface Watch { after: number; until: number; test: (s: Sw, A: number) => boolean }

export function analyze(bars: KLineData[], tfMin: number): Analysis {
  const n = bars.length;
  const events: PatternEvent[] = [];
  const trend: Analysis['trend'] = new Array(n);
  const atr: number[] = new Array(n);
  if (!n) return { swings: [], phases: [], events, trend, atr };

  const O = new Float64Array(n), Hh = new Float64Array(n), Ll = new Float64Array(n), C = new Float64Array(n), V = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    O[i] = b.open; Hh[i] = b.high; Ll[i] = b.low; C[i] = b.close; V[i] = b.volume ?? 0;
  }
  const lb = swingLookback(tfMin);

  // ATR(14), Wilder/RMA; seeded with the running mean of true range for the first 14 bars
  let trSum = 0;
  for (let i = 0; i < n; i++) {
    const tr = i ? Math.max(Hh[i] - Ll[i], Math.abs(Hh[i] - C[i - 1]), Math.abs(Ll[i] - C[i - 1])) : Hh[i] - Ll[i];
    if (i < ATR_LEN) { trSum += tr; atr[i] = trSum / (i + 1); }
    else atr[i] = (atr[i - 1] * (ATR_LEN - 1) + tr) / ATR_LEN;
  }

  const emit = (kind: EventKind, key: string, i: number, price: number, at: number, ref?: number) => {
    const [text, teach] = T[key];
    const e: PatternEvent = { i, kind, price, text, teach, at };
    if (ref !== undefined) e.ref = ref;
    events.push(e);
  };

  const sw: Sw[] = [];
  const lastOf = (type: 'H' | 'L'): Sw | null => {
    for (let k = sw.length - 1; k >= 0 && k >= sw.length - 2; k--) if (sw[k].type === type) return sw[k];
    return null;
  };
  /** Add a confirmed fractal; keeps the list alternating H/L and SWING_SEP apart. */
  const addSwing = (s: Sw, A: number): Sw | null => {
    const last = sw[sw.length - 1];
    if (!last) { sw.push(s); return s; }
    if (last.type === s.type) {
      if (s.type === 'H' ? s.price > last.price : s.price < last.price) { sw[sw.length - 1] = s; return s; }
      return null;
    }
    const sep = s.type === 'H' ? s.price - last.price : last.price - s.price;
    if (sep < SWING_SEP * A) return null;
    sw.push(s);
    return s;
  };

  const ranges: Rng[] = [];
  let R: Rng | null = null;
  let lastRangeEnd = -1, lastRangeTo = -1;
  let candSC: Clx | null = null, candBC: Clx | null = null, ctx: Clx | null = null;
  let lpsW: Watch | null = null, lpsyW: Watch | null = null;
  let leg: 'up' | 'down' | null = null;
  let legSince = -1;   // bar a range breakout started the leg: structure lags, so the leg holds for RANGE_W bars
  const legLab: (Phase | null)[] = new Array(n).fill(null);
  let volSum = 0;

  const moveInto = (from: number, hi: number, lo: number, A: number): number => {
    const s0 = Math.max(0, from - MOVE_LOOK);
    if (from - s0 < 12) return 0;
    let ph = -Infinity, phI = -1, pl = Infinity, plI = -1;
    for (let j = s0; j < from; j++) {
      if (Hh[j] > ph) { ph = Hh[j]; phI = j; }
      if (Ll[j] < pl) { pl = Ll[j]; plI = j; }
    }
    const dn = (ph - hi) / A, up = (lo - pl) / A;
    const dnOk = dn >= MOVE_MIN, upOk = up >= MOVE_MIN;
    // Both: the later extreme is where the most recent leg into the box started
    if (dnOk && upOk) return phI < plI ? up : -dn;
    return dnOk ? -dn : upOk ? up : 0;
  };
  const newRange = (from: number, to: number, kind: RangeKind | null, anchored: boolean, A: number): Rng => {
    let hi = -Infinity, lo = Infinity, hiAt = from, loAt = from;
    for (let j = from; j <= to; j++) {
      if (Hh[j] > hi) { hi = Hh[j]; hiAt = j; }
      if (Ll[j] < lo) { lo = Ll[j]; loAt = j; }
    }
    const move = moveInto(from, hi, lo, A);
    const k: RangeKind = kind ?? (move <= -MOVE_MIN ? 'accumulation' : move >= MOVE_MIN ? 'distribution' : 'range');
    return {
      from, to, hi, lo, kind: k, move, anchored, failed: false,
      hiAt, loAt, hiVol: V[hiAt], loVol: V[loAt],
      springs: 0, uts: 0, sts: 0, sos: false, sow: false, lastUp: -99, lastDn: -99, exc: null,
    };
  };

  for (let i = 0; i < n; i++) {
    const A = Math.max(i ? atr[i - 1] : atr[0], 1e-9);
    const o = O[i], h = Hh[i], l = Ll[i], c = C[i];
    const rng = h - l, body = Math.abs(c - o);
    const warm = i >= ATR_LEN;
    const avgV = i >= VOL_LEN ? volSum / VOL_LEN : NaN;

    // ---- swings: the fractal at i - lb is confirmed now ----
    const fresh: Sw[] = [];
    const cI = i - lb;
    if (cI - lb >= 0) {
      let isH = true, isL = true;
      for (let j = cI - lb; j <= i; j++) {
        if (j === cI) continue;
        if (j < cI) { if (Hh[j] >= Hh[cI]) isH = false; if (Ll[j] <= Ll[cI]) isL = false; }
        else { if (Hh[j] > Hh[cI]) isH = false; if (Ll[j] < Ll[cI]) isL = false; }
      }
      const tryAdd = (type: 'H' | 'L') => {
        const s = addSwing({ i: cI, price: type === 'H' ? Hh[cI] : Ll[cI], type, broken: false, swept: false }, A);
        if (s) fresh.push(s);
      };
      const lastType = sw.length ? sw[sw.length - 1].type : 'L';
      if (lastType === 'L') { if (isH) tryAdd('H'); if (isL) tryAdd('L'); }
      else { if (isL) tryAdd('L'); if (isH) tryAdd('H'); }
    }
    const sH = lastOf('H'), sL = lastOf('L');

    // ---- structure trend from the last two swing highs and lows ----
    {
      let h1 = NaN, h2 = NaN, l1 = NaN, l2 = NaN;
      for (let k = sw.length - 1; k >= 0 && k >= sw.length - 4; k--) {
        const s = sw[k];
        if (s.type === 'H') { if (Number.isNaN(h2)) h2 = s.price; else if (Number.isNaN(h1)) h1 = s.price; }
        else { if (Number.isNaN(l2)) l2 = s.price; else if (Number.isNaN(l1)) l1 = s.price; }
      }
      trend[i] = h2 > h1 && l2 > l1 ? 'up' : h2 < h1 && l2 < l1 ? 'down' : 'flat';
    }

    // ---- candle patterns ----
    if (warm) {
      const po = O[i - 1], pc = C[i - 1];
      let pin = false;
      if (pc < po && c > o && o <= pc && c >= po && body > pc - po && body >= ENGULF_BODY * A) emit('ENGULF_UP', 'ENGULF_UP', i, l, i);
      if (pc > po && c < o && o >= pc && c <= po && body > po - pc && body >= ENGULF_BODY * A) emit('ENGULF_DN', 'ENGULF_DN', i, h, i);
      if (rng >= PIN_RANGE * A) {
        const lower = Math.min(o, c) - l, upper = h - Math.max(o, c);
        if (lower >= 2 * body && lower >= 0.6 * rng) { emit('PIN_UP', 'PIN_UP', i, l, i); pin = true; }
        else if (upper >= 2 * body && upper >= 0.6 * rng) { emit('PIN_DN', 'PIN_DN', i, h, i); pin = true; }
      }
      if (rng >= QUIET * A) {
        if (h <= Hh[i - 1] && l >= Ll[i - 1] && rng < Hh[i - 1] - Ll[i - 1]) emit('INSIDE', 'INSIDE', i, h, i);
        if (!pin && rng >= DOJI_RANGE * A && body <= 0.1 * rng) emit('DOJI', 'DOJI', i, c, i);
      }
      if (avgV > 0 && V[i] >= VOL_SPIKE * avgV) {
        events.push({ i, kind: 'VOL_SPIKE', price: c, text: `Vol ${(V[i] / avgV).toFixed(1)}×`, teach: T.VOL_SPIKE[1], at: i });
      }
    }

    // ---- break of structure / liquidity sweeps (once per swing) ----
    if (sH && !sH.broken) {
      if (c > sH.price) { emit('BOS_UP', 'BOS_UP', i, sH.price, i, sH.i); sH.broken = true; leg = 'up'; legSince = -1; }
      else if (!sH.swept && h >= sH.price + SWEEP_MIN * A) { emit('SWEEP_HI', 'SWEEP_HI', i, sH.price, i, sH.i); sH.swept = true; }
    }
    if (sL && !sL.broken) {
      if (c < sL.price) { emit('BOS_DN', 'BOS_DN', i, sL.price, i, sL.i); sL.broken = true; leg = 'down'; legSince = -1; }
      else if (!sL.swept && l <= sL.price - SWEEP_MIN * A) { emit('SWEEP_LO', 'SWEEP_LO', i, sL.price, i, sL.i); sL.swept = true; }
    }

    // ---- climaxes (SC / BC): confirmed by the bounce off the extreme ----
    if (candSC && candSC.at < i) {
      if (l < candSC.price - 0.25 * candSC.A || i - candSC.at > CLX_WAIT) candSC = null;
      else if (c >= candSC.price + CLX_BOUNCE * candSC.A) {
        emit('SC', 'SC', i, candSC.price, candSC.at);
        ctx = candSC; candSC = null;
      }
    }
    if (candBC && candBC.at < i) {
      if (h > candBC.price + 0.25 * candBC.A || i - candBC.at > CLX_WAIT) candBC = null;
      else if (c <= candBC.price - CLX_BOUNCE * candBC.A) {
        emit('BC', 'BC', i, candBC.price, candBC.at);
        ctx = candBC; candBC = null;
      }
    }
    if (ctx) {
      const dead = ctx.dir < 0 ? c < ctx.price - 0.25 * ctx.A : c > ctx.price + 0.25 * ctx.A;
      if (dead || i - ctx.at > 3 * RANGE_W) ctx = null;
    }

    // ---- swing-based Wyckoff events (AR, ST, LPS, LPSY) ----
    for (const s of fresh) {
      if (ctx && s.i > ctx.at) {
        const acc = ctx.dir < 0;
        if (acc ? s.type === 'H' && s.price >= ctx.price + CLX_BOUNCE * A : s.type === 'L' && s.price <= ctx.price - CLX_BOUNCE * A) {
          emit('AR', acc ? 'AR_ACC' : 'AR_DIST', i, s.price, s.i);
          const kind: RangeKind = acc ? 'accumulation' : 'distribution';
          if (R && R.exc === null) {
            const merged = newRange(Math.min(R.from, ctx.at), i, kind, true, A);
            merged.springs = R.springs; merged.uts = R.uts; merged.sts = R.sts; merged.lastUp = R.lastUp; merged.lastDn = R.lastDn;
            ranges[ranges.length - 1] = merged; R = merged;
          } else if (!R && ctx.at > lastRangeTo) {
            const r = newRange(ctx.at, i, kind, true, A);
            if (r.hi - r.lo <= 2 * RANGE_MAX * A) { ranges.push(r); R = r; }
          }
          ctx = null;
          continue;
        }
      }
      if (R && !R.exc) {
        const zone = Math.max(0.6 * A, 0.3 * (R.hi - R.lo));
        if (R.kind === 'accumulation' && s.type === 'L' && !R.springs && R.sts < 2 && s.i > Math.max(R.loAt + 2, R.anchored ? R.hiAt : -1)
          && s.price >= R.lo - SWEEP_MIN * A && s.price <= R.lo + zone && V[s.i] < 0.8 * R.loVol) {
          emit('ST', 'ST_ACC', i, s.price, s.i); R.sts++;
        }
        if (R.kind === 'distribution' && s.type === 'H' && !R.uts && R.sts < 2 && s.i > Math.max(R.hiAt + 2, R.anchored ? R.loAt : -1)
          && s.price <= R.hi + SWEEP_MIN * A && s.price >= R.hi - zone && V[s.i] < 0.8 * R.hiVol) {
          emit('ST', 'ST_DIST', i, s.price, s.i); R.sts++;
        }
      }
      if (lpsW && s.type === 'L' && s.i > lpsW.after) {
        if (lpsW.test(s, A)) emit('LPS', 'LPS', i, s.price, s.i);
        lpsW = null;
      }
      if (lpsyW && s.type === 'H' && s.i > lpsyW.after) {
        if (lpsyW.test(s, A)) emit('LPSY', 'LPSY', i, s.price, s.i);
        lpsyW = null;
      }
    }
    if (lpsW && i > lpsW.until) lpsW = null;
    if (lpsyW && i > lpsyW.until) lpsyW = null;

    // ---- active range: probes beyond the box, breakouts ----
    if (R) {
      const r: Rng = R;
      const upthrust = (price: number, at: number) => {
        const depth = price - r.hi;
        if (r.kind === 'accumulation' || r.uts >= 2 || at - r.lastUp < PROBE_GAP || depth < SWEEP_MIN * A || depth > PROBE_MAX * A) return;
        r.lastUp = at;
        const late = r.kind === 'distribution' && (r.uts > 0 || at - r.from >= 2 * RANGE_W);
        emit(late ? 'UTAD' : 'UT', late ? 'UTAD' : 'UT', i, price, at);
        r.uts++;
        const lo = r.lo;
        lpsyW = { after: at, until: i + 3 * RANGE_W, test: (s, a) => s.price < price - 0.25 * a && s.price > lo };
      };
      const spring = (price: number, at: number) => {
        const depth = r.lo - price;
        if (r.kind === 'distribution' || r.springs >= 2 || at - r.lastDn < PROBE_GAP || depth < SWEEP_MIN * A || depth > PROBE_MAX * A) return;
        r.lastDn = at;
        emit('SPRING', 'SPRING', i, price, at);
        r.springs++;
        const hi = r.hi;
        lpsW = { after: at, until: i + 3 * RANGE_W, test: (s, a) => s.price > price + 0.25 * a && s.price < hi };
      };
      const end = (dir: 1 | -1, to: number) => {
        r.to = Math.max(r.from, to);
        if (dir > 0) {
          if (r.kind === 'distribution') { r.kind = 'range'; r.failed = true; }
          else if (r.kind === 'range' && r.springs > 0 && r.sos) r.kind = 'accumulation';
        } else {
          if (r.kind === 'accumulation') { r.kind = 'range'; r.failed = true; }
          else if (r.kind === 'range' && r.uts > 0 && r.sow) r.kind = 'distribution';
        }
        leg = dir > 0 ? 'up' : 'down';
        legSince = r.to + 1;
        for (let j = r.to + 1; j <= i; j++) legLab[j] = dir > 0 ? 'markup' : 'markdown';
        lastRangeEnd = i; lastRangeTo = r.to;
        if (ctx && ctx.at <= i) ctx = null;   // the climax belonged to this range
        R = null;
      };
      const strongUp = c >= r.hi + BREAK * A && c > o && body >= 0.4 * A && (c - l) >= 0.5 * rng;
      const strongDn = c <= r.lo - BREAK * A && c < o && body >= 0.4 * A && (h - c) >= 0.5 * rng;

      if (!r.exc) {
        if (c <= r.hi && h >= r.hi + SWEEP_MIN * A) upthrust(h, i);
        if (c >= r.lo && l <= r.lo - SWEEP_MIN * A) spring(l, i);
        if (c > r.hi) r.exc = { side: 1, start: i, ext: h, extAt: i };
        else if (c < r.lo) r.exc = { side: -1, start: i, ext: l, extAt: i };
      } else if (r.exc.side > 0 && h > r.exc.ext) { r.exc.ext = h; r.exc.extAt = i; }
      else if (r.exc.side < 0 && l < r.exc.ext) { r.exc.ext = l; r.exc.extAt = i; }

      const e = r.exc;
      if (e && e.side > 0) {
        if (c <= r.hi) { upthrust(e.ext, e.extAt); r.exc = null; }
        else if (r.kind !== 'distribution' && strongUp) {
          r.sos = true;
          emit('SOS', 'SOS', i, r.hi, i);
          const hi = r.hi, lo = r.lo;
          lpsW = { after: i, until: i + 3 * RANGE_W, test: (s, a) => s.price >= hi - a && s.price > lo };
          end(1, e.start - 1);
        } else if (i - e.start >= BREAK_BARS || e.ext - r.hi > PROBE_MAX * A) end(1, e.start - 1);
      } else if (e && e.side < 0) {
        if (c >= r.lo) { spring(e.ext, e.extAt); r.exc = null; }
        else if (r.kind !== 'accumulation' && strongDn) {
          r.sow = true;
          emit('SOW', 'SOW', i, r.lo, i);
          const hi = r.hi, lo = r.lo;
          lpsyW = { after: i, until: i + 3 * RANGE_W, test: (s, a) => s.price <= lo + a && s.price < hi };
          end(-1, e.start - 1);
        } else if (i - e.start >= BREAK_BARS || r.lo - e.ext > PROBE_MAX * A) end(-1, e.start - 1);
      }
      if (R) r.to = i;
    }

    // ---- climax candidates (outside ranges): big bar, volume spike, at the extreme of a long move ----
    if (!R && warm && avgV > 0 && i >= MOVE_LOOK / 2) {
      const s0 = Math.max(0, i - MOVE_LOOK);
      const bigVol = V[i] >= CLX_VOL * avgV && rng >= CLX_RANGE * A;
      if (bigVol && c < o && trend[i] === 'down') {
        let mx = -Infinity, mn = Infinity;
        for (let j = s0; j < i; j++) { if (Hh[j] > mx) mx = Hh[j]; if (Ll[j] < mn) mn = Ll[j]; }
        if (l < mn && mx - l >= CLX_DROP * A && (!candSC || l < candSC.price)) candSC = { dir: -1, at: i, price: l, vol: V[i], A };
      }
      if (bigVol && c > o && trend[i] === 'up') {
        let mx = -Infinity, mn = Infinity;
        for (let j = s0; j < i; j++) { if (Hh[j] > mx) mx = Hh[j]; if (Ll[j] < mn) mn = Ll[j]; }
        if (h > mx && h - mn >= CLX_DROP * A && (!candBC || h > candBC.price)) candBC = { dir: 1, at: i, price: h, vol: V[i], A };
      }
    }

    // ---- new range: price boxed in for RANGE_W bars ----
    if (!R && warm && i - RANGE_W + 1 > lastRangeEnd && i >= RANGE_W + ATR_LEN) {
      const s0 = i - RANGE_W + 1;
      let hi = -Infinity, lo = Infinity;
      for (let j = s0; j <= i; j++) { if (Hh[j] > hi) hi = Hh[j]; if (Ll[j] < lo) lo = Ll[j]; }
      const height = hi - lo;
      if (height <= RANGE_MAX * A && height >= RANGE_MIN * A && Math.abs(c - C[s0]) <= 0.5 * height) {
        const mid = (hi + lo) / 2;
        let side = 0, crosses = 0;
        for (let j = s0; j <= i; j++) {
          const sd = C[j] > mid ? 1 : C[j] < mid ? -1 : 0;
          if (sd && side && sd !== side) crosses++;
          if (sd) side = sd;
        }
        if (crosses >= 4) { R = newRange(s0, i, null, false, A); ranges.push(R); }
      }
    }

    // ---- trending legs between ranges ----
    const grace = legSince >= 0 && i - legSince < RANGE_W;
    legLab[i] = leg === 'up' && (grace || trend[i] !== 'down') ? 'markup' : leg === 'down' && (grace || trend[i] !== 'up') ? 'markdown' : null;

    volSum += V[i];
    if (i >= VOL_LEN) volSum -= V[i - VOL_LEN];
  }

  return { swings: sw.map((s): Swing => ({ i: s.i, price: s.price, type: s.type })), phases: buildSpans(n, ranges, legLab, trend, Hh, Ll), events, trend, atr };
}

function rangeConfidence(r: Rng): number {
  if (r.failed) return 0.3;
  if (r.kind === 'range') return Math.min(0.6, 0.35 + (r.to - r.from) / 400);
  let c = 0.35 + Math.min(0.3, 0.06 * Math.abs(r.move));
  if (r.anchored) c += 0.15;
  if (r.kind === 'accumulation') { if (r.springs) c += 0.1; if (r.sos) c += 0.1; }
  else { if (r.uts) c += 0.1; if (r.sow) c += 0.1; }
  if (r.sts) c += 0.05;
  return Math.min(0.95, Math.round(c * 100) / 100);
}

function buildSpans(n: number, ranges: Rng[], legLab: (Phase | null)[], trend: Analysis['trend'], Hh: Float64Array, Ll: Float64Array): PhaseSpan[] {
  const lab = legLab.slice();
  const rid = new Int32Array(n).fill(-1);
  ranges.forEach((r, k) => { for (let j = r.from; j <= r.to && j < n; j++) { lab[j] = r.kind; rid[j] = k; } });
  const spans: PhaseSpan[] = [];
  let j = 0;
  while (j < n) {
    const p = lab[j];
    let e = j;
    while (e + 1 < n && lab[e + 1] === p && rid[e + 1] === rid[j]) e++;
    if (p) {
      if (rid[j] >= 0) {
        const r = ranges[rid[j]];
        spans.push({ from: j, to: e, phase: p, hi: r.hi, lo: r.lo, confidence: rangeConfidence(r) });
      } else if (e - j + 1 >= 3) {
        let hi = -Infinity, lo = Infinity, agree = 0;
        const want = p === 'markup' ? 'up' : 'down';
        for (let k = j; k <= e; k++) { hi = Math.max(hi, Hh[k]); lo = Math.min(lo, Ll[k]); if (trend[k] === want) agree++; }
        spans.push({ from: j, to: e, phase: p, hi, lo, confidence: Math.round((0.35 + 0.55 * agree / (e - j + 1)) * 100) / 100 });
      }
    }
    j = e + 1;
  }
  return spans;
}

/** Events confirmed at or before bar i (events are sorted by `i`). */
export function eventsUpTo(a: Analysis, i: number): MarketEvent[] {
  const ev = a.events;
  let lo = 0, hi = ev.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].i <= i) lo = m + 1; else hi = m; }
  return ev.slice(0, lo);
}

/** The phase span containing bar i, if any (spans are sorted and do not overlap). */
export function phaseAt(a: Analysis, i: number): PhaseSpan | null {
  const ps = a.phases;
  let lo = 0, hi = ps.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ps[m].to < i) lo = m + 1;
    else if (ps[m].from > i) hi = m - 1;
    else return ps[m];
  }
  return null;
}

// ---------------- drawing ----------------
export const PHASE_COLORS: Record<Phase, { fill: string; line: string; label: string; name: string }> = {
  accumulation: { fill: 'rgba(0, 200, 83, 0.16)', line: 'rgba(0, 130, 55, 0.9)', label: '#1b7a3d', name: 'Accumulation' },
  distribution: { fill: 'rgba(244, 67, 54, 0.16)', line: 'rgba(183, 28, 28, 0.9)', label: '#b71c1c', name: 'Distribution' },
  range: { fill: 'rgba(96, 125, 139, 0.18)', line: 'rgba(55, 71, 79, 0.85)', label: '#455a64', name: 'Range' },
  markup: { fill: 'rgba(0, 200, 83, 0.10)', line: '#00c853', label: '#1b7a3d', name: 'Markup ↑' },
  markdown: { fill: 'rgba(244, 67, 54, 0.10)', line: '#ff1744', label: '#b71c1c', name: 'Markdown ↓' },
};

const ACC_EV = '#2e7d32', DIST_EV = '#c62828', MANIP_EV = '#7b1fa2', BOS_EV = '#1565c0', SWEEP_EV = '#e65100';
const TAG_COLOR: Partial<Record<EventKind, string>> = {
  SC: ACC_EV, LPS: ACC_EV, SOS: ACC_EV, BC: DIST_EV, LPSY: DIST_EV, SOW: DIST_EV,
  SPRING: MANIP_EV, UT: MANIP_EV, UTAD: MANIP_EV,
  BOS_UP: BOS_EV, BOS_DN: BOS_EV, SWEEP_HI: SWEEP_EV, SWEEP_LO: SWEEP_EV,
};
const ABOVE: Partial<Record<EventKind, boolean>> = {
  BC: true, UT: true, UTAD: true, LPSY: true, SOS: true, BOS_UP: true, SWEEP_HI: true,
  SC: false, SPRING: false, LPS: false, SOW: false, BOS_DN: false, SWEEP_LO: false,
};
const CANDLE: Partial<Record<EventKind, true>> = { ENGULF_UP: true, ENGULF_DN: true, PIN_UP: true, PIN_DN: true, INSIDE: true, DOJI: true, VOL_SPIKE: true };
const FONT = '600 10px -apple-system, "Segoe UI", Roboto, sans-serif';

function inferTfMin(data: KLineData[]): number {
  let best = Infinity;
  for (let i = 1; i < Math.min(data.length, 50); i++) best = Math.min(best, data[i].timestamp - data[i - 1].timestamp);
  return Number.isFinite(best) && best > 0 ? Math.round(best / 60000) : 5;
}

interface PhRow { a?: Analysis }

let registered = false;
export function registerPhases() {
  if (registered) return;
  registered = true;
  registerIndicator<PhRow, number, PhasesExt>({
    name: 'JC_PHASES', shortName: 'Phases', series: 'price', calcParams: [], figures: [],
    shouldUpdate: (prev, cur) => {
      const calc = prev.calc !== cur.calc || prev.extendData?.tfMin !== cur.extendData?.tfMin;
      return { calc, draw: calc || prev.visible !== cur.visible || prev.extendData !== cur.extendData || prev.paneId !== cur.paneId };
    },
    calc: (dataList, indicator) => {
      const rows: PhRow[] = dataList.map(() => ({}));
      if (rows.length) rows[rows.length - 1] = { a: analyze(dataList, indicator.extendData?.tfMin ?? inferTfMin(dataList)) };
      return rows;
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const rows = indicator.result;
      const a = rows.length ? rows[rows.length - 1]?.a : undefined;
      const data = chart.getDataList();
      if (!a || !data.length) return true;
      const range = chart.getVisibleRange();
      const from = Math.max(0, range.from), to = Math.min(data.length, range.to);
      if (to <= from) return true;
      const half = chart.getBarSpace().halfBar;
      const X = (i: number) => xAxis.convertToPixel(i);
      const Y = (v: number) => yAxis.convertToPixel(v);
      const { width, height } = bounding;
      const daily = (indicator.extendData?.tfMin ?? inferTfMin(data)) >= 1440;
      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';

      const label = (text: string, x: number, y: number, bg: string, align: 'left' | 'center' = 'left') => {
        const w = Math.ceil(ctx.measureText(text).width) + 8, hgt = 14;
        const x0 = Math.round(align === 'center' ? x - w / 2 : x), y0 = Math.round(y);
        ctx.fillStyle = bg;
        ctx.fillRect(x0, y0, w, hgt);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(text, x0 + 4, y0 + hgt / 2 + 0.5);
        return hgt;
      };

      // Phase bands
      const STRIP = 5;
      for (const p of a.phases) {
        if (p.to < from || p.from >= to) continue;
        const col = PHASE_COLORS[p.phase];
        const x0 = X(p.from) - half, x1 = X(p.to) + half;
        const lx = Math.max(x0, 0) + 3;
        if (p.phase === 'markup' || p.phase === 'markdown') {
          ctx.fillStyle = col.line;
          ctx.fillRect(x0, height - STRIP, x1 - x0, STRIP);
          if (Math.min(x1, width) - lx > 70) label(col.name, lx, height - STRIP - 16, col.label);
        } else {
          const y0 = Y(p.hi), y1 = Y(p.lo);
          ctx.fillStyle = col.fill;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          ctx.strokeStyle = col.line;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
          ctx.setLineDash([]);
          if (Math.min(x1, width) - lx > 60) label(col.name, lx, y1 - y0 >= 22 ? y0 + 3 : y0 - 17, col.label);
        }
      }

      if (!daily) {
        const evs = a.events as PatternEvent[];
        const stack = new Map<number, { up: number; dn: number }>();
        const slot = (at: number) => { let s = stack.get(at); if (!s) { s = { up: 0, dn: 0 }; stack.set(at, s); } return s; };
        const r = Math.max(2, Math.min(4, half));

        // Candle patterns: small glyphs with a white rim
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        for (const e of evs) {
          if (!CANDLE[e.kind] || e.at < from || e.at >= to) continue;
          const b = data[e.at];
          if (!b) continue;
          const x = X(e.at), s = slot(e.at);
          ctx.beginPath();
          switch (e.kind) {
            case 'ENGULF_UP': { const y = Y(b.low) + 4 + s.dn; ctx.moveTo(x, y); ctx.lineTo(x + r, y + 2 * r); ctx.lineTo(x - r, y + 2 * r); ctx.closePath(); ctx.fillStyle = '#00c853'; s.dn += 2 * r + 3; break; }
            case 'ENGULF_DN': { const y = Y(b.high) - 4 - s.up; ctx.moveTo(x, y); ctx.lineTo(x + r, y - 2 * r); ctx.lineTo(x - r, y - 2 * r); ctx.closePath(); ctx.fillStyle = '#ff1744'; s.up += 2 * r + 3; break; }
            case 'PIN_UP': { const y = Y(b.low) + 4 + s.dn + r; ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#00c853'; s.dn += 2 * r + 3; break; }
            case 'PIN_DN': { const y = Y(b.high) - 4 - s.up - r; ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#ff1744'; s.up += 2 * r + 3; break; }
            case 'INSIDE': { const y = Y(b.high) - 4 - s.up - 2 * r + 1; ctx.rect(x - r + 1, y, 2 * r - 2, 2 * r - 2); ctx.fillStyle = '#ffb300'; s.up += 2 * r + 2; break; }
            case 'DOJI': { const y = Y(b.high) - 4 - s.up - r; ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fillStyle = '#29b6f6'; s.up += 2 * r + 3; break; }
            case 'VOL_SPIKE': { ctx.arc(x, height - STRIP - 5, Math.max(1.5, r - 1), 0, Math.PI * 2); ctx.fillStyle = '#ffb300'; break; }
            default: break;
          }
          ctx.fill();
          ctx.stroke();
        }

        // Structure + Wyckoff events: labelled tags at the event price
        const tags = half >= 1.5;
        for (const e of evs) {
          if (CANDLE[e.kind]) continue;
          const left = e.ref ?? e.at;
          if (e.at < from - 1 || left >= to) continue;
          const b = data[e.at];
          if (!b) continue;
          const above = ABOVE[e.kind] ?? e.price >= (b.high + b.low) / 2;
          // AR is a high after a selling climax (bullish context) or a low after a buying climax;
          // ST is a low near the SC (bullish) or a high near the BC
          const bg = TAG_COLOR[e.kind] ?? (e.kind === 'AR' ? (above ? ACC_EV : DIST_EV) : e.kind === 'ST' ? (above ? DIST_EV : ACC_EV) : '#37474f');
          const yp = Y(e.price);
          if (e.ref !== undefined) {
            // BOS / sweep: a line from the swing to the bar that broke or swept it
            ctx.strokeStyle = bg;
            ctx.lineWidth = 1;
            ctx.setLineDash(e.kind === 'BOS_UP' || e.kind === 'BOS_DN' ? [5, 3] : [2, 2]);
            ctx.beginPath(); ctx.moveTo(X(e.ref), Math.round(yp) + 0.5); ctx.lineTo(X(e.at), Math.round(yp) + 0.5); ctx.stroke();
            ctx.setLineDash([]);
          }
          if (!tags) continue;
          if (e.kind === 'BOS_UP' || e.kind === 'BOS_DN') {
            const xm = (X(e.ref ?? e.at) + X(e.at)) / 2;
            label(e.text, xm, above ? yp - 16 : yp + 2, bg, 'center');
            continue;
          }
          const s = slot(e.at);
          if (above) {
            const y = Math.min(yp, Y(b.high)) - 4 - s.up - 14;
            label(e.text, X(e.at), y, bg, 'center');
            s.up += 16;
          } else {
            const y = Math.max(yp, Y(b.low)) + 4 + s.dn;
            label(e.text, X(e.at), y, bg, 'center');
            s.dn += 16;
          }
        }
      }

      ctx.restore();
      return true;
    },
  });
}
