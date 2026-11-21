// Footprint (order flow) on the chart: for each candle, the volume traded at each price split into
// buyers who lifted the offer and sellers who hit the bid (Databento trades, aggressor side).
//   wide candles : a cell per price, "sell x buy", shaded by which side won; imbalances (one side
//                  >= ratio x the other on the diagonal, like most footprint tools) in bold colour;
//                  POC (busiest price) boxed; delta and volume under the candle.
//   medium candles: one number per row, the delta (buy - sell) in green / red, so the numbers read
//                  without zooming in so far that the trend is lost.
//   thin candles : the same cells as coloured bars only (no numbers), so it still reads zoomed out.
// Data comes per New York session (9:30-16:00 ET) from /api/bars/footprint and stays in memory.
// In replay / forward testing only minutes the replay has finished are shown (no peeking).
import { registerIndicator } from 'klinecharts';

/** [minute start ms, [[price in ticks, buy, sell], ...]] (from the server) */
export type FpMinute = [number, [number, number, number][]];
export interface FpDay { day: string; contract: string; tick: number; start: number; end: number; minutes: FpMinute[]; trades: number; volume: number; cost: number; fake?: boolean; }

const days = new Map<string, FpDay>();
const byMinute = new Map<number, [number, number, number][]>();
let cutoff: number | null = null;   // replay: hide minutes that end after this time
let version = 0;
const listeners = new Set<() => void>();

