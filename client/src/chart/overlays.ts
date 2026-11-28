// Custom drawing tools for the market chart, registered once with KLineChart.
// Every drawing overlay carries its Drawing (see drawings.ts) in `extendData`,
// which is where colour, width, line style, text and position size come from.
import { registerOverlay } from 'klinecharts';
import type { OverlayFigure, Coordinate, Chart, Overlay, KLineData, OverlayTemplate } from 'klinecharts';
import { Drawing, TICK, POINT_VALUE, fmtPrice, fmtUsd, fmtSpan, signed } from './drawings';
export type { Drawing };
import { anchoredVwap } from './profiles';

type O = Overlay<Drawing>;
type Fig = OverlayFigure;

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", "Segoe UI", Roboto, sans-serif';
const UP = '#089981', DOWN = '#f23645', BLUE = '#2962ff';

function rgba(hex: string, a: number): string {
  // rgb()/rgba() input (e.g. imported from TradingView): keep the colour; a strong alpha keeps
  // its own transparency, a faint one scales it
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(hex.trim());
  if (m) {
    const a0 = m[4] === undefined ? 1 : Number(m[4]);
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a >= 0.9 ? a0 : Math.round(a0 * a * 1000) / 1000})`;
  }
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function lineStyle(d: Drawing | undefined) {
  const width = d?.width ?? 1;
  const kind = d?.line ?? 'solid';
  return {
    color: d?.color ?? BLUE,
    size: width,
    style: kind === 'solid' ? 'solid' : 'dashed',
    dashedValue: kind === 'dotted' ? [Math.max(1, width), Math.max(2, width * 2)] : [6, 4],
  };
}
const line = (coordinates: Coordinate[], d?: Drawing, extra: Partial<Fig> = {}): Fig =>
  ({ type: 'line', attrs: { coordinates }, styles: lineStyle(d), ...extra });

/** A drawing's own text (TradingView-style template labels like "asia high"), above the line at its right end. */
function lineText(d: Drawing | undefined, x: number, y: number, align: 'left' | 'right' = 'right'): Fig[] {
  if (!d?.text || d.tool === 'text') return [];
  return [{
    type: 'text', ignoreEvent: true,
    attrs: { x: align === 'right' ? x - 4 : x + 4, y: y - 3, text: d.text, align, baseline: 'bottom' },
    styles: { color: d.textColor ?? d.color ?? BLUE, size: 13, family: FONT, weight: 'normal', backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
  }];
}
/** Extend segment a→b to the pane edges when the drawing asks for it. */
function extendSeg(a: Coordinate, b: Coordinate, width: number, d?: Drawing): [Coordinate, Coordinate] {
  if (!d?.extL && !d?.extR) return [a, b];
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  const k = r.x === l.x ? 0 : (r.y - l.y) / (r.x - l.x);
  const L = d.extL ? { x: 0, y: l.y - k * l.x } : l;
  const R = d.extR ? { x: width, y: r.y + k * (width - r.x) } : r;
  return [L, R];
}

const label = (x: number, y: number, text: string, bg: string, align = 'center', baseline = 'middle'): Fig => ({
  type: 'text', ignoreEvent: true,
  attrs: { x, y, text, align, baseline },
  styles: {
    color: '#ffffff', size: 11, family: FONT, weight: 'normal', backgroundColor: bg, borderColor: bg,
    borderRadius: 2, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
  },
});

/** Price label on the right-hand price scale, like TradingView shows for horizontal lines. */
function yAxisLabel(chart: Chart, overlay: O, coordinates: Coordinate[], bounding: { width: number }, yAxis: any): Fig[] {
  const v = overlay.points[0]?.value;
  if (!coordinates.length || typeof v !== 'number') return [];
  const fromZero = yAxis?.isFromZero?.() ?? false;
  const color = overlay.extendData?.color ?? BLUE;
  void chart;
  return [{
    type: 'text', ignoreEvent: true,
    attrs: { x: fromZero ? 0 : bounding.width, y: coordinates[0].y, text: fmtPrice(v), align: fromZero ? 'left' : 'right', baseline: 'middle' },
    styles: { color: '#ffffff', size: 11, family: FONT, backgroundColor: color, borderColor: color, borderRadius: 2, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
  }];
}

function arrowHead(from: Coordinate, to: Coordinate, size: number): Coordinate[] {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const a = ang + Math.PI - 0.45, b = ang + Math.PI + 0.45;
  return [to, { x: to.x + size * Math.cos(a), y: to.y + size * Math.sin(a) }, { x: to.x + size * Math.cos(b), y: to.y + size * Math.sin(b) }];
}

/** Index of the first bar starting after `ts`. */
function firstAfter(data: KLineData[], ts: number): number {
  let lo = 0, hi = data.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (data[m].timestamp <= ts) lo = m + 1; else hi = m; }
  return lo;
}

const base = (name: string, totalStep: number): Pick<OverlayTemplate<Drawing>, 'name' | 'totalStep' | 'needDefaultPointFigure' | 'needDefaultXAxisFigure' | 'needDefaultYAxisFigure'> =>
  ({ name, totalStep, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true });

// ---------- position tool (long / short) ----------
// points: [0] entry (left edge)  [1] target  [2] stop  [3] right edge (at entry price)
function positionFigures(side: 'long' | 'short') {
  return ({ chart, overlay, coordinates }: { chart: Chart; overlay: O; coordinates: Coordinate[] }): Fig[] => {
    const pts = overlay.points;
    if (coordinates.length < 4 || pts.length < 4) {
      // Just placed: show a marker until the full box is built
      return coordinates.length ? [line([{ x: coordinates[0].x - 6, y: coordinates[0].y }, { x: coordinates[0].x + 40, y: coordinates[0].y }], overlay.extendData)] : [];
    }
    remember(pts);
    const d = overlay.extendData;
    const E = pts[0].value!, T = pts[1].value!, S = pts[2].value!;
    const [c0, cT, cS, c3] = coordinates;
    const x0 = Math.min(c0.x, c3.x), w = Math.max(2, Math.abs(c3.x - c0.x)), xm = x0 + w / 2;
    const qty = Math.max(1, d?.qty ?? 1), contract = d?.contract ?? 'NQ';
    const usd = (pts: number) => pts * POINT_VALUE[contract] * qty;
    const reward = Math.abs(T - E), risk = Math.abs(E - S);
    const rr = risk > 0 ? reward / risk : 0;
    const pct = (v: number) => `${((v / E) * 100).toFixed(2)}%`;

    const figs: Fig[] = [
      { type: 'rect', attrs: { x: x0, y: Math.min(c0.y, cT.y), width: w, height: Math.abs(cT.y - c0.y) }, styles: { style: 'fill', color: rgba(UP, 0.18) } },
      { type: 'rect', attrs: { x: x0, y: Math.min(c0.y, cS.y), width: w, height: Math.abs(cS.y - c0.y) }, styles: { style: 'fill', color: rgba(DOWN, 0.18) } },
      line([{ x: x0, y: c0.y }, { x: x0 + w, y: c0.y }], undefined, { styles: { color: '#787b86', size: 1, style: 'solid' } }),
    ];

    // Outcome on the bars inside the box: the stop wins when both levels are hit in one bar
    const data = chart.getDataList();
    let outcome = '';
    if (data.length && risk > 0) {
      const from = firstAfter(data, pts[0].timestamp!), end = pts[3].timestamp!;
      const long = side === 'long';
      for (let i = from; i < data.length && data[i].timestamp <= end; i++) {
        const k = data[i];
        if (long ? k.low <= S : k.high >= S) { outcome = `Stopped out ${signed(-1)}R (${fmtUsd(-usd(risk))})`; break; }
        if (long ? k.high >= T : k.low <= T) { outcome = `Target hit ${signed(rr)}R (${fmtUsd(usd(reward))})`; break; }
        if (i + 1 >= data.length || data[i + 1].timestamp > end) {
          const move = long ? k.close - E : E - k.close;
          outcome = `Open ${signed(move / risk)}R (${fmtUsd(usd(move))})`;
        }
      }
    }

    const targetAbove = cT.y < c0.y, stopAbove = cS.y < c0.y;
    figs.push(label(xm, cT.y + (targetAbove ? -12 : 12),
      `Target ${fmtPrice(reward)} (${pct(reward)}) ${Math.round(reward / TICK)} ticks · ${fmtUsd(usd(reward))}`, rgba(UP, 0.95)));
    figs.push(label(xm, cS.y + (stopAbove ? -12 : 12),
      `Stop ${fmtPrice(risk)} (${pct(risk)}) ${Math.round(risk / TICK)} ticks · ${fmtUsd(usd(risk))}`, rgba(DOWN, 0.95)));
    figs.push(label(xm, c0.y, `R:R ${rr.toFixed(2)} · ${qty} ${contract}${outcome ? ` · ${outcome}` : ''}`, 'rgba(76, 82, 94, 0.95)'));
    return figs;
  };
}

// Last good entry/right-edge times per position, so a drag that would put the right edge at or before the entry
// snaps back instead of flipping the box (TradingView keeps a position forward in time; a flipped box put the
// stop/target handles on the right and lost the outcome). Keyed by the entry time, which the target point still
// holds while a drag is being applied; recorded on every render so a snapshot exists before the first drag.
type P = { dataIndex?: number; timestamp?: number; value?: number };
const lastGood = new Map<number, { e: P; r: P }>();
const runsForward = (e: P, r: P) => (e.dataIndex != null && r.dataIndex != null)
  ? r.dataIndex > e.dataIndex : (r.timestamp ?? 0) > (e.timestamp ?? 0);
function remember(pts: P[]) {
  const [e, , , r] = pts;
  if (pts.length < 4 || e.timestamp == null || !runsForward(e, r)) return;
  if (lastGood.size > 500) lastGood.clear();
  lastGood.set(e.timestamp, { e: { timestamp: e.timestamp, dataIndex: e.dataIndex }, r: { timestamp: r.timestamp, dataIndex: r.dataIndex } });
}

function positionTemplate(side: 'long' | 'short'): OverlayTemplate<Drawing> {
  return {
    ...base(`jc_${side}`, 2),
    needDefaultXAxisFigure: false,
    createPointFigures: positionFigures(side) as any,
    // Keep the box rectangular: stop and target stay on the left edge,
    // the right-edge handle only changes the width
    performEventPressedMove: ({ points, performPointIndex }) => {
      if (points.length < 4) return;
      const [e, t, s, r] = points;
      if ((performPointIndex === 0 || performPointIndex === 3) && !runsForward(e, r)) {
        const good = t.timestamp != null ? lastGood.get(t.timestamp) : undefined;
        const moved = performPointIndex === 0 ? e : r, snap = good && (performPointIndex === 0 ? good.e : good.r);
        if (snap) { moved.timestamp = snap.timestamp; moved.dataIndex = snap.dataIndex; }
      }
      if (performPointIndex === 0) {
        for (const p of [t, s]) { p.timestamp = e.timestamp; p.dataIndex = e.dataIndex; }
        r.value = e.value;
      } else if (performPointIndex === 1 || performPointIndex === 2) {
        const p = points[performPointIndex];
        p.timestamp = e.timestamp; p.dataIndex = e.dataIndex;
      } else if (performPointIndex === 3) {
        r.value = e.value;
      }
      remember(points);
    },
  };
}

// ---------- measure (Shift + drag, not saved) ----------
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function textWidth(text: string, size = 12): number {
  if (!measureCanvas) return text.length * 6.5;
  measureCanvas.font = `${size}px ${FONT}`;
  return measureCanvas.measureText(text).width;
}

const measure: OverlayTemplate<Drawing> = {
  name: 'jc_measure', totalStep: 3,
  needDefaultPointFigure: false, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, xAxis }) => {
    if (coordinates.length < 2) return [];
    const [a, b] = coordinates;
    const p0 = overlay.points[0], p1 = overlay.points[1];
    if (typeof p0?.value !== 'number' || typeof p1?.value !== 'number') return [];
    const diff = p1.value - p0.value;
    const up = diff >= 0;
    const col = up ? BLUE : DOWN;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const midX = x0 + w / 2, midY = y0 + h / 2;
    const bars = xAxis ? xAxis.convertFromPixel(b.x) - xAxis.convertFromPixel(a.x) : 0;
    const span = (p1.timestamp ?? 0) - (p0.timestamp ?? 0);
    const lines = [
      `${signed(diff)} (${signed((diff / p0.value) * 100)}%) ${signed(diff / TICK, 0)} ticks`,
      `NQ ${fmtUsd(diff * POINT_VALUE.NQ)} · MNQ ${fmtUsd(diff * POINT_VALUE.MNQ)}`,
      `${Math.abs(bars)} bars, ${fmtSpan(span)}`,
    ];
    const boxW = Math.max(...lines.map(t => textWidth(t))) + 16, boxH = lines.length * 17 + 8;
    const boxY = up ? y0 - boxH - 6 : y0 + h + 6;
    const figs: Fig[] = [
      { type: 'rect', ignoreEvent: true, attrs: { x: x0, y: y0, width: Math.max(1, w), height: Math.max(1, h) }, styles: { style: 'fill', color: rgba(col, 0.16) } },
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: midX, y: a.y }, { x: midX, y: b.y }] }, styles: { color: col, size: 1, style: 'solid' } },
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: a.x, y: midY }, { x: b.x, y: midY }] }, styles: { color: col, size: 1, style: 'solid' } },
    ];
    if (h > 8) figs.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: arrowHead({ x: midX, y: a.y }, { x: midX, y: b.y }, 7) }, styles: { style: 'fill', color: col } });
    if (w > 8) figs.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: arrowHead({ x: a.x, y: midY }, { x: b.x, y: midY }, 7) }, styles: { style: 'fill', color: col } });
    figs.push({ type: 'rect', ignoreEvent: true, attrs: { x: midX - boxW / 2, y: boxY, width: boxW, height: boxH }, styles: { style: 'fill', color: rgba(col, 0.92), borderRadius: 3 } });
    lines.forEach((text, i) => figs.push({
      type: 'text', ignoreEvent: true,
      attrs: { x: midX, y: boxY + 6 + i * 17, text, align: 'center', baseline: 'top' },
      styles: { color: '#ffffff', size: 12, family: FONT, backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
    }));
    return figs;
  },
};

// ---------- the line tools ----------
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// ---------- helpers for the range, profile and freehand tools ----------
/** Bars whose start lies in [t0, t1]. */
function barsIn(data: KLineData[], t0: number, t1: number): KLineData[] {
  const i0 = firstAfter(data, t0 - 1), i1 = firstAfter(data, t1);
  return data.slice(i0, Math.max(i0, i1));
}
const fmtVol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v)));
/** Bars, calendar time and volume between an overlay's first two points. */
function rangeStats(chart: Chart, overlay: O): { bars: number; span: number; vol: number } {
  const ta = overlay.points[0]?.timestamp, tb = overlay.points[1]?.timestamp;
  if (typeof ta !== 'number' || typeof tb !== 'number') return { bars: 0, span: 0, vol: 0 };
  const data = chart.getDataList();
  const t0 = Math.min(ta, tb), t1 = Math.max(ta, tb);
  const inside = barsIn(data, t0, t1);
  return { bars: Math.max(0, inside.length - 1) * Math.sign(tb - ta || 1), span: tb - ta, vol: inside.reduce((s, k) => s + (k.volume ?? 0), 0) };
}

export interface VolumeProfile { lo: number; step: number; rows: { up: number; down: number }[]; poc: number; vaLo: number; vaHi: number; }
/**
 * Volume at price for a set of bars: each bar's volume is spread evenly over the rows its
 * high-low range covers (up volume for close >= open, else down). Value area = 70% of the
 * volume, grown outward from the point of control, as TradingView does.
 */
export function volumeProfile(bars: KLineData[], rowCount: number): VolumeProfile | null {
  let lo = Infinity, hi = -Infinity;
  for (const k of bars) { lo = Math.min(lo, k.low); hi = Math.max(hi, k.high); }
  if (!Number.isFinite(lo) || hi <= lo) return null;
  const step = (hi - lo) / rowCount;
  const rows = Array.from({ length: rowCount }, () => ({ up: 0, down: 0 }));
  for (const k of bars) {
    const v = k.volume ?? 0;
    if (!v) continue;
    const r0 = Math.min(rowCount - 1, Math.floor((k.low - lo) / step)), r1 = Math.min(rowCount - 1, Math.floor((k.high - lo) / step));
    const share = v / (r1 - r0 + 1);
    for (let r = r0; r <= r1; r++) { if (k.close >= k.open) rows[r].up += share; else rows[r].down += share; }
  }
  const tot = rows.map(r => r.up + r.down);
  let poc = 0;
  tot.forEach((v, i) => { if (v > tot[poc]) poc = i; });
  const total = tot.reduce((s, v) => s + v, 0);
  let vaLo = poc, vaHi = poc, acc = tot[poc];
  while (acc < total * 0.7 && (vaLo > 0 || vaHi < rowCount - 1)) {
    const below = vaLo > 0 ? tot[vaLo - 1] : -1, above = vaHi < rowCount - 1 ? tot[vaHi + 1] : -1;
    if (above >= below) { vaHi++; acc += above; } else { vaLo--; acc += below; }
  }
  return { lo, step, rows, poc, vaLo, vaHi };
}

/** x pixel of time t, between bars too (freehand strokes keep their shape on any timeframe). */
function xAt(chart: Chart, xAxis: any, t: number): number {
  const data = chart.getDataList();
  if (!data.length || !xAxis) return 0;
  let step = Infinity;
  for (let i = Math.max(1, data.length - 6); i < data.length; i++) step = Math.min(step, data[i].timestamp - data[i - 1].timestamp);
  if (!Number.isFinite(step) || step <= 0) step = 60000;
  const i = firstAfter(data, t) - 1;
  let idx: number;
  if (i < 0) idx = (t - data[0].timestamp) / step;
  else if (i >= data.length - 1) idx = data.length - 1 + (t - data[data.length - 1].timestamp) / step;
  else idx = i + Math.min(1, (t - data[i].timestamp) / Math.min(step, data[i + 1].timestamp - data[i].timestamp));
  return xAxis.convertToPixel(idx);
}

/**
 * Brush / highlighter. The stroke is stored in the drawing's points (raw times and prices);
 * the overlay itself only carries the first and last point, so it can be dragged as a whole:
 * while it moves, the stroke is drawn shifted by how far the first point has moved from
 * `anchor` (where that point sat when the overlay was created).
 */
function freehand(name: string, highlighter: boolean): OverlayTemplate<Drawing> {
  return {
    ...base(name, 2), needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ chart, overlay, coordinates, xAxis, yAxis }) => {
      const d = overlay.extendData as (Drawing & { anchor?: { t: number; p: number } }) | undefined;
      if (!d || !yAxis || !coordinates.length || d.points.length < 1) return [];
      const anchor = d.anchor ?? d.points[0];
      const dx = coordinates[0].x - xAt(chart, xAxis, anchor.t);
      const dy = coordinates[0].y - yAxis.convertToPixel(anchor.p);
      const pts = d.points.map(p => ({ x: xAt(chart, xAxis, p.t) + dx, y: yAxis.convertToPixel(p.p) + dy }));
      if (pts.length === 1) pts.push({ x: pts[0].x + 0.5, y: pts[0].y });
      const size = highlighter ? Math.max(8, d.width * 6) : d.width;
      return [{ type: 'line', attrs: { coordinates: pts }, styles: { style: 'solid', size, color: d.color, smooth: !highlighter } }];
    },
  };
}

const templates: OverlayTemplate<Drawing>[] = [
  {
    ...base('jc_trend', 3),
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      if (coordinates.length !== 2) return [];
      const d = overlay.extendData;
      const [a, b] = extendSeg(coordinates[0], coordinates[1], bounding.width, d);
      const right = coordinates[0].x >= coordinates[1].x ? coordinates[0] : coordinates[1];
      return [line([a, b], d), ...lineText(d, right.x, right.y)];
    },
  },
  {
    ...base('jc_hline', 2), needDefaultXAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) =>
      [line([{ x: 0, y: coordinates[0].y }, { x: bounding.width, y: coordinates[0].y }], overlay.extendData),
        ...lineText(overlay.extendData, bounding.width - 70, coordinates[0].y)],
    createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => yAxisLabel(chart, overlay as O, coordinates, bounding, yAxis),
  },
  {
    ...base('jc_hray', 2),
    createPointFigures: ({ overlay, coordinates, bounding }) =>
      [line([coordinates[0], { x: bounding.width, y: coordinates[0].y }], overlay.extendData),
        ...lineText(overlay.extendData, bounding.width - 70, coordinates[0].y)],
    createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => yAxisLabel(chart, overlay as O, coordinates, bounding, yAxis),
  },
  {
    ...base('jc_vline', 2), needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) =>
      [line([{ x: coordinates[0].x, y: 0 }, { x: coordinates[0].x, y: bounding.height }], overlay.extendData)],
  },
  {
    ...base('jc_rect', 3),
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const st = lineStyle(d);
      const x0 = d?.extL ? 0 : Math.min(a.x, b.x);
      const x1 = d?.extR ? bounding.width : Math.max(a.x, b.x);
      return [{
        type: 'rect',
        attrs: { x: x0, y: Math.min(a.y, b.y), width: Math.max(1, x1 - x0), height: Math.max(1, Math.abs(b.y - a.y)) },
        styles: { style: 'stroke_fill', color: d?.fill ?? rgba(st.color, 0.15), borderColor: st.color, borderSize: st.size, borderStyle: st.style, borderDashedValue: st.dashedValue },
      }];
    },
  },
  {
    ...base('jc_fib', 3),
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const p0 = overlay.points[0]?.value, p1 = overlay.points[1]?.value;
      if (typeof p0 !== 'number' || typeof p1 !== 'number') return [];
      const xl = Math.min(a.x, b.x), xr = Math.max(a.x, b.x, xl + 40);
      const color = d?.color ?? '#787b86';
      const figs: Fig[] = [line([a, b], d, { styles: { ...lineStyle(d), style: 'dashed', dashedValue: [4, 4] } })];
      const lvls = d?.levels?.length ? [...d.levels].sort((x, y) => x.v - y.v) : FIB_LEVELS.map(v => ({ v, c: color }));
      const shade = d?.levels?.length ? d.fibFill !== false : true;
      lvls.forEach((lv, i) => {
        const y = b.y + (a.y - b.y) * lv.v;
        const price = p1 + (p0 - p1) * lv.v;
        if (i > 0 && shade) {
          const yPrev = b.y + (a.y - b.y) * lvls[i - 1].v;
          figs.push({ type: 'rect', attrs: { x: xl, y: Math.min(y, yPrev), width: xr - xl, height: Math.abs(y - yPrev) }, styles: { style: 'fill', color: rgba(lv.c, i % 2 ? 0.06 : 0.11) } });
        }
        figs.push(line([{ x: xl, y }, { x: xr, y }], d, { styles: { ...lineStyle(d), color: lv.c, style: 'solid' } }));
        figs.push({
          type: 'text',
          attrs: { x: xl - 4, y, text: `${lv.v} (${fmtPrice(price)})`, align: 'right', baseline: 'middle' },
          styles: { color: lv.c, size: 11, family: FONT, backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
        });
      });
      return figs;
    },
  },
  {
    ...base('jc_channel', 4),
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData;
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      if (coordinates.length < 3) return [line([a, b], d)];
      const c = coordinates[2];
      const yOnBase = b.x === a.x ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x);
      const dy = c.y - yOnBase;
      const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
      const color = lineStyle(d).color;
      return [
        { type: 'polygon', attrs: { coordinates: [a, b, b2, a2] }, styles: { style: 'fill', color: rgba(color, 0.08) } },
        line([a, b], d),
        line([a2, b2], d),
        line([{ x: a.x, y: a.y + dy / 2 }, { x: b.x, y: b.y + dy / 2 }], d, { styles: { color, size: 1, style: 'dashed', dashedValue: [4, 4] } }),
      ];
    },
  },
  {
    ...base('jc_text', 2), needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData;
      const size = [12, 14, 18, 24][Math.min(3, Math.max(0, (d?.width ?? 2) - 1))];
      return [{
        type: 'text',
        attrs: { x: coordinates[0].x, y: coordinates[0].y, text: d?.text || 'Text', align: 'left', baseline: 'bottom' },
        styles: { color: d?.color ?? BLUE, size, family: FONT, weight: 'normal', backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 2, paddingRight: 2, paddingTop: 2, paddingBottom: 2 },
      }];
    },
  },
  {
    ...base('jc_arrow', 3),
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const st = lineStyle(d);
      return [
        line([a, b], d),
        { type: 'polygon', attrs: { coordinates: arrowHead(a, b, 8 + st.size * 3) }, styles: { style: 'fill', color: st.color } },
      ];
    },
  },
  positionTemplate('long'),
  positionTemplate('short'),
  measure,
  bracket(),
  tradeMarker(),
  // ---------- path: a polyline, placed click by click ----------
  {
    ...base('jc_path', 2),
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const figs: Fig[] = [];
      for (let i = 1; i < coordinates.length; i++) figs.push(line([coordinates[i - 1], coordinates[i]], overlay.extendData));
      return figs;
    },
  },
  // ---------- brush / highlighter: freehand strokes drawn from the raw points ----------
  freehand('jc_brush', false),
  freehand('jc_highlight', true),
  // ---------- date range ----------
  {
    ...base('jc_daterange', 3),
    createPointFigures: ({ chart, overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const st = lineStyle(d);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const s = rangeStats(chart, overlay);
      const midY = (y0 + y1) / 2;
      const right = b.x >= a.x;
      const tip = { x: right ? x1 : x0, y: midY }, tail = { x: right ? x0 : x1, y: midY };
      return [
        { type: 'rect', attrs: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }, styles: { style: 'fill', color: rgba(st.color, 0.15) } },
        line([{ x: x0, y: y0 }, { x: x0, y: y1 }], d), line([{ x: x1, y: y0 }, { x: x1, y: y1 }], d),
        line([tail, tip], d),
        { type: 'polygon', attrs: { coordinates: arrowHead(tail, tip, 7) }, styles: { style: 'fill', color: st.color } },
        label((x0 + x1) / 2, y1 + 14, `${s.bars} bars, ${fmtSpan(s.span)}${s.vol ? ` · Vol ${fmtVol(s.vol)}` : ''}`, rgba(st.color, 0.92)),
      ];
    },
  },
  // ---------- date and price range ----------
  {
    ...base('jc_dprange', 3),
    createPointFigures: ({ chart, overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const p0 = overlay.points[0]?.value, p1 = overlay.points[1]?.value;
      if (typeof p0 !== 'number' || typeof p1 !== 'number') return [];
      const st = lineStyle(d);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const s = rangeStats(chart, overlay);
      const diff = p1 - p0;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const vTip = { x: mx, y: b.y }, vTail = { x: mx, y: a.y };
      const hTip = { x: b.x, y: my }, hTail = { x: a.x, y: my };
      return [
        { type: 'rect', attrs: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }, styles: { style: 'fill', color: rgba(st.color, 0.15) } },
        line([vTail, vTip], d), line([hTail, hTip], d),
        { type: 'polygon', attrs: { coordinates: arrowHead(vTail, vTip, 7) }, styles: { style: 'fill', color: st.color } },
        { type: 'polygon', attrs: { coordinates: arrowHead(hTail, hTip, 7) }, styles: { style: 'fill', color: st.color } },
        label(mx, (diff >= 0 ? y0 - 16 : y1 + 16),
          `${signed(diff)} (${signed((diff / p0) * 100)}%) ${signed(diff / TICK, 0)} ticks · ${s.bars} bars, ${fmtSpan(s.span)}${s.vol ? ` · Vol ${fmtVol(s.vol)}` : ''}`,
          rgba(st.color, 0.92)),
      ];
    },
  },
  // ---------- Gann square ----------
  {
    ...base('jc_gann', 3),
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const st = lineStyle(d);
      const thin = { ...st, size: 1, style: 'solid' };
      const figs: Fig[] = [];
      const LV = [0.25, 0.382, 0.5, 0.618, 0.75];
      const X = (f: number) => a.x + (b.x - a.x) * f, Y = (f: number) => a.y + (b.y - a.y) * f;
      figs.push({ type: 'rect', attrs: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
        styles: { style: 'stroke_fill', color: rgba(st.color, 0.06), borderColor: st.color, borderSize: st.size } });
      LV.forEach((f, i) => {
        figs.push({ type: 'rect', attrs: { x: Math.min(a.x, b.x), y: Math.min(Y(f), Y(LV[i + 1] ?? 1)), width: Math.abs(b.x - a.x), height: Math.abs(Y(LV[i + 1] ?? 1) - Y(f)) },
          styles: { style: 'fill', color: rgba(st.color, i % 2 ? 0.04 : 0.09) } });
        figs.push(line([{ x: a.x, y: Y(f) }, { x: b.x, y: Y(f) }], d, { styles: thin }));
        figs.push(line([{ x: X(f), y: a.y }, { x: X(f), y: b.y }], d, { styles: thin }));
      });
      // fans from the first corner to the far edges, and both diagonals
      figs.push(line([a, b], d), line([{ x: a.x, y: b.y }, { x: b.x, y: a.y }], d));
      for (const f of LV) {
        figs.push(line([a, { x: b.x, y: Y(f) }], d, { styles: thin }));
        figs.push(line([a, { x: X(f), y: b.y }], d, { styles: thin }));
      }
      return figs;
    },
  },
  // ---------- lines: ray, extended line, info line ----------
  {
    ...base('jc_ray', 3),
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData;
      const [a, b] = coordinates;
      // a ray starts at the first point and runs through the second to the edge
      const k = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
      const edge = b.x >= a.x ? { x: bounding.width, y: a.y + k * (bounding.width - a.x) } : { x: 0, y: a.y - k * a.x };
      return [line([a, b.x === a.x ? b : edge], d), ...lineText(d, b.x, b.y)];
    },
  },
  {
    ...base('jc_xline', 3),
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData;
      const [a, b] = extendSeg(coordinates[0], coordinates[1], bounding.width, { ...(d ?? {}), extL: true, extR: true } as Drawing);
      return [line([a, b], d)];
    },
  },
  {
    ...base('jc_infoline', 3),
    createPointFigures: ({ chart, overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData;
      const [a, b] = coordinates;
      const p0 = overlay.points[0]?.value, p1 = overlay.points[1]?.value;
      const figs: Fig[] = [line([a, b], d)];
      if (typeof p0 !== 'number' || typeof p1 !== 'number') return figs;
      const st = rangeStats(chart, overlay as O);
      const diff = p1 - p0;
      const angle = Math.atan2(a.y - b.y, b.x - a.x) * 180 / Math.PI;
      const text = `${signed(diff, 2)} (${signed((diff / p0) * 100, 2)}%) · ${Math.abs(st.bars)} bars, ${fmtSpan(st.span)} · ${angle.toFixed(0)}°`;
      figs.push(label((a.x + b.x) / 2, Math.min(a.y, b.y) - 12, text, rgba(lineStyle(d).color, 0.9)));
      return figs;
    },
  },
  // ---------- Fib extension (trend-based): A -> B, projected from C ----------
  {
    ...base('jc_fibext', 4),
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData;
      const figs: Fig[] = [];
      if (coordinates.length >= 2) figs.push(line(coordinates.slice(0, Math.min(3, coordinates.length)), d, { styles: { ...lineStyle(d), style: 'dashed', dashedValue: [4, 4] } }));
      if (coordinates.length < 3) return figs;
      const [pa, pb, pc] = [0, 1, 2].map(i => overlay.points[i]?.value);
      if (typeof pa !== 'number' || typeof pb !== 'number' || typeof pc !== 'number') return figs;
      const [, b, c] = coordinates;
      const xl = Math.min(b.x, c.x), xr = Math.max(b.x, c.x) + 120;
      const color = lineStyle(d).color;
      // pixel per price unit from A/B (same pane, linear scale)
      const ppu = (coordinates[1].y - coordinates[0].y) / ((pb - pa) || 1);
      for (const v of [0, 0.618, 1, 1.272, 1.618, 2, 2.618]) {
        const price = pc + (pb - pa) * v;
        const y = c.y + (price - pc) * ppu;
        figs.push(line([{ x: xl, y }, { x: xr, y }], d, { styles: { ...lineStyle(d), style: 'solid', size: 1, color: v === 1 ? color : rgba(color, 0.75) } }));
        figs.push({
          type: 'text',
          attrs: { x: xl - 4, y, text: `${v} (${fmtPrice(price)})`, align: 'right', baseline: 'middle' },
          styles: { color, size: 11, family: FONT, backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
        });
      }
      return figs;
    },
  },
  // ---------- ellipse ----------
  {
    ...base('jc_ellipse', 3),
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, st = lineStyle(d);
      const [a, b] = coordinates;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      const pts = Array.from({ length: 64 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }; });
      return [{ type: 'polygon', attrs: { coordinates: pts }, styles: { style: 'stroke_fill', color: d?.fill ?? rgba(st.color, 0.12), borderColor: st.color, borderSize: st.size, borderStyle: st.style, borderDashedValue: st.dashedValue } }];
    },
  },
  // ---------- callout: a note in a box pointing at a spot ----------
  {
    ...base('jc_callout', 3), needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData, st = lineStyle(d);
      const [a, b] = coordinates;
      const box = b ?? { x: a.x + 40, y: a.y - 40 };
      return [
        line([a, box], d, { styles: { ...st, size: 1, style: 'solid' } }),
        { type: 'circle', attrs: { x: a.x, y: a.y, r: 2.5 }, styles: { style: 'fill', color: st.color } },
        {
          type: 'text', attrs: { x: box.x, y: box.y, text: d?.text || 'Note', align: 'center', baseline: 'middle' },
          styles: { color: '#ffffff', size: 12, family: FONT, weight: 'normal', backgroundColor: rgba(st.color, 0.92), borderColor: st.color, borderRadius: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5 },
        },
      ];
    },
  },
  // ---------- price label: one click, shows the price there ----------
  {
    ...base('jc_pricelabel', 2), needDefaultXAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const p = overlay.points[0]?.value;
      if (!coordinates.length || typeof p !== 'number') return [];
      const d = overlay.extendData, c = lineStyle(d).color;
      const a = coordinates[0];
      return [
        { type: 'polygon', attrs: { coordinates: [a, { x: a.x + 8, y: a.y - 6 }, { x: a.x + 8, y: a.y + 6 }] }, styles: { style: 'fill', color: c } },
        { type: 'text', attrs: { x: a.x + 8, y: a.y, text: d?.text ? `${d.text} ${fmtPrice(p)}` : fmtPrice(p), align: 'left', baseline: 'middle' },
          styles: { color: '#ffffff', size: 11, family: FONT, weight: 'normal', backgroundColor: c, borderColor: c, borderRadius: 2, paddingLeft: 5, paddingRight: 6, paddingTop: 3, paddingBottom: 3 } },
      ];
    },
  },
  // ---------- arrow markers (one click): up arrow below the spot, down arrow above it ----------
  ...(['up', 'down'] as const).map(dir => ({
    ...base(`jc_arrow${dir}`, 2), needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }: { overlay: O; coordinates: Coordinate[] }): Fig[] => {
      if (!coordinates.length) return [];
      const d = overlay.extendData, c = lineStyle(d).color;
      const { x, y } = coordinates[0];
      const s = dir === 'up' ? 1 : -1, w = 7 + (d?.width ?? 1) * 2;
      const tip = { x, y: y + s * 4 };
      const head = [tip, { x: x - w, y: tip.y + s * w }, { x: x + w, y: tip.y + s * w }];
      return [
        { type: 'polygon', attrs: { coordinates: head }, styles: { style: 'fill', color: c } },
        { type: 'rect', attrs: { x: x - w / 3, y: s > 0 ? tip.y + w : tip.y - w - w * 1.4, width: (w * 2) / 3, height: w * 1.4 }, styles: { style: 'fill', color: c } },
        ...(d?.text ? [{ type: 'text', attrs: { x, y: tip.y + s * (w * 2.6 + 2), text: d.text, align: 'center', baseline: s > 0 ? 'top' : 'bottom' },
          styles: { color: c, size: 12, family: FONT, backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 } } as Fig] : []),
      ];
    },
  })),
  // ---------- chart patterns ----------
  {
    ...base('jc_xabcd', 6),
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData, st = lineStyle(d);
      const names = ['X', 'A', 'B', 'C', 'D'];
      const figs: Fig[] = [];
      const c = coordinates;
      if (c.length >= 3) figs.push({ type: 'polygon', attrs: { coordinates: [c[0], c[1], c[2]] }, styles: { style: 'fill', color: rgba(st.color, 0.12) } });
      if (c.length >= 5) figs.push({ type: 'polygon', attrs: { coordinates: [c[2], c[3], c[4]] }, styles: { style: 'fill', color: rgba(st.color, 0.12) } });
      if (c.length >= 2) figs.push(line(c, d));
      if (c.length >= 3) figs.push(line([c[0], c[2]], d, { styles: { ...st, style: 'dashed', dashedValue: [3, 3], size: 1 } }));
      if (c.length >= 5) figs.push(line([c[2], c[4]], d, { styles: { ...st, style: 'dashed', dashedValue: [3, 3], size: 1 } }), line([c[1], c[3]], d, { styles: { ...st, style: 'dashed', dashedValue: [3, 3], size: 1 } }));
      const p = overlay.points.map(x => x.value as number);
      const ratio = (i: number, j: number, k: number, l: number) => Math.abs((p[k] - p[l]) / ((p[i] - p[j]) || 1));
      const mid = (i: number, j: number) => ({ x: (c[i].x + c[j].x) / 2, y: (c[i].y + c[j].y) / 2 });
      if (c.length >= 3 && p.length >= 3) { const m = mid(0, 2); figs.push(label(m.x, m.y, ratio(0, 1, 1, 2).toFixed(3), rgba(st.color, 0.85))); }
      if (c.length >= 4 && p.length >= 4) { const m = mid(1, 3); figs.push(label(m.x, m.y, ratio(1, 2, 2, 3).toFixed(3), rgba(st.color, 0.85))); }
      if (c.length >= 5 && p.length >= 5) {
        const m = mid(2, 4); figs.push(label(m.x, m.y, ratio(2, 3, 3, 4).toFixed(3), rgba(st.color, 0.85)));
        const m2 = mid(0, 4); figs.push(label(m2.x, m2.y, `AD/XA ${ratio(0, 1, 1, 4).toFixed(3)}`, rgba(st.color, 0.85)));
      }
      c.forEach((pt, i) => { if (i < 5) figs.push(label(pt.x, pt.y + (i % 2 ? -12 : 12), names[i], st.color)); });
      return figs;
    },
  },
  {
    ...base('jc_hs', 8),
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const d = overlay.extendData, st = lineStyle(d);
      const c = coordinates;
      const figs: Fig[] = [];
      if (c.length >= 2) figs.push(line(c, d));
      if (c.length >= 5) {
        // neckline through the two troughs (points 2 and 4), extended to the right
        const [n1, n2] = [c[2], c[4]];
        const k = n2.x === n1.x ? 0 : (n2.y - n1.y) / (n2.x - n1.x);
        figs.push(line([{ x: c[0].x, y: n1.y + k * (c[0].x - n1.x) }, { x: bounding.width, y: n1.y + k * (bounding.width - n1.x) }], d, { styles: { ...st, style: 'dashed', dashedValue: [5, 3], size: 1 } }));
      }
      const tags: [number, string][] = [[1, 'Left shoulder'], [3, 'Head'], [5, 'Right shoulder']];
      for (const [i, t] of tags) if (c[i]) figs.push(label(c[i].x, c[i].y - 14, t, rgba(st.color, 0.9)));
      return figs;
    },
  },
  ...([['jc_elliott', 7, ['0', '1', '2', '3', '4', '5']], ['jc_abc', 5, ['0', 'A', 'B', 'C']]] as const).map(([name, steps, names]) => ({
    ...base(name, steps),
    createPointFigures: ({ overlay, coordinates }: { overlay: O; coordinates: Coordinate[] }): Fig[] => {
      const d = overlay.extendData, st = lineStyle(d);
      const c = coordinates;
      const figs: Fig[] = c.length >= 2 ? [line(c, d)] : [];
      c.forEach((pt, i) => {
        if (i === 0 || i >= names.length) return;
        const up = i < c.length - 1 ? c[i + 1].y > pt.y : c[i - 1].y > pt.y; // a peak: label above
        figs.push({ type: 'text', attrs: { x: pt.x, y: pt.y + (up ? -14 : 14), text: names[i], align: 'center', baseline: 'middle' },
          styles: { color: '#ffffff', size: 11, family: FONT, weight: 'bold', backgroundColor: st.color, borderColor: st.color, borderRadius: 9, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2 } });
      });
      return figs;
    },
  })),
  // ---------- anchored VWAP: one click on the bar to start from (a swing, the open, news) ----------
  {
    ...base('jc_avwap', 2), needDefaultYAxisFigure: false,
    createPointFigures: ({ chart, overlay, coordinates, xAxis, yAxis }) => {
      const t = overlay.points[0]?.timestamp;
      if (!coordinates.length || typeof t !== 'number' || !xAxis || !yAxis) return [];
      const d = overlay.extendData;
      const data = chart.getDataList();
      const range = chart.getVisibleRange();
      const anchor = firstAfter(data, t - 1);
      if (anchor >= data.length) return [];
      const rows = anchoredVwap(data, anchor).filter(r => r[0] >= range.from - 1 && r[0] <= range.to);
      if (rows.length < 1) return [];
      const pt = (r: [number, number, number, number], k: 1 | 2 | 3) => ({ x: xAxis.convertToPixel(r[0]), y: yAxis.convertToPixel(r[k]) });
      const figs: Fig[] = [line(rows.map(r => pt(r, 1)), d, {})];
      // ±1 standard deviation bands, faint
      const band = { ...lineStyle(d), color: rgba(lineStyle(d).color, 0.4), style: 'dashed', dashedValue: [3, 3], size: 1 };
      figs.push(line(rows.map(r => pt(r, 2)), d, { styles: band }), line(rows.map(r => pt(r, 3)), d, { styles: band }));
      const last = rows[rows.length - 1];
      figs.push(label(pt(last, 1).x - 4, pt(last, 1).y - 11, `AVWAP ${fmtPrice(last[1])}`, lineStyle(d).color, 'right'));
      return figs;
    },
  },
  // ---------- fixed range volume profile ----------
  {
    ...base('jc_vprofile', 3),
    needDefaultYAxisFigure: false,
    createPointFigures: ({ chart, overlay, coordinates, yAxis }) => {
      if (coordinates.length < 2 || !yAxis) return [];
      const d = overlay.extendData;
      const [a, b] = coordinates;
      const t0 = Math.min(overlay.points[0]?.timestamp ?? 0, overlay.points[1]?.timestamp ?? 0);
      const t1 = Math.max(overlay.points[0]?.timestamp ?? 0, overlay.points[1]?.timestamp ?? 0);
      const bars = barsIn(chart.getDataList(), t0, t1);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      // Invisible click area over the whole box: the bars and labels ignore the mouse, so without this the
      // profile could only be grabbed on its thin dashed line (it looked impossible to move or delete).
      const hit = (yA: number, yB: number): Fig => ({ type: 'rect', attrs: { x: x0, y: Math.min(yA, yB), width: Math.max(8, x1 - x0), height: Math.max(8, Math.abs(yB - yA)) },
        styles: { style: 'fill', color: 'rgba(0, 0, 0, 0.001)', borderSize: 0 } });
      const figs: Fig[] = [
        line([{ x: x0, y: a.y }, { x: x1, y: a.y }], d, { styles: { ...lineStyle(d), style: 'dashed', dashedValue: [3, 3], size: 1 } }),
      ];
      if (!bars.length) return [hit(a.y, b.y), ...figs];
      const vp = volumeProfile(bars, 24);
      if (!vp) return [hit(a.y, b.y), ...figs];
      figs.unshift(hit(yAxis.convertToPixel(vp.lo), yAxis.convertToPixel(vp.lo + vp.rows.length * vp.step)));
      const width = Math.max(60, (x1 - x0) * 0.3);
      const max = Math.max(...vp.rows.map(r => r.up + r.down)) || 1;
      vp.rows.forEach((r, i) => {
        const yTop = yAxis.convertToPixel(vp.lo + (i + 1) * vp.step), yBot = yAxis.convertToPixel(vp.lo + i * vp.step);
        const h = Math.max(1, Math.abs(yBot - yTop) - 1);
        const inVA = i >= vp.vaLo && i <= vp.vaHi;
        const wu = (r.up / max) * width, wd = (r.down / max) * width;
        const y = Math.min(yTop, yBot);
        if (wu > 0) figs.push({ type: 'rect', attrs: { x: x0, y, width: wu, height: h }, styles: { style: 'fill', color: inVA ? 'rgba(41, 98, 255, 0.7)' : 'rgba(41, 98, 255, 0.3)' } });
        if (wd > 0) figs.push({ type: 'rect', attrs: { x: x0 + wu, y, width: wd, height: h }, styles: { style: 'fill', color: inVA ? 'rgba(251, 192, 45, 0.7)' : 'rgba(251, 192, 45, 0.3)' } });
      });
      const pocY = yAxis.convertToPixel(vp.lo + (vp.poc + 0.5) * vp.step);
      figs.push({ type: 'line', attrs: { coordinates: [{ x: x0, y: pocY }, { x: x1, y: pocY }] }, styles: { style: 'solid', size: 2, color: 'rgba(242, 54, 69, 1)' } });
      const vah = vp.lo + (vp.vaHi + 1) * vp.step, val = vp.lo + vp.vaLo * vp.step, poc = vp.lo + (vp.poc + 0.5) * vp.step;
      figs.push(label(x1, pocY, `POC ${fmtPrice(poc)}`, 'rgba(242, 54, 69, 0.92)', 'right'));
      figs.push(label(x1, yAxis.convertToPixel(vah), `VAH ${fmtPrice(vah)}`, 'rgba(41, 98, 255, 0.85)', 'right'));
      figs.push(label(x1, yAxis.convertToPixel(val), `VAL ${fmtPrice(val)}`, 'rgba(41, 98, 255, 0.85)', 'right'));
      return figs;
    },
  },
];

// ---------- replay: open position bracket and closed-trade markers ----------
interface BracketData { side: 'long' | 'short'; qty: number; contract: 'NQ' | 'MNQ'; entry: number; stop: number; target: number; pnl: number; }

// points: [0] entry  [1] stop  [2] target — all on the entry bar; drag the stop/target handles to move them
function bracket(): OverlayTemplate<Drawing> {
  return {
    name: 'jc_bracket', totalStep: 4,
    needDefaultPointFigure: true, needDefaultXAxisFigure: false, needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const b = overlay.extendData as unknown as BracketData;
      if (coordinates.length < 3 || !b) return [];
      const [ce, cs, ct] = coordinates;
      const x0 = Math.min(ce.x, bounding.width - 40), w = bounding.width - x0;
      const dir = b.side === 'long' ? 1 : -1, pv = POINT_VALUE[b.contract] * b.qty;
      const zone = (y1: number, y2: number, color: string): Fig =>
        ({ type: 'rect', ignoreEvent: true, attrs: { x: x0, y: Math.min(y1, y2), width: w, height: Math.abs(y2 - y1) }, styles: { style: 'fill', color } });
      const hline = (y: number, color: string, dashed = false): Fig =>
        ({ type: 'line', attrs: { coordinates: [{ x: x0, y }, { x: bounding.width, y }] }, styles: { color, size: 1, style: dashed ? 'dashed' : 'solid', dashedValue: [4, 3] } });
      const xr = bounding.width - 6;
      return [
        zone(ce.y, ct.y, rgba(UP, 0.08)),
        zone(ce.y, cs.y, rgba(DOWN, 0.08)),
        hline(ct.y, UP), hline(cs.y, DOWN), hline(ce.y, '#9598a1', true),
        label(xr, ct.y - 9, `TP ${fmtPrice(b.target)} · ${fmtUsd((b.target - b.entry) * dir * pv)}`, rgba(UP, 0.95), 'right'),
        label(xr, cs.y + 9, `SL ${fmtPrice(b.stop)} · ${fmtUsd((b.stop - b.entry) * dir * pv)}`, rgba(DOWN, 0.95), 'right'),
        label(xr, ce.y, `${b.side === 'long' ? 'Long' : 'Short'} ${b.qty} ${b.contract} @ ${fmtPrice(b.entry)} · ${fmtUsd(b.pnl)}`,
          b.pnl >= 0 ? rgba(UP, 0.95) : rgba(DOWN, 0.95), 'right'),
      ];
    },
    // stop and target stay on the entry bar; only their price moves
    performEventPressedMove: ({ points }) => {
      if (points.length < 3) return;
      for (const p of [points[1], points[2]]) { p.timestamp = points[0].timestamp; p.dataIndex = points[0].dataIndex; }
    },
  };
}

// Entry/exit of a closed trade (replay trades, or a journal trade opened on the chart).
// Optional stop/target are drawn as short dashed lines across the trade.
interface TradeData { side: 'long' | 'short' | null; pnl: number | null; r: number | null; stop?: number | null; target?: number | null; }
function tradeMarker(): OverlayTemplate<Drawing> {
  return {
    name: 'jc_trade', totalStep: 3,
    needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, yAxis }) => {
      const t = overlay.extendData as unknown as TradeData;
      if (coordinates.length < 2 || !t) return [];
      const [a, b] = coordinates;
      const pnl = t.pnl ?? 0;
      const col = t.pnl === null ? BLUE : pnl >= 0 ? UP : DOWN;
      const figs: Fig[] = [];
      const x0 = Math.min(a.x, b.x) - 6, x1 = Math.max(a.x, b.x, x0 + 40) + 6;
      for (const [v, c, name] of [[t.stop, DOWN, 'SL'], [t.target, UP, 'TP']] as const) {
        if (typeof v !== 'number' || !yAxis) continue;
        const y = yAxis.convertToPixel(v);
        figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: x0, y }, { x: x1, y }] }, styles: { color: c, size: 1, style: 'dashed', dashedValue: [4, 3] } });
        figs.push({ type: 'text', ignoreEvent: true, attrs: { x: x1 + 3, y, text: `${name} ${fmtPrice(v)}`, align: 'left', baseline: 'middle' },
          styles: { color: c, size: 10, family: FONT, backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 } });
      }
      const up = t.side === 'short' ? pnl < 0 : pnl >= 0; // put the label on the side price moved to
      figs.push(
        { type: 'line', ignoreEvent: true, attrs: { coordinates: [a, b] }, styles: { color: col, size: 1, style: 'dashed', dashedValue: [3, 3] } },
        { type: 'circle', ignoreEvent: true, attrs: { x: a.x, y: a.y, r: 4 }, styles: { style: 'fill', color: BLUE } },
        { type: 'circle', ignoreEvent: true, attrs: { x: b.x, y: b.y, r: 4 }, styles: { style: 'fill', color: col } },
      );
      const text = [t.r !== null ? `${signed(t.r, 1)}R` : '', t.pnl !== null ? fmtUsd(t.pnl) : ''].filter(Boolean).join(' ');
      if (text) figs.push(label(b.x, b.y + (up ? -14 : 14), text, rgba(col, 0.92)));
      return figs;
    },
  };
}

let registered = false;
export function registerDrawingOverlays() {
  if (registered) return;
  registered = true;
  templates.forEach(t => registerOverlay(t));
}
