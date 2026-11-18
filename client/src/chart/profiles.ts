// Volume profiles drawn behind the candles, like TradingView's:
//   JC_SVP   Session volume profile — one histogram per trading day (6pm ET session), with
//            POC / VAH / VAL lines across that day. Real value-area levels for S1 / S2 / S3.
//   JC_VRVP  Visible range volume profile — one histogram on the right for the bars on screen.
// Both are built from the chart's own candles (each candle's volume is spread evenly over its
// high-low range), so a lower timeframe gives a finer profile.
import { registerIndicator, KLineData } from 'klinecharts';
import { volumeProfile, VolumeProfile } from './overlays';
import { sessionDay } from './time';
import { fmtPrice } from './drawings';

type Row = Record<string, number>;
interface Ext { tfMin: number }

const UP = 'rgba(41, 98, 255, ', DOWN = 'rgba(251, 192, 45, ';
const POC = 'rgba(242, 54, 69, 0.95)', VA = 'rgba(41, 98, 255, 0.8)';

function drawHistogram(
  ctx: CanvasRenderingContext2D, vp: VolumeProfile, y: (p: number) => number,
  xEdge: number, width: number, fromRight: boolean, alpha: number,
) {
  const max = Math.max(...vp.rows.map(r => r.up + r.down)) || 1;
  vp.rows.forEach((r, i) => {
    const yTop = y(vp.lo + (i + 1) * vp.step), yBot = y(vp.lo + i * vp.step);
    const h = Math.max(1, Math.abs(yBot - yTop) - 1), top = Math.min(yTop, yBot);
    const inVA = i >= vp.vaLo && i <= vp.vaHi;
    const wu = (r.up / max) * width, wd = (r.down / max) * width;
    const a = inVA ? alpha : alpha * 0.45;
    ctx.fillStyle = UP + a + ')';
    ctx.fillRect(fromRight ? xEdge - wu : xEdge, top, wu, h);
    ctx.fillStyle = DOWN + a + ')';
    ctx.fillRect(fromRight ? xEdge - wu - wd : xEdge + wu, top, wd, h);
  });
}

const levelsOf = (vp: VolumeProfile) => ({
  poc: vp.lo + (vp.poc + 0.5) * vp.step,
  vah: vp.lo + (vp.vaHi + 1) * vp.step,
  val: vp.lo + vp.vaLo * vp.step,
});

function hline(ctx: CanvasRenderingContext2D, x0: number, x1: number, yy: number, color: string, dash: number[], size = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = size; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x0, Math.round(yy) + 0.5); ctx.lineTo(x1, Math.round(yy) + 0.5); ctx.stroke();
}

function tag(ctx: CanvasRenderingContext2D, x: number, yy: number, text: string, color: string, alignRight: boolean) {
  ctx.font = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const x0 = alignRight ? x - w : x;
  ctx.fillStyle = color;
  ctx.fillRect(x0, yy - 7, w, 14);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + 4, yy);
}

