// Custom indicators for the market chart, registered once with KLineChart.
//   JC_SMA   simple moving average(s)      (the library's own "SMA" is a different, smoothed average)
//   JC_ATR   average true range (Wilder)
//   JC_VWAP  volume-weighted average price, reset at the 6pm ET session open
//   JC_BG    not an indicator: draws session shading, key levels, round numbers and
//            contract-roll markers behind the candles
import { registerIndicator, KLineData } from 'klinecharts';
import { registerNqSys } from './nqsys';
import { sessionDay, sessionOf, SessionName } from './time';

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
  breaks?: boolean;    // TradingView-style session breaks (dashed line at each 6pm ET open) instead of shading
  rolls: { contract: string; from: number }[] | null; // null = hidden
  levels: LevelsData | null;
  show: { pd: boolean; on: boolean; open: boolean; round: boolean };
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

const price = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let registered = false;
export function registerChartIndicators() {
  if (registered) return;
  registered = true;
  registerNqSys();

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
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        for (let i = Math.max(1, from); i < to; i++) {
          if (data[i].timestamp - data[i - 1].timestamp <= 30 * 60000 + ext.tfMin * 60000) continue;
          const xb = Math.round(x(i) - half) + 0.5;
          ctx.beginPath(); ctx.moveTo(xb, 0); ctx.lineTo(xb, height); ctx.stroke();
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
