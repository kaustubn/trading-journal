// NQ-SYS v3: port of trading-system/pine/NQ_System_v3.pine (defaults = Ka's TradingView inputs).
// Day classifier (IB at 10:00 ET) + S1 / S2 / S3 / ORB setups, value-area proxy, trade plan
// for the latest signal and the scorecard table, drawn on the main candle pane.
//
// Differences from the Pine, forced by the data available here:
//   - Delta: no lower-timeframe data, so each chart bar's signed volume is the bar delta.
//     Delta support/resistance lines are not drawn.
//   - 15m trend: built from the loaded chart bars (15m buckets), not a separate 15m feed.
//   - PDH/PDL: from the previous CME session in the loaded bars (na for the first one).
//   - Every bar except the last one in the data is treated as confirmed.
import { registerIndicator, KLineData } from 'klinecharts';
import { etMinutes, sessionDay } from './time';

export interface NqSysExt { tfMin: number }

// ---- Pine input defaults ----
const EMA_LEN = 21, ATR_LEN = 14, RSI_LEN = 14;
const SLOPE_PCT = 0, LEV_TOL_PCT = 0.05;
const IB_TREND = 60, IB_RANGE = 120, ATR_MIN = 8, ATR_SKIP = 40, ATR_RED = 30;
const S1_REJ = 0.5, S2_REJ = 0.6, S2_RSI_LO = 35, S2_RSI_HI = 65;
const S3_WICK = 8, S3_RSI_LO = 35, S3_RSI_HI = 65;
const ORB_MIN = 15, ORB_MAX = 80, ORB_BODY = 8;
const S1_STOP = 3, S2_STOP = 5, S3_STOP = 4, ORB_STOP = 3;
const VA_MULT = 1, DRAW_LEN = 24, REF_QTY = 5, DELTA_LOOK = 3, SWING_LEN = 20;
// Sessions, minutes since midnight ET, [start, end)
const RTH = [570, 960], ORB_WIN = [570, 585], IB_WIN = [570, 600], ENTRY_WIN = [605, 945], ORB_TRADE = [585, 660];

// ---- Pine v6 colours ----
const C = {
  ema: '#ff9800', vwap: '#2962ff', va: '#008080', ib: '#787b86', pd: 'rgba(128,0,0,0.7)',
  ibBg: 'rgba(120,123,134,0.10)', orbBg: 'rgba(255,235,59,0.08)',
  lime: '#00e676', red: '#f23645', green: '#4caf50', orange: '#ff9800', aqua: '#00bcd4',
  fuchsia: '#e040fb', yellow: '#ffeb3b', gray: '#787b86', white: '#ffffff',
  t2: 'rgba(76,175,80,0.55)',
};

// Signal bits, in Pine's trade-plan priority order
const S1L = 1, S1S = 2, S2L = 4, S2S = 8, S3L = 16, S3S = 32, ORBL = 64, ORBS = 128;
const SHAPES: { bit: number; long: boolean; color: string; text: string; diamond: boolean }[] = [
  { bit: S1L, long: true, color: C.lime, text: 'S1', diamond: false },
  { bit: S1S, long: false, color: C.red, text: 'S1', diamond: false },
  { bit: S2L, long: true, color: C.green, text: 'S2', diamond: false },
  { bit: S2S, long: false, color: C.orange, text: 'S2', diamond: false },
  { bit: S3L, long: true, color: C.aqua, text: 'S3', diamond: false },
  { bit: S3S, long: false, color: C.fuchsia, text: 'S3', diamond: false },
  { bit: ORBL, long: true, color: C.yellow, text: 'ORB', diamond: true },
  { bit: ORBS, long: false, color: C.yellow, text: 'ORB', diamond: true },
];

interface BarInfo {
  ema: number; vwap: number; vah: number; val: number;
  ibHi: number; ibLo: number; // NaN unless IB is done (plotted value)
  pdh: number; pdl: number;
  inIB: boolean; inORB: boolean;
  sig: number; // signal bits
}
interface Plan { idx: number; long: boolean; entry: number; stop: number; t1: number; t2: number; text: string }
interface Cell { text: string; color: string }
interface Card { rows: [Cell, Cell][]; note: boolean }
interface NqRow {
  // Figure keys: legend values and y-axis autoscale (undefined = na)
  ema?: number; vwap?: number; vah?: number; val?: number;
  b?: BarInfo;
  plan?: Plan | null; // last row only
  card?: Card;        // last row only
}