export function addFootprintDay(d: FpDay) {
  days.set(d.day, d);
  for (const [t, lv] of d.minutes) byMinute.set(t, lv);
  version++; listeners.forEach(f => f());
}
export const hasFootprintDay = (day: string) => days.has(day);
export const footprintDays = () => [...days.keys()];
export function setFootprintCutoff(ms: number | null) { cutoff = ms; }
export function onFootprint(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export const footprintVersion = () => version;

export interface FpCandle { levels: Map<number, [number, number]>; buy: number; sell: number; poc: number; }
/** Sum the minutes [start, start + tfMin) into one candle (only finished minutes in replay). */
export function candleFootprint(start: number, tfMin: number): FpCandle | null {
  if (!byMinute.size || tfMin >= 1440) return null;
  const levels = new Map<number, [number, number]>();
  let buy = 0, sell = 0, any = false;
  for (let t = start; t < start + tfMin * 60000; t += 60000) {
    if (cutoff !== null && t + 60000 > cutoff) break;
    const lv = byMinute.get(t);
    if (!lv) continue;
    any = true;
    for (const [p, b, s] of lv) {
      const c = levels.get(p);
      if (c) { c[0] += b; c[1] += s; } else levels.set(p, [b, s]);
      buy += b; sell += s;
    }
  }
  if (!any) return null;
  let poc = 0, best = -1;
  for (const [p, [b, s]] of levels) if (b + s > best) { best = b + s; poc = p; }
  return { levels, buy, sell, poc };
}

/** Row sizes in ticks (0.25 pt): 0.25, 0.5, 1, 2, 2.5, 5, 10, 25, 50 points. */
const NICE = [1, 2, 4, 8, 10, 20, 40, 100, 200];
const fmtK = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const GREEN = (a: number) => `rgba(8, 153, 129, ${a})`, RED = (a: number) => `rgba(242, 54, 69, ${a})`;
/** Solid colour = `rgb` laid over `base` at strength a (cells must hide the candle under them). */
function mix(rgb: [number, number, number], base: [number, number, number], a: number) {
  return `rgb(${rgb.map((c, i) => Math.round(base[i] + (c - base[i]) * a)).join(',')})`;
}
const G3: [number, number, number] = [8, 153, 129], R3: [number, number, number] = [242, 54, 69];

interface Ext { tfMin: number }
export function registerFootprint() {
  registerIndicator<Record<string, number>, number, Ext>({
    name: 'JC_FP', shortName: 'Footprint', series: 'price', precision: 2, calcParams: [3], figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: ({ indicator }) => ({
      name: 'Footprint', calcParamsText: byMinute.size ? ` imbalance ${indicator.calcParams[0]}×` : ' (no order-flow data loaded for this day)', features: [], legends: [],
    }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const tf = indicator.extendData?.tfMin ?? 1;
      if (!byMinute.size || tf >= 1440) return true;
      const ratio = Math.max(1.5, Number(indicator.calcParams[0]) || 3);
      const data = chart.getDataList();
      const range = chart.getVisibleRange();
      const space = chart.getBarSpace();
      const bar = space.bar, half = space.halfBar;
      const tick = 0.25;
      const y = (p: number) => yAxis.convertToPixel(p);
      const ref = data[Math.min(data.length - 1, Math.max(0, range.from))]?.close ?? 20000;
      const rowPx = Math.abs(y(ref) - y(ref + 100)) / (100 / tick); // pixels are whole numbers: measure over 100 points
      const wide = bar >= 46;
      const medium = !wide && bar >= 16;
      // merge ticks into bigger rows when a tick is too thin to read (or to see); round numbers of points
      const minRow = wide ? 13 : medium ? 11 : 2;
      const need = Math.max(1, Math.ceil(minRow / Math.max(rowPx, 0.01)));
      const group = need <= 1 ? 1 : (NICE.find(n => n >= need) ?? need);
      const dark = (() => { const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g); return !bg || (+bg[0] + +bg[1] + +bg[2]) / 3 < 128; })();
      const ink = dark ? '#e6e8ee' : '#131722';
      const base: [number, number, number] = dark ? [19, 23, 34] : [255, 255, 255];
      ctx.save();
      ctx.textBaseline = 'middle';
      for (let i = Math.max(0, range.from); i < Math.min(data.length, range.to); i++) {
        const k = data[i];
        const fp = candleFootprint(k.timestamp, tf);
        if (!fp) continue;
        const xc = xAxis.convertToPixel(i), x0 = xc - half, w = bar;
        if (x0 > bounding.width || x0 + w < 0) continue;
        // rows (grouped)
        const rows = new Map<number, [number, number]>();
        for (const [p, [b, s]] of fp.levels) {
          const g = Math.floor(p / group) * group;
          const r = rows.get(g); if (r) { r[0] += b; r[1] += s; } else rows.set(g, [b, s]);
        }
        const pocRow = Math.floor(fp.poc / group) * group;
        let maxV = 1;
        for (const [, [b, s]] of rows) maxV = Math.max(maxV, b + s);
        const font = medium ? Math.max(8, Math.min(11, Math.floor(rowPx * group - 2)))
          : Math.max(9, Math.min(12, Math.floor(Math.min(rowPx * group - 2, w / 5.5))));
        const strip = wide || medium;   // leave a strip on the left for the candle itself
        const cx0 = strip ? x0 + 5 : x0 + 1, cw = strip ? w - 6 : w - 2;
        ctx.font = `${font}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        for (const [g, [b, s]] of rows) {
          const yTop = y((g + group) * tick - tick / 2), yBot = y(g * tick - tick / 2); // a price sits in the middle of its row
          const top = Math.min(yTop, yBot), h = Math.max(1, Math.abs(yBot - yTop) - (group * rowPx > 4 ? 1 : 0));
          const tot = b + s, a = 0.12 + 0.55 * (tot / maxV);
          if (wide || medium) ctx.fillStyle = mix(b >= s ? G3 : R3, base, (medium ? 0.12 : 0.18) + 0.5 * (tot / maxV));
          else ctx.fillStyle = b >= s ? GREEN(a) : RED(a);
          ctx.fillRect(cx0, top, cw, h);
          if (g === pocRow) { ctx.strokeStyle = dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.75)'; ctx.lineWidth = 1; ctx.strokeRect(cx0 + 0.5, top + 0.5, cw - 1, h - 1); }
          if (medium) {
            // one number: the row's delta, coloured by the side that won (skipped if it doesn't fit)
            const d = b - s, txt = fmtK(Math.abs(d));
            ctx.font = `${font}px -apple-system, "Segoe UI", Roboto, sans-serif`;
            if (ctx.measureText(txt).width <= cw + 2) {
              ctx.textAlign = 'center';
              ctx.fillStyle = d > 0 ? (dark ? '#5cffd0' : '#006b55') : d < 0 ? (dark ? '#ff9aa4' : '#c4001a') : ink;
              ctx.fillText(txt, cx0 + cw / 2, top + h / 2);
            }
            continue;
          }
          if (!wide) continue;
          // diagonal imbalances: buy at this row vs sell one row lower; sell vs buy one row higher
          const below = rows.get(g - group), above = rows.get(g + group);
          const buyImb = below ? b >= ratio * Math.max(1, below[1]) && b > 0 : false;
          const sellImb = above ? s >= ratio * Math.max(1, above[0]) && s > 0 : false;
          const mid = top + h / 2;
          ctx.textAlign = 'right';
          ctx.fillStyle = sellImb ? (dark ? '#ff9aa4' : '#c4001a') : ink; ctx.font = `${sellImb ? 'bold ' : ''}${font}px -apple-system, "Segoe UI", Roboto, sans-serif`;
          ctx.fillText(fmtK(s), cx0 + cw / 2 - 3, mid);
          ctx.textAlign = 'left';
          ctx.fillStyle = buyImb ? (dark ? '#5cffd0' : '#006b55') : ink; ctx.font = `${buyImb ? 'bold ' : ''}${font}px -apple-system, "Segoe UI", Roboto, sans-serif`;
          ctx.fillText(fmtK(b), cx0 + cw / 2 + 3, mid);
        }
        if (strip) {
          const upC = k.close >= k.open;
          ctx.fillStyle = upC ? GREEN(1) : RED(1);
          ctx.fillRect(x0 + 2, Math.min(y(k.high), y(k.low)), 1, Math.max(1, Math.abs(y(k.low) - y(k.high))));
          ctx.fillRect(x0 + 1, Math.min(y(k.open), y(k.close)), 3, Math.max(1, Math.abs(y(k.open) - y(k.close))));
        }
        // delta + volume under the candle
        if (bar >= 16) {
          const d = fp.buy - fp.sell;
          const yb = y(k.low) + 10;
          ctx.textAlign = 'center';
          ctx.font = `bold ${bar >= 26 ? 10 : 9}px -apple-system, "Segoe UI", Roboto, sans-serif`;
          ctx.fillStyle = d >= 0 ? GREEN(1) : RED(1);
          const dt = `${d >= 0 ? '+' : '−'}${fmtK(Math.abs(d))}`;
          if (ctx.measureText(dt).width <= space.gapBar + 4) ctx.fillText(dt, xc, yb);   // skipped when it would run into the next candle's
          if (wide) { ctx.font = '9px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = ink; ctx.fillText(fmtK(fp.buy + fp.sell), xc, yb + 12); }
        }
      }
      ctx.restore();
      return true;
    },
  });
}