/** Sessions (6pm ET trading days) as index ranges [start, end) of the data list. */
function sessionRanges(data: KLineData[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  if (!data.length) return out;
  // widen to whole sessions so the profile of a day does not change while scrolling
  let s = Math.max(0, from);
  const d0 = sessionDay(data[s].timestamp);
  while (s > 0 && sessionDay(data[s - 1].timestamp) === d0) s--;
  let e = Math.min(data.length, to);
  if (e > 0) { const d1 = sessionDay(data[e - 1].timestamp); while (e < data.length && sessionDay(data[e].timestamp) === d1) e++; }
  let start = s;
  for (let i = s + 1; i <= e; i++) {
    if (i === e || sessionDay(data[i].timestamp) !== sessionDay(data[i - 1].timestamp)) { out.push([start, i]); start = i; }
  }
  return out;
}

export function registerProfiles() {
  registerIndicator<Row, number, Ext>({
    name: 'JC_SVP', shortName: 'Session VP', series: 'price', precision: 2, calcParams: [24], figures: [],
    calc: dataList => dataList.map(() => ({})),
    createTooltipDataSource: ({ indicator }) => ({ name: 'Session VP', calcParamsText: ` ${indicator.calcParams[0]} rows`, features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const data = chart.getDataList();
      if (!data.length || (indicator.extendData?.tfMin ?? 1) >= 1440) return true;
      const rows = Math.max(6, Math.min(200, Number(indicator.calcParams[0]) || 24));
      const range = chart.getVisibleRange();
      const half = chart.getBarSpace().halfBar;
      const x = (i: number) => xAxis.convertToPixel(i);
      const y = (p: number) => yAxis.convertToPixel(p);
      ctx.save();
      for (const [a, b] of sessionRanges(data, range.from, range.to)) {
        if (b - a < 3) continue;
        const vp = volumeProfile(data.slice(a, b), rows);
        if (!vp) continue;
        const x0 = x(a) - half, x1 = Math.min(bounding.width, x(b - 1) + half);
        if (x1 < 0 || x0 > bounding.width) continue;
        drawHistogram(ctx, vp, y, x0, Math.max(20, (x1 - x0) * 0.35), false, 0.32);
        const lv = levelsOf(vp);
        hline(ctx, x0, x1, y(lv.poc), POC, [], 1.5);
        hline(ctx, x0, x1, y(lv.vah), VA, [4, 3]);
        hline(ctx, x0, x1, y(lv.val), VA, [4, 3]);
        // labels at the session's right end (only when there is room)
        if (x1 - x0 > 90) {
          tag(ctx, x1 - 2, y(lv.poc), `POC ${fmtPrice(lv.poc)}`, POC, true);
          tag(ctx, x1 - 2, y(lv.vah), `VAH ${fmtPrice(lv.vah)}`, VA, true);
          tag(ctx, x1 - 2, y(lv.val), `VAL ${fmtPrice(lv.val)}`, VA, true);
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
      return true;
    },
  });

  registerIndicator<Row, number, Ext>({
    name: 'JC_VRVP', shortName: 'Visible VP', series: 'price', precision: 2, calcParams: [40], figures: [],
    calc: dataList => dataList.map(() => ({})),
    createTooltipDataSource: ({ indicator }) => ({ name: 'Visible range VP', calcParamsText: ` ${indicator.calcParams[0]} rows`, features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, yAxis }) => {
      const data = chart.getDataList();
      const range = chart.getVisibleRange();
      const from = Math.max(0, range.from), to = Math.min(data.length, range.to);
      if (to - from < 3) return true;
      const rows = Math.max(6, Math.min(200, Number(indicator.calcParams[0]) || 40));
      const vp = volumeProfile(data.slice(from, to), rows);
      if (!vp) return true;
      const y = (p: number) => yAxis.convertToPixel(p);
      ctx.save();
      drawHistogram(ctx, vp, y, bounding.width, bounding.width * 0.22, true, 0.38);
      const lv = levelsOf(vp);
      hline(ctx, 0, bounding.width, y(lv.poc), 'rgba(242, 54, 69, 0.55)', [], 1);
      tag(ctx, bounding.width - 2, y(lv.poc), `POC ${fmtPrice(lv.poc)}`, POC, true);
      tag(ctx, bounding.width - 2, y(lv.vah), `VAH ${fmtPrice(lv.vah)}`, VA, true);
      tag(ctx, bounding.width - 2, y(lv.val), `VAL ${fmtPrice(lv.val)}`, VA, true);
      ctx.restore();
      return true;
    },
  });
}

/** Anchored VWAP from bar index `anchor` to the end: [index, vwap, upper 1σ, lower 1σ][]. */
export function anchoredVwap(data: KLineData[], anchor: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let pv = 0, ppv = 0, vol = 0;
  for (let i = Math.max(0, anchor); i < data.length; i++) {
    const k = data[i];
    const v = k.volume ?? 0, tp = (k.high + k.low + k.close) / 3;
    pv += tp * v; ppv += tp * tp * v; vol += v;
    if (vol <= 0) continue;
    const w = pv / vol, sd = Math.sqrt(Math.max(0, ppv / vol - w * w));
    out.push([i, w, w + sd, w - sd]);
  }
  return out;
}
