// Custom drawing tools for the market chart, registered once with KLineChart.
// Every drawing overlay carries its Drawing (see drawings.ts) in `extendData`,
// which is where colour, width, line style, text and position size come from.
import { registerOverlay } from 'klinecharts';
import type { OverlayFigure, Coordinate, Chart, Overlay, KLineData, OverlayTemplate } from 'klinecharts';
import { Drawing, TICK, POINT_VALUE, fmtPrice, fmtUsd, fmtSpan, signed } from './drawings';

type O = Overlay<Drawing>;
type Fig = OverlayFigure;

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", "Segoe UI", Roboto, sans-serif';
const UP = '#089981', DOWN = '#f23645', BLUE = '#2962ff';

function rgba(hex: string, a: number): string {
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
      if (performPointIndex === 0) {
        for (const p of [t, s]) { p.timestamp = e.timestamp; p.dataIndex = e.dataIndex; }
        r.value = e.value;
      } else if (performPointIndex === 1 || performPointIndex === 2) {
        const p = points[performPointIndex];
        p.timestamp = e.timestamp; p.dataIndex = e.dataIndex;
      } else if (performPointIndex === 3) {
        r.value = e.value;
      }
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

const templates: OverlayTemplate<Drawing>[] = [
  {
    ...base('jc_trend', 3),
    createPointFigures: ({ overlay, coordinates }) => (coordinates.length === 2 ? [line(coordinates, overlay.extendData)] : []),
  },
  {
    ...base('jc_hline', 2), needDefaultXAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) =>
      [line([{ x: 0, y: coordinates[0].y }, { x: bounding.width, y: coordinates[0].y }], overlay.extendData)],
    createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => yAxisLabel(chart, overlay as O, coordinates, bounding, yAxis),
  },
  {
    ...base('jc_hray', 2),
    createPointFigures: ({ overlay, coordinates, bounding }) =>
      [line([coordinates[0], { x: bounding.width, y: coordinates[0].y }], overlay.extendData)],
    createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => yAxisLabel(chart, overlay as O, coordinates, bounding, yAxis),
  },
  {
    ...base('jc_vline', 2), needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) =>
      [line([{ x: coordinates[0].x, y: 0 }, { x: coordinates[0].x, y: bounding.height }], overlay.extendData)],
  },
  {
    ...base('jc_rect', 3),
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const d = overlay.extendData, [a, b] = coordinates;
      const st = lineStyle(d);
      return [{
        type: 'rect',
        attrs: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
        styles: { style: 'stroke_fill', color: rgba(st.color, 0.15), borderColor: st.color, borderSize: st.size, borderStyle: st.style, borderDashedValue: st.dashedValue },
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
      FIB_LEVELS.forEach((lv, i) => {
        const y = b.y + (a.y - b.y) * lv;
        const price = p1 + (p0 - p1) * lv;
        if (i > 0) {
          const yPrev = b.y + (a.y - b.y) * FIB_LEVELS[i - 1];
          figs.push({ type: 'rect', ignoreEvent: true, attrs: { x: xl, y: Math.min(y, yPrev), width: xr - xl, height: Math.abs(y - yPrev) }, styles: { style: 'fill', color: rgba(color, i % 2 ? 0.06 : 0.11) } });
        }
        figs.push(line([{ x: xl, y }, { x: xr, y }], d, { styles: { ...lineStyle(d), style: 'solid' } }));
        figs.push({
          type: 'text', ignoreEvent: true,
          attrs: { x: xl - 4, y, text: `${lv} (${fmtPrice(price)})`, align: 'right', baseline: 'middle' },
          styles: { color, size: 11, family: FONT, backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
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
        line([{ x: a.x, y: a.y + dy / 2 }, { x: b.x, y: b.y + dy / 2 }], d, { ignoreEvent: true, styles: { color, size: 1, style: 'dashed', dashedValue: [4, 4] } }),
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

interface TradeData { side: 'long' | 'short'; pnl: number; r: number; }
function tradeMarker(): OverlayTemplate<Drawing> {
  return {
    name: 'jc_trade', totalStep: 3,
    needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const t = overlay.extendData as unknown as TradeData;
      if (coordinates.length < 2 || !t) return [];
      const [a, b] = coordinates;
      const col = t.pnl >= 0 ? UP : DOWN;
      return [
        { type: 'line', ignoreEvent: true, attrs: { coordinates: [a, b] }, styles: { color: col, size: 1, style: 'dashed', dashedValue: [3, 3] } },
        { type: 'circle', ignoreEvent: true, attrs: { x: a.x, y: a.y, r: 4 }, styles: { style: 'fill', color: BLUE } },
        { type: 'circle', ignoreEvent: true, attrs: { x: b.x, y: b.y, r: 4 }, styles: { style: 'fill', color: col } },
        label(b.x, b.y + (t.side === 'long' ? (t.pnl >= 0 ? -14 : 14) : (t.pnl >= 0 ? 14 : -14)),
          `${signed(t.r, 1)}R ${fmtUsd(t.pnl)}`, rgba(col, 0.92)),
      ];
    },
  };
}

let registered = false;
export function registerDrawingOverlays() {
  if (registered) return;
  registered = true;
  templates.forEach(t => registerOverlay(t));
}