const fin = (v: number) => (Number.isFinite(v) ? v : undefined);
const inWin = (m: number, w: number[]) => m >= w[0] && m < w[1];
/** Pine math.round(x, d) -> str.tostring */
const rnd = (x: number, d = 0) => {
  if (!Number.isFinite(x)) return 'NaN';
  const f = 10 ** d;
  return String(Math.sign(x) * Math.round(Math.abs(x) * f) / f);
};
const dfmt = (x: number) => {
  const ax = Math.abs(x);
  const s = ax >= 1000 ? `${Math.round(ax / 100) / 10}k` : `${Math.round(ax)}`;
  return (x >= 0 ? '+' : '-') + s;
};
const dayStr = (dt: number) => (dt === 1 ? 'TREND → S1' : dt === 2 ? 'NORMAL → S1/S3' : dt === 3 ? 'RANGE → S2/S3' : 'NO-TRADE');

function inferTfMin(data: KLineData[]): number {
  let best = Infinity;
  for (let i = 1; i < Math.min(data.length, 50); i++) best = Math.min(best, data[i].timestamp - data[i - 1].timestamp);
  return Number.isFinite(best) && best > 0 ? Math.round(best / 60000) : 5;
}

function calcNqSys(data: KLineData[], ext: NqSysExt | undefined): NqRow[] {
  const n = data.length;
  if (!n) return [];
  const tfMin = ext?.tfMin ?? inferTfMin(data);
  if (tfMin >= 1440) return data.map(() => ({}));
  const tfMs = tfMin * 60000;
  const rows: NqRow[] = new Array(n);

  // EMA / ATR / RSI (SMA-seeded, as Pine's built-ins)
  const aE = 2 / (EMA_LEN + 1);
  let emaSum = 0, ema = NaN;
  let trSum = 0, atr = NaN;
  let upSum = 0, dnSum = 0, upR = NaN, dnR = NaN, rsi = NaN;
  // VWAP (session anchor)
  let sV = 0, sPV = 0, sPPV = 0;
  // Previous session high / low
  let day = NaN, dayHi = NaN, dayLo = NaN, pdh = NaN, pdl = NaN;
  // 15m trend
  const use15 = tfMin <= 15 && 15 % tfMin === 0;
  const B15 = 15 * 60000;
  let bStart = NaN, bClose = NaN, bDone = true, e15 = NaN, e15Prev = NaN, e15Sum = 0, e15Cnt = 0;
  const close15 = (c: number) => {
    e15Cnt++;
    const before = e15;
    if (e15Cnt < EMA_LEN) { e15Sum += c; return; }
    if (e15Cnt === EMA_LEN) e15 = (e15Sum + c) / EMA_LEN;
    else e15 = aE * c + (1 - aE) * e15;
    e15Prev = before;
  };
  // IB / ORB state
  let orbHi = NaN, orbLo = NaN, ibHi = NaN, ibLo = NaN, ibRange = NaN, orbRng = NaN, ibDone = false, dayType = 0;
  let pRTH = false, pORB = false, pIB = false;
  // Previous-bar raw signals
  let p = { s1L: false, s1S: false, s2L: false, s2S: false, s3L: false, s3S: false, oL: false, oS: false };
  // Delta
  const deltas: number[] = [];
  let cvd = 0;
  let plan: Plan | null = null;
  // Last-bar values for the scorecard
  let slopePct = NaN, sig = 0;

  for (let i = 0; i < n; i++) {
    const k = data[i];
    const { open: o, high: h, low: l, close: c } = k;
    const vol = k.volume ?? 0;
    const prev = i > 0 ? data[i - 1] : null;

    // ---- base ----
    const emaPrev = ema;
    if (i < EMA_LEN) { emaSum += c; if (i === EMA_LEN - 1) ema = emaSum / EMA_LEN; }
    else ema = aE * c + (1 - aE) * ema;

    const tr = prev ? Math.max(h - l, Math.abs(h - prev.close), Math.abs(l - prev.close)) : h - l;
    if (i < ATR_LEN) { trSum += tr; if (i === ATR_LEN - 1) atr = trSum / ATR_LEN; }
    else atr = (atr * (ATR_LEN - 1) + tr) / ATR_LEN;

    if (prev) {
      const u = Math.max(c - prev.close, 0), d = Math.max(prev.close - c, 0);
      if (i <= RSI_LEN) {
        upSum += u; dnSum += d;
        if (i === RSI_LEN) { upR = upSum / RSI_LEN; dnR = dnSum / RSI_LEN; }
      } else {
        upR = (upR * (RSI_LEN - 1) + u) / RSI_LEN;
        dnR = (dnR * (RSI_LEN - 1) + d) / RSI_LEN;
      }
      if (i >= RSI_LEN) rsi = dnR === 0 ? 100 : upR === 0 ? 0 : 100 - 100 / (1 + upR / dnR);
    }
    const levTol = c * LEV_TOL_PCT / 100;

    // ---- delta proxy ----
    const barDelta = c >= o ? vol : -vol;
    deltas.push(barDelta);
    const recentDelta = i >= DELTA_LOOK - 1
      ? deltas.slice(i - DELTA_LOOK + 1, i + 1).reduce((a, b) => a + b, 0) : NaN;

    // ---- session flags ----
    const m = etMinutes(k.timestamp);
    const inRTH = inWin(m, RTH), inORB = inWin(m, ORB_WIN), inIB = inWin(m, IB_WIN);
    const inEntry = inWin(m, ENTRY_WIN), inOrbTr = inWin(m, ORB_TRADE);
    const rthStart = inRTH && !pRTH;

    // ---- VWAP + value-area proxy ----
    if (!prev || k.timestamp - prev.timestamp > tfMs * 2) { sV = 0; sPV = 0; sPPV = 0; }
    const src = (h + l + c) / 3;
    sV += vol; sPV += src * vol; sPPV += src * src * vol;
    let vwap = NaN, vah = NaN, val = NaN;
    if (sV > 0) {
      vwap = sPV / sV;
      const sdev = Math.sqrt(Math.max(0, sPPV / sV - vwap * vwap));
      vah = vwap + VA_MULT * sdev;
      val = vwap - VA_MULT * sdev;
    }

    // ---- prior session levels ----
    const sd = sessionDay(k.timestamp);
    if (sd !== day) {
      if (!Number.isNaN(day)) { pdh = dayHi; pdl = dayLo; }
      day = sd; dayHi = h; dayLo = l;
    } else {
      dayHi = Math.max(dayHi, h); dayLo = Math.min(dayLo, l);
    }

    // ---- 15m trend (last CLOSED 15m bucket by this bar's close) ----
    let ema15: number, slope15: number;
    if (use15) {
      const b = Math.floor(k.timestamp / B15) * B15;
      if (b !== bStart) {
        if (!bDone) close15(bClose);
        bStart = b; bDone = false;
      }
      bClose = c;
      if (b + B15 <= k.timestamp + tfMs) { close15(bClose); bDone = true; }
      ema15 = e15; slope15 = e15 - e15Prev;
    } else {
      ema15 = ema; slope15 = ema - emaPrev;
    }
    slopePct = Number.isNaN(ema15) || Number.isNaN(slope15) ? NaN : ema15 !== 0 ? slope15 / ema15 * 100 : 0;
    const up15 = slopePct > SLOPE_PCT && c > ema15;
    const dn15 = slopePct < -SLOPE_PCT && c < ema15;

    // ---- swing magnets (prior 20 bars) ----
    let swHi = NaN, swLo = NaN;
    if (i >= SWING_LEN) {
      swHi = -Infinity; swLo = Infinity;
      for (let j = i - SWING_LEN; j < i; j++) { swHi = Math.max(swHi, data[j].high); swLo = Math.min(swLo, data[j].low); }
    }

    // ---- IB / ORB accumulation + classify ----
    if (rthStart) {
      orbHi = NaN; orbLo = NaN; ibHi = NaN; ibLo = NaN; ibRange = NaN; orbRng = NaN; ibDone = false; dayType = 0;
    }
    if (inORB) { orbHi = Number.isNaN(orbHi) ? h : Math.max(orbHi, h); orbLo = Number.isNaN(orbLo) ? l : Math.min(orbLo, l); }
    if (inIB) { ibHi = Number.isNaN(ibHi) ? h : Math.max(ibHi, h); ibLo = Number.isNaN(ibLo) ? l : Math.min(ibLo, l); }
    if (!inORB && pORB && !Number.isNaN(orbHi) && !Number.isNaN(orbLo)) orbRng = orbHi - orbLo;
    if (!inIB && pIB && !Number.isNaN(ibHi) && !Number.isNaN(ibLo)) {
      ibRange = ibHi - ibLo;
      ibDone = true;
      dayType = (atr < ATR_MIN || atr > ATR_SKIP) ? 0 : ibRange < IB_TREND ? 1 : ibRange <= IB_RANGE ? 2 : 3;
    }

    // ---- candle math ----
    const rng = h - l, body = Math.abs(c - o);
    const cfUp = rng > 0 ? (c - l) / rng : 0;
    const cfDn = rng > 0 ? (h - c) / rng : 0;
    const confirmed = i < n - 1;
    const canBase = ibDone && inEntry && confirmed;

    const touchUp = (v: number) => !Number.isNaN(v) && l <= v + levTol && l >= v - levTol && c > v;
    const touchDn = (v: number) => !Number.isNaN(v) && h >= v - levTol && h <= v + levTol && c < v;
    const sweepUp = (v: number) => !Number.isNaN(v) && v - l >= S3_WICK && c > v;
    const sweepDn = (v: number) => !Number.isNaN(v) && h - v >= S3_WICK && c < v;
    const vpPoc = vwap;

    // S1 trend pullback
    const s1Sup = touchUp(ema) || touchUp(val) || touchUp(vpPoc) || touchUp(vwap) || touchUp(pdl);
    const s1Res = touchDn(ema) || touchDn(vah) || touchDn(vpPoc) || touchDn(vwap) || touchDn(pdh);
    const trendDay = dayType === 1 || dayType === 2;
    const s1L = canBase && trendDay && up15 && s1Sup && cfUp >= S1_REJ;
    const s1S = canBase && trendDay && dn15 && s1Res && cfDn >= S1_REJ;
    // S2 range extreme fade
    const s2L = canBase && dayType === 3 && (touchUp(val) || touchUp(pdl)) && cfUp >= S2_REJ && rsi <= S2_RSI_LO;
    const s2S = canBase && dayType === 3 && (touchDn(vah) || touchDn(pdh)) && cfDn >= S2_REJ && rsi >= S2_RSI_HI;
    // S3 liquidity sweep reversal
    const s3Day = dayType === 2 || dayType === 3;
    const s3L = canBase && s3Day && !dn15 && (sweepUp(val) || sweepUp(pdl) || sweepUp(swLo)) && rsi <= S3_RSI_LO;
    const s3S = canBase && s3Day && !up15 && (sweepDn(vah) || sweepDn(pdh) || sweepDn(swHi)) && rsi >= S3_RSI_HI;
    // ORB
    const orbRangeOk = !Number.isNaN(orbRng) && orbRng >= ORB_MIN && orbRng <= ORB_MAX;
    const orbDayOk = !ibDone || dayType !== 0;
    const oL = confirmed && inOrbTr && orbDayOk && orbRangeOk && !Number.isNaN(orbHi) && Math.min(o, c) > orbHi && body >= ORB_BODY;
    const oS = confirmed && inOrbTr && orbDayOk && orbRangeOk && !Number.isNaN(orbLo) && Math.max(o, c) < orbLo && body >= ORB_BODY;

    sig = (s1L && !p.s1L ? S1L : 0) | (s1S && !p.s1S ? S1S : 0) | (s2L && !p.s2L ? S2L : 0) | (s2S && !p.s2S ? S2S : 0)
        | (s3L && !p.s3L ? S3L : 0) | (s3S && !p.s3S ? S3S : 0) | (oL && !p.oL ? ORBL : 0) | (oS && !p.oS ? ORBS : 0);
    p = { s1L, s1S, s2L, s2S, s3L, s3S, oL, oS };

    // ---- trade plan for this bar's signal (first by Pine priority) ----
    if (sig) {
      let long = true, stop = NaN, t1m = 2, t2m = 3, tag = '';
      if (sig & S1L) { long = true; stop = l - S1_STOP; t1m = 2.5; t2m = 4; tag = 'S1'; }
      else if (sig & S1S) { long = false; stop = h + S1_STOP; t1m = 2.5; t2m = 4; tag = 'S1'; }
      else if (sig & S2L) { long = true; stop = l - S2_STOP; t1m = 1.5; t2m = 2; tag = 'S2'; }
      else if (sig & S2S) { long = false; stop = h + S2_STOP; t1m = 1.5; t2m = 2; tag = 'S2'; }
      else if (sig & S3L) { long = true; stop = l - S3_STOP; tag = 'S3'; }
      else if (sig & S3S) { long = false; stop = h + S3_STOP; tag = 'S3'; }
      else if (sig & ORBL) { long = true; stop = orbHi - ORB_STOP; tag = 'ORB'; }
      else { long = false; stop = orbLo + ORB_STOP; tag = 'ORB'; }
      if (!Number.isNaN(stop)) {
        const entry = c, risk = Math.abs(entry - stop);
        const redTag = atr > ATR_RED ? ' (reduce 40%)' : '';
        const flowOk = long ? recentDelta > 0 : recentDelta < 0;
        const text = `${tag}${long ? ' LONG  ' : ' SHORT  '}${rnd(risk, 1)}pt  T1 ${t1m}R / T2 ${t2m}R  $${rnd(risk * 2 * REF_QTY)}/${REF_QTY}MNQ${redTag}${flowOk ? '  flow OK' : '  flow AGAINST'}`;
        plan = {
          idx: i, long, entry, stop, text,
          t1: long ? entry + t1m * risk : entry - t1m * risk,
          t2: long ? entry + t2m * risk : entry - t2m * risk,
        };
      }
    }

    // ---- CVD (RTH, confirmed bars) ----
    if (rthStart) cvd = 0;
    if (confirmed && inRTH) cvd += barDelta;

    rows[i] = {
      ema: fin(ema), vwap: fin(vwap), vah: fin(vah), val: fin(val),
      b: {
        ema, vwap, vah, val,
        ibHi: ibDone ? ibHi : NaN, ibLo: ibDone ? ibLo : NaN,
        pdh, pdl, inIB, inORB, sig,
      },
    };
    pRTH = inRTH; pORB = inORB; pIB = inIB;
  }

  // ---- scorecard (last bar) ----
  const lastClose = data[n - 1].close;
  const vwapLast = rows[n - 1].b!.vwap;
  const atrTxt = rnd(atr, 1) + (atr < ATR_MIN ? ' DEAD' : atr > ATR_SKIP ? ' WILD' : atr > ATR_RED ? ' reduce' : '');
  const atrCol = (atr < ATR_MIN || atr > ATR_SKIP) ? C.red : atr > ATR_RED ? C.orange : C.white;
  const liveSig = sig & (S1L | S1S) ? 'S1' : sig & (S2L | S2S) ? 'S2' : sig & (S3L | S3S) ? 'S3' : sig & (ORBL | ORBS) ? 'ORB' : '—';
  const label = (text: string): Cell => ({ text, color: C.gray });
  const card: Card = {
    note: tfMin !== 5,
    rows: [
      [{ text: 'NQ-SYS v3', color: C.white }, { text: Number.isNaN(ibRange) ? 'pre-IB' : dayStr(dayType), color: C.white }],
      [label('IB range'), { text: Number.isNaN(ibRange) ? 'measuring…' : `${rnd(ibRange)} pt`, color: C.white }],
      [label('ATR(14)'), { text: atrTxt, color: atrCol }],
      [label('15m slope'), {
        text: `${slopePct > 0 ? '+' : ''}${rnd(slopePct, 3)}%`,
        color: slopePct > 0 ? C.green : slopePct < 0 ? C.red : C.gray,
      }],
      [label('RSI(14)'), { text: rnd(rsi), color: rsi > S3_RSI_HI ? C.red : rsi < S3_RSI_LO ? C.lime : C.white }],
      [label('VWAP dist'), { text: `${rnd(lastClose - vwapLast)} pt`, color: C.white }],
      [label('VP source'), { text: 'proxy', color: C.yellow }],
      [label('Signal now'), { text: liveSig, color: liveSig === '—' ? C.gray : C.lime }],
      [label('Flow (CVD)'), { text: dfmt(cvd), color: cvd > 0 ? C.lime : cvd < 0 ? C.red : C.white }],
    ],
  };
  rows[n - 1].plan = plan;
  rows[n - 1].card = card;
  return rows;
}

