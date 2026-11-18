// VA80 on the chart: yesterday's New York value area (VAH / POC / VAL, 70% of RTH volume) drawn
// across today's session, plus the VA80 signal when it happens:
//   today opens above VAH (below VAL) and a 5m close comes back inside before 13:30 ET ->
//   SHORT (LONG) at the next candle, stop 1 x ATR(14, 5m), target 2R. Frozen rule 2026-11-18
//   (research/edge_hunter_research.md). Built from the chart's own candles (best on 1-5 min), so
//   in replay it only knows the candles already shown.
import { registerIndicator, KLineData } from 'klinecharts';
import { etMinutes, etOffset } from './time';

type Row = Record<string, number>;
interface Ext { tfMin: number }
const etDate = (ms: number) => new Date(ms + etOffset(ms)).toISOString().slice(0, 10);

interface DayVA { vah: number; val: number; poc: number }
function valueArea(bars: KLineData[]): DayVA | null {
  const vp = new Map<number, number>(); let tot = 0;
  for (const b of bars) {
    const v = b.volume ?? 0; if (!v) continue;
    // spread the candle's volume over its range in 2-pt bins
    const lo = Math.round(b.low / 2), hi = Math.round(b.high / 2), nb = hi - lo + 1;
    for (let x = lo; x <= hi; x++) vp.set(x, (vp.get(x) || 0) + v / nb);
    tot += v;
  }
  if (!tot) return null;
  const bins = [...vp.keys()].sort((a, b) => a - b);
  let pi = 0; for (let i = 1; i < bins.length; i++) if (vp.get(bins[i])! > vp.get(bins[pi])!) pi = i;
  let lo = pi, hi = pi, acc = vp.get(bins[pi])!;
  while (acc < 0.7 * tot && (lo > 0 || hi < bins.length - 1)) {
    const up = hi < bins.length - 1 ? vp.get(bins[hi + 1])! : -1, dn = lo > 0 ? vp.get(bins[lo - 1])! : -1;
    if (up >= dn) { hi++; acc += up; } else { lo--; acc += dn; }
  }
  return { vah: bins[hi] * 2 + 1, val: bins[lo] * 2 - 1, poc: bins[pi] * 2 };
}

export interface Va80Signal { i: number; dir: 1 | -1; entry: number; stop: number; target: number }
/** Prior-day VA per RTH date and the signals, from the candles on the chart. */
export function va80(data: KLineData[], tfMin: number) {
  const days: { date: string; from: number; to: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const m = etMinutes(data[i].timestamp);
    if (m < 570 || m >= 960) continue;
    const d = etDate(data[i].timestamp);
    const last = days[days.length - 1];
    if (last && last.date === d) last.to = i; else days.push({ date: d, from: i, to: i });
  }
  const levels: { from: number; to: number; va: DayVA; open: number }[] = [];
  const signals: Va80Signal[] = [];
  // ATR(14) on the chart's candles, scaled to 5 minutes
  const atr: number[] = []; let a = NaN;
  for (let i = 0; i < data.length; i++) {
    const b = data[i], pc = i ? data[i - 1].close : b.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    a = Number.isNaN(a) ? tr : a + (tr - a) / 14; atr.push(a * Math.sqrt(5 / Math.max(1, tfMin)));
  }
  for (let k = 1; k < days.length; k++) {
    const va = valueArea(data.slice(days[k - 1].from, days[k - 1].to + 1));
    if (!va) continue;
    const d = days[k], open = data[d.from].open;
    levels.push({ from: d.from, to: d.to, va, open });
    const above = open > va.vah, below = open < va.val;
    if (!above && !below) continue;
    for (let i = d.from; i <= d.to; i++) {
      const end = etMinutes(data[i].timestamp) + tfMin;   // candle close time (ET minutes)
      if (end > 810) break;                                // before 13:30
      const c = data[i].close;
      if (c < va.vah && c > va.val) {
        if (i + 1 > d.to) break;
        const dir = above ? -1 : 1, entry = data[i + 1].open, risk = Math.max(2, atr[i]);
        signals.push({ i: i + 1, dir, entry, stop: entry - dir * risk, target: entry + dir * 2 * risk });
        break;
      }
    }
  }
  return { levels, signals };
}

export function registerVa80() {
  registerIndicator<Row, number, Ext>({
    name: 'JC_VA80', shortName: 'VA80', series: 'price', precision: 2, calcParams: [], figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: () => ({ name: 'VA80 — yesterday’s value area', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const tf = indicator.extendData?.tfMin ?? 5;
      if (tf > 30) return true;
      const data = chart.getDataList();
      if (!data.length) return true;
      const { levels, signals } = va80(data, tf);
      const range = chart.getVisibleRange();
      const half = chart.getBarSpace().halfBar;
      const x = (i: number) => xAxis.convertToPixel(i), y = (p: number) => yAxis.convertToPixel(p);
      ctx.save();
      ctx.font = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
      for (const L of levels) {
        if (L.to < range.from || L.from > range.to) continue;
        const x0 = Math.max(0, x(L.from) - half), x1 = Math.min(bounding.width, x(L.to) + half);
        const yt = y(L.va.vah), yb = y(L.va.val);
        ctx.fillStyle = 'rgba(156, 39, 176, 0.07)';
        ctx.fillRect(x0, Math.min(yt, yb), x1 - x0, Math.abs(yb - yt));
        const line = (p: number, col: string, label: string, dash: number[]) => {
          ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, Math.round(y(p)) + 0.5); ctx.lineTo(x1, Math.round(y(p)) + 0.5); ctx.stroke();
          ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${label} ${p.toFixed(0)}`, x0 + 4, y(p) - 2);
        };
        line(L.va.vah, 'rgba(156, 39, 176, 0.9)', 'pVAH', [5, 3]);
        line(L.va.poc, 'rgba(242, 54, 69, 0.85)', 'pPOC', []);
        line(L.va.val, 'rgba(156, 39, 176, 0.9)', 'pVAL', [5, 3]);
      }
      ctx.setLineDash([]);
      for (const sg of signals) {
        if (sg.i < range.from || sg.i > range.to) continue;
        const xi = x(sg.i), col = sg.dir > 0 ? '#089981' : '#f23645';
        const yy = sg.dir > 0 ? y(data[sg.i].low) + 14 : y(data[sg.i].high) - 14;
        ctx.fillStyle = col;
        ctx.beginPath();
        if (sg.dir > 0) { ctx.moveTo(xi, yy - 8); ctx.lineTo(xi - 6, yy + 2); ctx.lineTo(xi + 6, yy + 2); }
        else { ctx.moveTo(xi, yy + 8); ctx.lineTo(xi - 6, yy - 2); ctx.lineTo(xi + 6, yy - 2); }
        ctx.fill();
        ctx.textAlign = 'center'; ctx.textBaseline = sg.dir > 0 ? 'top' : 'bottom';
        ctx.fillText('VA80', xi, sg.dir > 0 ? yy + 4 : yy - 4);
        // stop / target ticks for the next ~24 candles
        const x2 = Math.min(bounding.width, xi + 24 * 2 * half);
        for (const [p, c] of [[sg.stop, 'rgba(242,54,69,.8)'], [sg.target, 'rgba(8,153,129,.8)'], [sg.entry, 'rgba(160,160,160,.8)']] as [number, string][]) {
          ctx.strokeStyle = c; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(xi, Math.round(y(p)) + 0.5); ctx.lineTo(x2, Math.round(y(p)) + 0.5); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.restore();
      return true;
    },
  });
}
