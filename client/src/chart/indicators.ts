// Custom indicators for the market chart, registered once with KLineChart.
//   JC_SMA   simple moving average(s)      (the library's own "SMA" is a different, smoothed average)
//   JC_ATR   average true range (Wilder)
//   JC_VWAP  volume-weighted average price, reset at the 6pm ET session open
//   JC_BG    not an indicator: draws session shading, key levels, round numbers and
//            contract-roll markers behind the candles
import { registerIndicator, KLineData } from 'klinecharts';
import { registerNqSys } from './nqsys';
import { registerPhases } from './patterns';
import { registerProfiles } from './profiles';
import { registerFootprint } from './footprint';
import { registerVa80 } from './va80';
import { registerPriceAction } from './priceAction';
import { registerChartPatterns } from './chartPatterns';
import { registerCandlePatterns } from './candlePatterns';
import { sessionDay, sessionOf, SessionName, etMinutes } from './time';
import type { NewsMark } from './newsStore';

export interface LevelsData {
  session: string; start: number; nyStart: number; end: number;
  prev: { date: string; h: number; l: number; c: number } | null;
  open: number | null; nyOpen: number | null;
  overnight: { h: number; l: number } | null;
}

export interface BgData {
  tfMin: number;
  dark: boolean;
  sessions: boolean;
  breaks?: boolean;    // TradingView-style session breaks (line at each 6pm ET open) instead of shading
  breaksColor?: string;
  rolls: { contract: string; from: number }[] | null; // null = hidden
  levels: LevelsData | null;
  show: { pd: boolean; on: boolean; open: boolean; round: boolean };
  news?: NewsMark[] | null;      // economic releases: one vertical line per release time
}

type Row = Record<string, number>;

const SESSION_FILL: Record<'dark' | 'light', Record<Exclude<SessionName, null>, string>> = {
  dark: { asia: 'rgba(41, 98, 255, 0.07)', london: 'rgba(255, 152, 0, 0.06)', ny: 'rgba(8, 153, 129, 0.07)' },
  light: { asia: 'rgba(41, 98, 255, 0.06)', london: 'rgba(255, 152, 0, 0.07)', ny: 'rgba(8, 153, 129, 0.07)' },
};
const LEVEL_COLOR = { pd: '#f7a600', on: '#7e57c2', open: '#9598a1' };

/** First index whose bar starts at or after `ts`. */
function indexAtOrAfter(data: KLineData[], ts: number): number {
  let lo = 0, hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].timestamp < ts) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** x pixel of a moment: inside its bar by elapsed time; past the last bar by extrapolating whole bars. */
export function newsX(data: KLineData[], ms: number, tfMs: number, lastTs: number, toPx: (i: number) => number, half: number): number | null {
  if (!data.length) return null;
  if (ms > lastTs + tfMs) return toPx(data.length - 1 + (ms - lastTs) / tfMs) - half;
  const j = indexAtOrAfter(data, ms + 1) - 1;
  if (j < 0) return null;
  const frac = Math.min(1, Math.max(0, (ms - data[j].timestamp) / tfMs));
  return toPx(j + frac) - half;
}

