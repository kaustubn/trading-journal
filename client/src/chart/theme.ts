// Chart colours. Everything visible comes from the chart settings (ChartCfg): TradingView's
// Settings dialog — candles, background, grid, crosshair, scales and the status line.
import type { DeepPartial, Styles, KLineData, NeighborData, Nullable, TooltipLegend, TooltipFeatureStyle } from 'klinecharts';
import type { ChartCfg } from './config';

export type Theme = 'dark' | 'light';
export const UP = '#089981';
export const DOWN = '#f23645';

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", "Segoe UI", Roboto, sans-serif';
const f2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Is a CSS colour light (for picking readable label text)? */
export function isLight(c: string): boolean {
  let r = 0, g = 0, b = 0;
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
  else {
    const h = c.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  }
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

// Legend buttons on every indicator, like TradingView: hide / settings / remove (14px line icons)
const ICON = { eye: 'M1 7L3 4.6L5 3.4L7 3L9 3.4L11 4.6L13 7L11 9.4L9 10.6L7 11L5 10.6L3 9.4ZM5.5 7L6 5.8L7 5.5L8 5.8L8.5 7L8 8.2L7 8.5L6 8.2Z',
  gear: 'M7 1V3M7 11V13M1 7H3M11 7H13M2.8 2.8L4.2 4.2M9.8 9.8L11.2 11.2M2.8 11.2L4.2 9.8M9.8 4.2L11.2 2.8M4.5 7L5.2 5.2L7 4.5L8.8 5.2L9.5 7L8.8 8.8L7 9.5L5.2 8.8Z',
  close: 'M3 3L11 11M11 3L3 11' };
const feature = (id: keyof typeof ICON, color: string, active: string): TooltipFeatureStyle => ({
  id, position: 'middle', type: 'path', content: { style: 'stroke', path: ICON[id], lineWidth: 1.4 } as any,
  size: 14, color, activeColor: active, backgroundColor: 'transparent', activeBackgroundColor: 'rgba(127, 127, 127, 0.25)',
  borderRadius: 3, paddingLeft: 2, paddingRight: 2, paddingTop: 2, paddingBottom: 2, marginLeft: 3, marginRight: 0, marginTop: 0, marginBottom: 0,
} as TooltipFeatureStyle);

export function chartStyles(theme: Theme, cfg: ChartCfg): DeepPartial<Styles> {
  const lightBg = isLight(cfg.bg);
  const dim = cfg.textColor;
  const crossBg = lightBg ? '#131722' : '#363a45';
  const text = { color: cfg.textColor, size: cfg.fontSize, family: FONT };
  const crossText = { show: true, color: '#ffffff', size: 11, family: FONT, backgroundColor: crossBg, borderColor: crossBg };
  const crossLine = { show: true, style: cfg.crossStyle, dashedValue: [4, 3], size: cfg.crossWidth, color: cfg.crossColor };
  const tone = (up: boolean) => (lightBg ? '#000000' : up ? cfg.upBody : cfg.downBody);
  const transparent = 'rgba(0, 0, 0, 0)';

  // TradingView-style status line: O H L C, change vs the prior close, volume
  const legend = (data: NeighborData<Nullable<KLineData>>): TooltipLegend[] => {
    const k = data.current;
    if (!k) return [];
    const ref = data.prev?.close ?? k.open;
    const col = tone(k.close >= ref);
    const chg = k.close - ref;
    const pct = ref ? (chg / ref) * 100 : 0;
    const v = (n: number) => ({ text: f2(n), color: col });
    const out: TooltipLegend[] = [];
    if (cfg.legendOHLC) out.push({ title: 'O', value: v(k.open) }, { title: 'H', value: v(k.high) }, { title: 'L', value: v(k.low) }, { title: 'C', value: v(k.close) });
    if (cfg.legendChange) out.push({ title: '', value: { text: `${chg >= 0 ? '+' : ''}${f2(chg)} (${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%)`, color: col } });
    if (cfg.legendVolume) out.push({ title: 'Vol', value: { text: (k.volume ?? 0).toLocaleString('en-US'), color: dim } });
    return out;
  };

  return {
    grid: {
      show: cfg.grid,
      horizontal: { show: true, color: cfg.gridColor, style: 'solid', size: 1 },
      vertical: { show: true, color: cfg.gridColor, style: 'solid', size: 1 },
    },
    candle: {
      type: 'candle_solid',
      bar: {
        compareRule: cfg.prevClose ? 'previous_close' : 'current_open',
        upColor: cfg.body ? cfg.upBody : transparent, downColor: cfg.body ? cfg.downBody : transparent, noChangeColor: cfg.body ? cfg.downBody : transparent,
        upBorderColor: cfg.borders ? cfg.upBorder : (cfg.body ? cfg.upBody : transparent),
        downBorderColor: cfg.borders ? cfg.downBorder : (cfg.body ? cfg.downBody : transparent),
        noChangeBorderColor: cfg.borders ? cfg.downBorder : transparent,
        upWickColor: cfg.wicks ? cfg.upWick : transparent, downWickColor: cfg.wicks ? cfg.downWick : transparent, noChangeWickColor: cfg.wicks ? cfg.downWick : transparent,
      },
      priceMark: {
        show: true,
        high: { show: false },
        low: { show: false },
        last: {
          show: cfg.priceLine, compareRule: cfg.prevClose ? 'previous_close' : 'current_open',
          upColor: lightBg ? '#00838f' : cfg.upBody, downColor: lightBg ? '#000000' : cfg.downBody, noChangeColor: cfg.textColor,
          line: { show: true, style: 'dashed', dashedValue: [1, 3], size: 1 },
          text: { show: true, size: 11, family: FONT, color: '#ffffff' },
        },
      },
      tooltip: {
        showRule: 'always', showType: 'standard',
        title: { show: true, color: lightBg ? '#000000' : '#d1d4dc', size: 13, family: FONT, weight: 600, template: '{ticker} · {period}' },
        legend: { color: dim, size: 12, family: FONT, template: legend },
      },
    },
    indicator: {
      lastValueMark: { show: false },
      tooltip: {
        showRule: 'always',
        title: { show: cfg.indTitles, showName: cfg.indTitles, showParams: cfg.indArgs, color: dim, size: 12, family: FONT },
        legend: cfg.indValues ? { color: dim, size: 12, family: FONT } : { color: transparent, size: 1, family: FONT },
        features: [feature('eye', dim, lightBg ? '#000000' : '#ffffff'), feature('gear', dim, lightBg ? '#000000' : '#ffffff'), feature('close', dim, '#f23645')],
      },
    },
    xAxis: { axisLine: { show: true, color: cfg.axisColor }, tickLine: { show: true, color: cfg.axisColor }, tickText: text },
    yAxis: { axisLine: { show: true, color: cfg.axisColor }, tickLine: { show: true, color: cfg.axisColor }, tickText: text },
    separator: { size: 1, color: cfg.axisColor, activeBackgroundColor: 'rgba(41, 98, 255, 0.15)' },
    crosshair: {
      show: true,
      horizontal: { show: true, line: crossLine, text: crossText },
      vertical: { show: true, line: crossLine, text: crossText },
    },
    // Drawing handles and the axis labels of a selected drawing, TradingView-style
    overlay: {
      point: {
        color: theme === 'dark' ? '#131722' : '#ffffff', borderColor: '#2962ff', borderSize: 1.5, radius: 4.5,
        activeColor: theme === 'dark' ? '#131722' : '#ffffff', activeBorderColor: '#2962ff', activeBorderSize: 2, activeRadius: 5.5,
      },
      line: { color: '#2962ff', size: 1 },
      rect: { style: 'fill', color: 'rgba(41, 98, 255, 0.12)', borderColor: '#2962ff', borderSize: 1 },
      text: {
        color: '#ffffff', size: 11, family: FONT, weight: 'normal',
        backgroundColor: '#2962ff', borderColor: '#2962ff', borderRadius: 2,
        paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
      },
    },
  };
}
