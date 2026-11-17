// Chart colours, modelled on TradingView's dark and light charts.
import type { DeepPartial, Styles, KLineData, NeighborData, Nullable, TooltipLegend } from 'klinecharts';

export type Theme = 'dark' | 'light';
export const UP = '#089981';
export const DOWN = '#f23645';

const PALETTE = {
  dark: { text: '#d1d4dc', dim: '#787b86', grid: 'rgba(42, 46, 57, 0.6)', axis: '#2a2e39', cross: '#9598a1', crossBg: '#363a45' },
  light: { text: '#131722', dim: '#6a6d78', grid: 'rgba(240, 243, 250, 1)', axis: '#e0e3eb', cross: '#9598a1', crossBg: '#131722' },
};
const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", "Segoe UI", Roboto, sans-serif';
const f2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function chartStyles(theme: Theme): DeepPartial<Styles> {
  const c = PALETTE[theme];
  const text = { color: c.dim, size: 11, family: FONT };
  const crossText = { show: true, color: '#ffffff', size: 11, family: FONT, backgroundColor: c.crossBg, borderColor: c.crossBg };
  const crossLine = { show: true, style: 'dashed' as const, dashedValue: [4, 3], size: 1, color: c.cross };

  // TradingView-style readout: O H L C coloured by the candle, then change vs the prior close
  const legend = (data: NeighborData<Nullable<KLineData>>): TooltipLegend[] => {
    const k = data.current;
    if (!k) return [];
    const col = k.close >= k.open ? UP : DOWN;
    const ref = data.prev?.close ?? k.open;
    const chg = k.close - ref;
    const pct = ref ? (chg / ref) * 100 : 0;
    const v = (n: number) => ({ text: f2(n), color: col });
    return [
      { title: 'O', value: v(k.open) },
      { title: 'H', value: v(k.high) },
      { title: 'L', value: v(k.low) },
      { title: 'C', value: v(k.close) },
      { title: '', value: { text: `${chg >= 0 ? '+' : ''}${f2(chg)} (${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%)`, color: chg >= 0 ? UP : DOWN } },
      { title: 'Vol', value: { text: (k.volume ?? 0).toLocaleString('en-US'), color: c.dim } },
    ];
  };

  return {
    grid: {
      show: true,
      horizontal: { show: true, color: c.grid, style: 'solid', size: 1 },
      vertical: { show: true, color: c.grid, style: 'solid', size: 1 },
    },
    candle: {
      type: 'candle_solid',
      bar: {
        compareRule: 'current_open',
        upColor: UP, downColor: DOWN, noChangeColor: c.dim,
        upBorderColor: UP, downBorderColor: DOWN, noChangeBorderColor: c.dim,
        upWickColor: UP, downWickColor: DOWN, noChangeWickColor: c.dim,
      },
      priceMark: {
        show: true,
        high: { show: false },
        low: { show: false },
        last: {
          show: true, compareRule: 'current_open', upColor: UP, downColor: DOWN, noChangeColor: c.dim,
          line: { show: true, style: 'dashed', dashedValue: [1, 3], size: 1 },
          text: { show: true, size: 11, family: FONT, color: '#ffffff' },
        },
      },
      tooltip: {
        showRule: 'always', showType: 'standard',
        title: { show: true, color: c.text, size: 13, family: FONT, weight: 600, template: '{ticker} · {period}' },
        legend: { color: c.dim, size: 12, family: FONT, template: legend },
      },
    },
    indicator: {
      lastValueMark: { show: false },
      tooltip: {
        showRule: 'always',
        title: { show: true, showName: true, showParams: true, color: c.dim, size: 12, family: FONT },
        legend: { color: c.dim, size: 12, family: FONT },
      },
    },
    xAxis: { axisLine: { show: true, color: c.axis }, tickLine: { show: true, color: c.axis }, tickText: text },
    yAxis: { axisLine: { show: true, color: c.axis }, tickLine: { show: true, color: c.axis }, tickText: text },
    separator: { size: 1, color: c.axis, activeBackgroundColor: 'rgba(41, 98, 255, 0.15)' },
    crosshair: {
      show: true,
      horizontal: { show: true, line: crossLine, text: crossText },
      vertical: { show: true, line: crossLine, text: crossText },
    },
  };
}