const price = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let registered = false;
export function registerChartIndicators() {
  if (registered) return;
  registered = true;
  registerNqSys();
  registerPhases();
  registerProfiles();
  registerFootprint();
  registerVa80();
  registerPriceAction();
  registerChartPatterns();
  registerCandlePatterns();

  // Heikin Ashi candles (chart type), drawn over the hidden real candles
  registerIndicator<Row, number, { up: string; down: string; wickUp: string; wickDown: string; borderUp: string; borderDown: string }>({
    name: 'JC_HA', shortName: 'Heikin Ashi', series: 'price', precision: 2, calcParams: [], figures: [],
    calc: dataList => {
      let po = NaN, pc = NaN;
      return dataList.map(k => {
        const c = (k.open + k.high + k.low + k.close) / 4;
        const o = Number.isFinite(po) ? (po + pc) / 2 : (k.open + k.close) / 2;
        po = o; pc = c;
        return { o, h: Math.max(k.high, o, c), l: Math.min(k.low, o, c), c };
      });
    },
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const ext = indicator.extendData;
      const rows = indicator.result;
      const range = chart.getVisibleRange();
      const { bar, halfBar } = chart.getBarSpace();
      const w = Math.max(1, Math.round(bar * 0.8)), hw = Math.floor(w / 2);
      ctx.save();
      for (let i = Math.max(0, range.from); i < Math.min(rows.length, range.to); i++) {
        const r = rows[i];
        if (!r || !Number.isFinite(r.o)) continue;
        const up = r.c >= r.o;
        const x = Math.round(xAxis.convertToPixel(i));
        const yo = yAxis.convertToPixel(r.o), yc = yAxis.convertToPixel(r.c);
        ctx.strokeStyle = up ? ext.wickUp : ext.wickDown; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 0.5, yAxis.convertToPixel(r.h)); ctx.lineTo(x + 0.5, yAxis.convertToPixel(r.l)); ctx.stroke();
        const top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
        ctx.fillStyle = up ? ext.up : ext.down;
        ctx.fillRect(x - hw, top, w, h);
        if (halfBar > 2) { ctx.strokeStyle = up ? ext.borderUp : ext.borderDown; ctx.strokeRect(x - hw + 0.5, top + 0.5, w - 1, Math.max(0, h - 1)); }
      }
      ctx.restore();
      return true;
    },
  });

  registerIndicator<Row, number>({
    name: 'JC_SMA', shortName: 'SMA', series: 'price', precision: 2, calcParams: [50],
    figures: [{ key: 'sma1', title: 'SMA50: ', type: 'line' }],
    regenerateFigures: params => params.map((p, i) => ({ key: `sma${i + 1}`, title: `SMA${p}: `, type: 'line' })),
    calc: (dataList, indicator) => {
      const periods = indicator.calcParams;
      const sums = periods.map(() => 0);
      return dataList.map((k, i): Row => {
        const row: Row = {};
        periods.forEach((p, j) => {
          sums[j] += k.close;
          if (i >= p - 1) {
            row[`sma${j + 1}`] = sums[j] / p;
            sums[j] -= dataList[i - (p - 1)].close;
          }
        });
        return row;
      });
    },
  });

  registerIndicator<Row, number>({
    name: 'JC_ATR', shortName: 'ATR', precision: 2, calcParams: [14],
    figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const n = Math.max(1, indicator.calcParams[0] || 14);
      let atr = 0, sum = 0;
      return dataList.map((k, i): Row => {
        const pc = i > 0 ? dataList[i - 1].close : k.close;
        const tr = Math.max(k.high - k.low, Math.abs(k.high - pc), Math.abs(k.low - pc));
        if (i < n) {
          sum += tr;
          if (i < n - 1) return {};
          atr = sum / n;
        } else {
          atr = (atr * (n - 1) + tr) / n;
        }
        return { atr };
      });
    },
  });

  registerIndicator<Row, number, { tfMin: number }>({
    name: 'JC_VWAP', shortName: 'VWAP', series: 'price', precision: 2, calcParams: [],
    figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
    calc: (dataList, indicator) => {
      // A session VWAP means nothing on daily bars
      if ((indicator.extendData?.tfMin ?? 1) >= 1440) return dataList.map(() => ({}));
      let day = NaN, pv = 0, vol = 0;
      return dataList.map(k => {
        const d = sessionDay(k.timestamp);
        if (d !== day) { day = d; pv = 0; vol = 0; }
        const v = k.volume ?? 0;
        pv += ((k.high + k.low + k.close) / 3) * v;
        vol += v;
        return vol > 0 ? { vwap: pv / vol } : {};
      });
    },
  });

  registerIndicator<Row, number, BgData>({
    name: 'JC_BG', shortName: '', series: 'price', calcParams: [], figures: [],
    calc: dataList => dataList.map(() => ({})),
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const ext = indicator.extendData;
      const data = chart.getDataList();
      if (!ext || !data.length) return true;
      const range = chart.getVisibleRange();
      const from = Math.max(0, range.from), to = Math.min(data.length, range.to);
      if (to <= from) return true;
      const half = chart.getBarSpace().halfBar;
      const x = (i: number) => xAxis.convertToPixel(i);
      const { width, height } = bounding;
      const intraday = ext.tfMin < 1440;
      ctx.save();

      // Session breaks: a dashed line where each trading day starts (after the daily halt)
      if (ext.sessions && ext.breaks && intraday) {
        // super-light vertical lines: the 6pm ET session open (after the daily halt) and,
        // on 1h and below, the New York open (9:30) and close (16:00)
        const line = (xb: number, color: string, dash: number[]) => {
          ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.moveTo(xb, 0); ctx.lineTo(xb, height); ctx.stroke();
        };
        const dark = ext.dark;
        for (let i = Math.max(1, from); i < to; i++) {
          const t = data[i].timestamp;
          if (t - data[i - 1].timestamp > 30 * 60000 + ext.tfMin * 60000) {
            line(Math.round(x(i) - half) + 0.5, ext.breaksColor ?? 'rgba(0, 0, 0, 0.22)', []);
            continue;
          }
          if (ext.tfMin <= 60) {
            const m = etMinutes(t), mp = etMinutes(data[i - 1].timestamp);
            const crossed = (lv: number) => (mp < lv && m >= lv) || (m >= lv && mp > m);
            if (crossed(570) || crossed(960)) line(Math.round(x(i) - half) + 0.5, dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.13)', [2, 4]);
          }
        }
        ctx.setLineDash([]);
      }
      // Session shading: one rectangle per run of bars in the same session
      if (ext.sessions && !ext.breaks && ext.tfMin <= 60) {
        const fills = SESSION_FILL[ext.dark ? 'dark' : 'light'];
        let run: SessionName = null, start = from;
        const flush = (end: number) => {
          if (run) {
            const x0 = x(start) - half;
            ctx.fillStyle = fills[run];
            ctx.fillRect(x0, 0, x(end) + half - x0, height);
          }
        };
        for (let i = from; i < to; i++) {
          const s = sessionOf(data[i].timestamp);
          const gap = i > from && data[i].timestamp - data[i - 1].timestamp > 2 * 3600000;
          if (s !== run || gap) { flush(i - 1); run = s; start = i; }
        }
        flush(to - 1);
      }

      // Round numbers
      if (ext.show.round) {
        const r = yAxis.getRange();
        const lo = Math.min(r.displayFrom, r.displayTo), hi = Math.max(r.displayFrom, r.displayTo);
        let step = 100;
        while ((hi - lo) / step > 24) step *= step === 100 ? 5 : 2;
        ctx.strokeStyle = ext.dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
          const y = Math.round(yAxis.convertToPixel(p)) + 0.5;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
      }

      // Contract rolls: the front-month series is not back-adjusted, so price jumps here
      if (ext.rolls && intraday) {
        const first = data[from].timestamp, last = data[to - 1].timestamp;
        ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        for (const roll of ext.rolls.slice(1)) {
          if (roll.from < first || roll.from > last) continue;
          const xr = Math.round(x(indexAtOrAfter(data, roll.from)) - half) + 0.5;
          ctx.strokeStyle = ext.dark ? 'rgba(149,152,161,0.55)' : 'rgba(80,83,94,0.55)';
          ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(xr, 0); ctx.lineTo(xr, height); ctx.stroke();
          ctx.fillStyle = ext.dark ? '#9598a1' : '#50535e';
          ctx.fillText(`roll → ${roll.contract}`, xr + 5, height - 6);
        }
      }

      // News: a vertical line at each release (dashed = still to come), short name and the usual direction at the top
      if (ext.news && ext.news.length) {
        const tfMs = ext.tfMin * 60000;
        const lastTs = data[data.length - 1].timestamp;
        const xAt = (ms: number) => newsX(data, ms, tfMs, lastTs, i => xAxis.convertToPixel(i), half);
        ctx.font = '600 10.5px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        const rowEnd = [-1e9, -1e9, -1e9, -1e9];   // right edge of the last label in each of 4 label rows
        for (const n of ext.news) {
          const xn = xAt(n.ms);
          if (xn === null || xn < -2 || xn > width + 2) continue;
          const col = n.headline ? (ext.dark ? 'rgba(186, 104, 200, 0.6)' : 'rgba(142, 36, 170, 0.5)')
            : n.impact === 'high' ? (ext.dark ? 'rgba(239, 83, 80, 0.55)' : 'rgba(211, 47, 47, 0.5)') : (ext.dark ? 'rgba(224, 163, 58, 0.5)' : 'rgba(191, 128, 20, 0.5)');
          const xr = Math.round(xn) + 0.5;
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(n.future ? [4, 4] : n.headline ? [2, 3] : []);
          ctx.beginPath(); ctx.moveTo(xr, 0); ctx.lineTo(xr, height); ctx.stroke();
          ctx.setLineDash([]);
          const arrow = n.bias === 'up' ? ' ▲' : n.bias === 'down' ? ' ▼' : '';
          const text = n.label + arrow;
          const w = ctx.measureText(text).width + 8;
          let row = rowEnd.findIndex(e => xr > e + 2);     // stack labels of releases close together
          if (row < 0) continue;                           // too crowded at this zoom: line only
          rowEnd[row] = xr + 2 + w;
          const y = 4 + row * 16;
          ctx.fillStyle = ext.dark ? 'rgba(19, 23, 34, 0.85)' : 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(xr + 2, y - 1, w, 15);
          ctx.fillStyle = n.headline ? (ext.dark ? '#ce93d8' : '#8e24aa') : n.impact === 'high' ? (ext.dark ? '#ef5350' : '#c62828') : (ext.dark ? '#e0a33a' : '#a86d00');
          ctx.fillText(n.label, xr + 6, y + 1);
          if (arrow) { ctx.fillStyle = n.bias === 'up' ? '#26a69a' : '#ef5350'; ctx.fillText(arrow, xr + 6 + ctx.measureText(n.label).width, y + 1); }
        }
      }

      // Key levels for the session at the right edge of the view
      const lv = ext.levels;
      if (lv && intraday) {
        const startIdx = indexAtOrAfter(data, lv.start);
        const x0 = startIdx >= to ? null : Math.max(0, x(Math.max(startIdx, 0)) - half);
        const lines: { label: string; value: number; color: string }[] = [];
        if (ext.show.pd && lv.prev) {
          lines.push({ label: 'PDH', value: lv.prev.h, color: LEVEL_COLOR.pd });
          lines.push({ label: 'PDL', value: lv.prev.l, color: LEVEL_COLOR.pd });
          lines.push({ label: 'PDC', value: lv.prev.c, color: LEVEL_COLOR.pd });
        }
        if (ext.show.on && lv.overnight) {
          lines.push({ label: 'ONH', value: lv.overnight.h, color: LEVEL_COLOR.on });
          lines.push({ label: 'ONL', value: lv.overnight.l, color: LEVEL_COLOR.on });
        }
        if (ext.show.open) {
          if (lv.open !== null) lines.push({ label: 'Open', value: lv.open, color: LEVEL_COLOR.open });
          if (lv.nyOpen !== null) lines.push({ label: 'NY Open', value: lv.nyOpen, color: LEVEL_COLOR.open });
        }
        if (x0 !== null) {
          ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 1;
          for (const line of lines) {
            const y = Math.round(yAxis.convertToPixel(line.value)) + 0.5;
            if (y < 0 || y > height) continue;
            ctx.strokeStyle = line.color;
            ctx.setLineDash([6, 3]);
            ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(width, y); ctx.stroke();
            ctx.fillStyle = line.color;
            ctx.fillText(`${line.label} ${price(line.value)}`, width - 6, y - 2);
          }
        }
      }

      ctx.restore();
      return true;
    },
  });
}