const FONT = '11px -apple-system, "Segoe UI", Roboto, sans-serif';

export function registerNqSys() {
  registerIndicator<NqRow, number, NqSysExt>({
    name: 'JC_NQSYS', shortName: 'NQ-SYS v3', series: 'price', precision: 2, calcParams: [],
    figures: [
      { key: 'ema', title: 'EMA21: ', type: 'line', styles: () => ({ color: C.ema }) },
      { key: 'vwap', title: 'VWAP: ', type: 'line', styles: () => ({ color: C.vwap }) },
      { key: 'vah', title: 'VAH: ', type: 'line', styles: () => ({ color: C.va }) },
      { key: 'val', title: 'VAL: ', type: 'line', styles: () => ({ color: C.va }) },
    ],
    shouldUpdate: (prev, cur) => {
      const calc = prev.calc !== cur.calc || prev.extendData?.tfMin !== cur.extendData?.tfMin;
      return { calc, draw: calc || prev.visible !== cur.visible || prev.extendData !== cur.extendData || prev.paneId !== cur.paneId };
    },
    calc: (dataList, indicator) => calcNqSys(dataList, indicator.extendData),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const rows = indicator.result;
      const n = rows.length;
      const last = n ? rows[n - 1] : undefined;
      if (!last?.card) return true; // daily / no data: nothing to draw
      const range = chart.getVisibleRange();
      const from = Math.max(0, range.from), to = Math.min(n, range.to);
      const half = chart.getBarSpace().halfBar;
      const X = (i: number) => xAxis.convertToPixel(i);
      const Y = (v: number) => yAxis.convertToPixel(v);
      const { width, height } = bounding;
      ctx.save();
      ctx.font = FONT;

      if (to > from) {
        // Background: IB window, ORB window
        const shade = (pick: (b: BarInfo) => boolean, color: string) => {
          ctx.fillStyle = color;
          let start = -1;
          for (let i = from; i <= to; i++) {
            const on = i < to && !!rows[i].b && pick(rows[i].b!);
            if (on && start < 0) start = i;
            if (!on && start >= 0) {
              const x0 = X(start) - half;
              ctx.fillRect(x0, 0, X(i - 1) + half - x0, height);
              start = -1;
            }
          }
        };
        shade(b => b.inIB, C.ibBg);
        shade(b => b.inORB, C.orbBg);

        // Line plots, broken where the value is na
        const lo = Math.max(0, from - 1), hi = Math.min(n, to + 1);
        const series = (get: (b: BarInfo) => number, color: string) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          let pen = false;
          for (let i = lo; i < hi; i++) {
            const b = rows[i].b;
            const v = b ? get(b) : NaN;
            if (!Number.isFinite(v)) { pen = false; continue; }
            const x = X(i), y = Y(v);
            if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
          }
          ctx.stroke();
        };
        series(b => b.pdh, C.pd);
        series(b => b.pdl, C.pd);
        series(b => b.ibHi, C.ib);
        series(b => b.ibLo, C.ib);
        series(b => b.vah, C.va);
        series(b => b.val, C.va);
        series(b => b.vwap, C.vwap);
        series(b => b.ema, C.ema);

        // Signals
        const data = chart.getDataList();
        const sz = Math.max(4, Math.min(7, half + 1));
        ctx.textAlign = 'center';
        for (let i = from; i < to; i++) {
          const b = rows[i].b;
          if (!b || !b.sig || !data[i]) continue;
          const x = X(i);
          let yLong = Y(data[i].low) + 4, yShort = Y(data[i].high) - 4;
          for (const s of SHAPES) {
            if (!(b.sig & s.bit)) continue;
            const r = s.diamond ? sz - 1 : sz;
            ctx.fillStyle = s.color;
            ctx.beginPath();
            if (s.long) {
              const top = yLong;
              if (s.diamond) { ctx.moveTo(x, top); ctx.lineTo(x + r, top + r); ctx.lineTo(x, top + 2 * r); ctx.lineTo(x - r, top + r); }
              else { ctx.moveTo(x, top); ctx.lineTo(x + r, top + 2 * r); ctx.lineTo(x - r, top + 2 * r); }
              ctx.closePath(); ctx.fill();
              ctx.textBaseline = 'top';
              ctx.fillText(s.text, x, top + 2 * r + 2);
              yLong = top + 2 * r + 16;
            } else {
              const bot = yShort;
              if (s.diamond) { ctx.moveTo(x, bot); ctx.lineTo(x + r, bot - r); ctx.lineTo(x, bot - 2 * r); ctx.lineTo(x - r, bot - r); }
              else { ctx.moveTo(x, bot); ctx.lineTo(x + r, bot - 2 * r); ctx.lineTo(x - r, bot - 2 * r); }
              ctx.closePath(); ctx.fill();
              ctx.textBaseline = 'bottom';
              ctx.fillText(s.text, x, bot - 2 * r - 2);
              yShort = bot - 2 * r - 16;
            }
          }
        }
      }

      // Trade plan for the latest signal
      const plan = last.plan;
      if (plan && plan.idx + DRAW_LEN >= from && plan.idx < to) {
        const x1 = X(plan.idx), x2 = X(plan.idx + DRAW_LEN);
        const hline = (v: number, color: string, dash: number[]) => {
          const y = Math.round(Y(v)) + 0.5;
          ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        };
        hline(plan.entry, C.gray, [4, 3]);
        hline(plan.stop, C.red, []);
        hline(plan.t1, C.green, []);
        hline(plan.t2, C.t2, []);
        ctx.setLineDash([]);
        // Label: below the stop for longs (pointer up), above the entry for shorts (pointer down)
        const tw = ctx.measureText(plan.text).width;
        const bw = tw + 12, bh = 18, ptr = 5;
        const ya = Y(plan.long ? plan.stop : plan.entry);
        const bx = x1 - bw / 2;
        const by = plan.long ? ya + ptr : ya - ptr - bh;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath();
        if (plan.long) { ctx.moveTo(x1, ya); ctx.lineTo(x1 + ptr, by); ctx.lineTo(x1 - ptr, by); }
        else { ctx.moveTo(x1, ya); ctx.lineTo(x1 + ptr, by + bh); ctx.lineTo(x1 - ptr, by + bh); }
        ctx.closePath(); ctx.fill();
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = C.white;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(plan.text, x1, by + bh / 2);
      }

      // Scorecard (top right)
      const card = last.card;
      const padX = 6, rowH = 18, margin = 8;
      let w0 = 0, w1 = 0;
      for (const [a, b] of card.rows) {
        w0 = Math.max(w0, ctx.measureText(a.text).width);
        w1 = Math.max(w1, ctx.measureText(b.text).width);
      }
      const c0 = w0 + 2 * padX, c1 = w1 + 2 * padX;
      const tw = c0 + c1, th = rowH * card.rows.length;
      const tx = Math.round(width - tw - margin) + 0.5, ty = margin + 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle = 'rgba(49,27,146,0.7)'; // navy header
      ctx.fillRect(tx, ty, tw, rowH);
      ctx.strokeStyle = 'rgba(120,123,134,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(tx, ty, tw, th);
      ctx.beginPath();
      for (let r = 1; r < card.rows.length; r++) { ctx.moveTo(tx, ty + r * rowH); ctx.lineTo(tx + tw, ty + r * rowH); }
      ctx.moveTo(tx + c0, ty); ctx.lineTo(tx + c0, ty + th);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      card.rows.forEach(([a, b], r) => {
        const yc = ty + r * rowH + rowH / 2;
        ctx.fillStyle = a.color; ctx.fillText(a.text, tx + c0 / 2, yc);
        ctx.fillStyle = b.color; ctx.fillText(b.text, tx + c0 + c1 / 2, yc);
      });

      // Timeframe nudge
      if (card.note) {
        const txt = 'Run on 5-min chart for intended behaviour';
        const nw = ctx.measureText(txt).width + 12, nh = 18;
        const nx = Math.round(width - nw - margin), ny = ty + th + 4;
        ctx.fillStyle = 'rgba(255,152,0,0.8)';
        ctx.fillRect(nx, ny, nw, nh);
        ctx.fillStyle = '#000000';
        ctx.fillText(txt, nx + nw / 2, ny + nh / 2);
      }

      ctx.restore();
      return true;
    },
  });
}
