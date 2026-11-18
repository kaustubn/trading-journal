// Shared definitions for the market chart workspace and its chart windows.
import { ChartAlert, cleanAlerts } from './alerts';
import type { Chart, KLineData, Period } from 'klinecharts';
import type { Clock } from './time';
import type { Theme } from './theme';
import type { DrawView, Magnet } from './drawingController';
import { CoachRules, DEFAULT_RULES, mergeRules } from './coach';
import { TOOLS } from './drawings';
import type { Tool } from './drawings';
import { TEMPLATES } from './templates';
import { NQ_STYLE_TV, NqStyle } from './nqsys';

export const PANE = 'candle_pane';

// ---------- timeframes ----------
export const TFS = [
  { m: 1, label: '1m' }, { m: 3, label: '3m' }, { m: 5, label: '5m' }, { m: 15, label: '15m' },
  { m: 30, label: '30m' }, { m: 60, label: '1h' }, { m: 240, label: '4h' }, { m: 1440, label: 'D' },
];
/** Any whole number of minutes below a day (2, 7, 45, 90, 120…), or the daily chart. */
export const validTf = (m: unknown): m is number =>
  typeof m === 'number' && Number.isInteger(m) && ((m >= 1 && m < 1440) || m === 1440);
export const tfLabel = (m: number) => (m === 1440 ? 'D' : m % 60 === 0 ? `${m / 60}h` : `${m}m`);
export function periodOf(m: number): Period {
  if (m >= 1440) return { type: 'day', span: 1 };
  if (m % 60 === 0) return { type: 'hour', span: m / 60 };
  return { type: 'minute', span: m };
}
/** "45" / "45m" -> 45, "2h" / "1.5h" -> 120 / 90, "D" / "1D" -> 1440. Null when it is not a valid timeframe. */
export function parseTfInput(text: string): number | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  let m: number | null = null;
  if (/^\d+$/.test(t)) m = Number(t);
  else if (/^\d+M(IN)?$/.test(t)) m = parseInt(t, 10);
  else if (/^\d+(\.\d+)?H$/.test(t)) m = Math.round(parseFloat(t) * 60 * 1000) / 1000;
  else if (/^1?D$/.test(t)) m = 1440;
  return validTf(m) ? m : null;
}
/** Last minute of the candle that starts at `key` (daily: 5pm ET close, 4pm for RTH). */
export function barEnd(key: number, tf: number, rth: boolean): number {
  const MIN = 60000;
  if (tf >= 1440) return key + (rth ? 4 : 5) * 3600000 - MIN;
  return key + tf * MIN - MIN;
}

// ---------- indicators ----------
export type IndKey = 'NQSYS' | 'PHASES' | 'EMA' | 'SMA' | 'VWAP' | 'SVP' | 'VRVP' | 'BOLL' | 'VOL' | 'RSI' | 'ATR' | 'MACD';
export interface IndDef { label: string; name: string; main: boolean; def: number[]; hint: string; min: number; max: number; }
export const INDS: Record<IndKey, IndDef> = {
  PHASES: { label: 'Smart money phases & patterns', name: 'JC_PHASES', main: true, def: [], hint: 'Accumulation / markup / distribution / markdown, springs, upthrusts, sweeps, breaks of structure, key candles', min: 0, max: 0 },
  NQSYS: { label: 'NQ System v3 (S1/S2/S3/ORB)', name: 'JC_NQSYS', main: true, def: [], hint: 'Your TradingView NQ-SYS v3: day type, EMA21, VWAP, VAH/VAL, IB, PDH/PDL, signals, scorecard. Made for the 5-min chart.', min: 0, max: 0 },
  EMA: { label: 'EMA', name: 'EMA', main: true, def: [9, 21], hint: 'Periods, e.g. 9, 21, 50', min: 1, max: 6 },
  SMA: { label: 'SMA', name: 'JC_SMA', main: true, def: [50, 200], hint: 'Periods, e.g. 50, 200', min: 1, max: 6 },
  VWAP: { label: 'VWAP', name: 'JC_VWAP', main: true, def: [], hint: 'Resets at the 6pm ET session open', min: 0, max: 0 },
  SVP: { label: 'Volume profile: session', name: 'JC_SVP', main: true, def: [24], hint: 'Rows per day. Real POC / VAH / VAL for each 6pm ET trading day. Lower timeframes give a finer profile.', min: 1, max: 1 },
  VRVP: { label: 'Volume profile: visible range', name: 'JC_VRVP', main: true, def: [40], hint: 'Rows. Profile of the candles on screen, updates as you scroll.', min: 1, max: 1 },
  BOLL: { label: 'Bollinger Bands', name: 'BOLL', main: true, def: [20, 2], hint: 'Period, deviations', min: 2, max: 2 },
  VOL: { label: 'Volume', name: 'VOL', main: false, def: [], hint: 'Moving average period (empty = no average, like your TradingView)', min: 0, max: 1 },
  RSI: { label: 'RSI', name: 'RSI', main: false, def: [14], hint: 'Period', min: 1, max: 1 },
  ATR: { label: 'ATR', name: 'JC_ATR', main: false, def: [14], hint: 'Period', min: 1, max: 1 },
  MACD: { label: 'MACD', name: 'MACD', main: false, def: [12, 26, 9], hint: 'Fast, slow, signal', min: 3, max: 3 },
};
export const IND_KEYS = Object.keys(INDS) as IndKey[];

/** One indicator's settings: on/off, inputs, hidden (eye), line colours, volume colours, NQ-SYS parts. */
export interface IndCfg {
  on: boolean; params: number[];
  hidden?: boolean;
  lines?: { color: string; size: number }[];
  bars?: { up: string; down: string };
  nq?: Partial<NqStyle>;
}
/** Line colours TradingView uses for each indicator's lines. */
export const LINE_COLORS: Partial<Record<IndKey, string[]>> = {
  EMA: ['#2962FF', '#FF9800', '#E91E63', '#00BCD4', '#9C27B0', '#4CAF50'],
  SMA: ['#FF6D00', '#2962FF', '#E91E63', '#00BCD4', '#9C27B0', '#4CAF50'],
  BOLL: ['#FF6D00', '#2962FF', '#2962FF'],
  VWAP: ['#2962FF'], RSI: ['#7E57C2'], ATR: ['#B71C1C'], MACD: ['#2962FF', '#FF6D00'],
  VOL: ['#FFEB3B'],
};
/** Names of the lines, for the settings dialog. */
export function lineNames(k: IndKey, params: number[]): string[] {
  if (k === 'EMA' || k === 'SMA') return params.map(n => `${k} ${n}`);
  if (k === 'BOLL') return ['Basis', 'Upper', 'Lower'];
  if (k === 'MACD') return ['MACD', 'Signal'];
  if (k === 'VOL') return params.map(n => `Volume MA ${n}`);
  if (k === 'RSI' || k === 'ATR' || k === 'VWAP') return [k];
  return [];
}
/** Kay's TradingView volume colours (read 2026-11-17): white 65% up, black 75% down. */
export const VOL_BARS_TV = { up: 'rgba(255, 255, 255, 0.6542)', down: 'rgba(0, 0, 0, 0.7497)' };
export const VOL_BARS_STD = { up: 'rgba(8, 153, 129, 0.5)', down: 'rgba(242, 54, 69, 0.5)' };

// ---------- chart settings (TradingView's Settings dialog) ----------
export type ChartType = 'candles' | 'hollow' | 'bars' | 'heikin' | 'line' | 'area';
export const CHART_TYPES: [ChartType, string][] = [
  ['candles', 'Candles'], ['hollow', 'Hollow candles'], ['bars', 'Bars (OHLC)'], ['heikin', 'Heikin Ashi'], ['line', 'Line'], ['area', 'Area'],
];
export interface ChartCfg {
  ctype: ChartType;
  upBody: string; downBody: string; upBorder: string; downBorder: string; upWick: string; downWick: string;
  body: boolean; borders: boolean; wicks: boolean; prevClose: boolean;
  bg: string; grid: boolean; gridColor: string;
  crossColor: string; crossWidth: number; crossStyle: 'solid' | 'dashed';
  textColor: string; axisColor: string; fontSize: number;
  priceLine: boolean; countdown: boolean; breaks: boolean; breaksColor: string;
  legendOHLC: boolean; legendChange: boolean; legendVolume: boolean;
  indTitles: boolean; indArgs: boolean; indValues: boolean;
}
/** Kay's TradingView chart (read 2026-11-17). */
export const CHART_TV: ChartCfg = {
  ctype: 'candles',
  upBody: 'rgba(0, 188, 212, 1)', downBody: 'rgba(0, 0, 0, 1)', upBorder: 'rgba(0, 0, 0, 1)', downBorder: 'rgba(0, 0, 0, 1)',
  upWick: 'rgba(0, 0, 0, 1)', downWick: 'rgba(0, 0, 0, 1)', body: true, borders: true, wicks: true, prevClose: true,
  bg: '#9c9c9c', grid: false, gridColor: 'rgba(0, 0, 0, 0.08)',
  crossColor: 'rgba(255, 255, 255, 1)', crossWidth: 2, crossStyle: 'solid',
  textColor: 'rgba(0, 0, 0, 1)', axisColor: 'rgba(0, 0, 0, 1)', fontSize: 12,
  priceLine: true, countdown: true, breaks: true, breaksColor: 'rgba(0, 0, 0, 0.22)',
  legendOHLC: true, legendChange: true, legendVolume: true,
  indTitles: true, indArgs: false, indValues: false,
};
/** TradingView's standard dark chart. */
export const CHART_STD: ChartCfg = {
  ctype: 'candles',
  upBody: '#089981', downBody: '#f23645', upBorder: '#089981', downBorder: '#f23645', upWick: '#089981', downWick: '#f23645',
  body: true, borders: true, wicks: true, prevClose: false,
  bg: '#131722', grid: true, gridColor: 'rgba(42, 46, 57, 0.6)',
  crossColor: '#9598a1', crossWidth: 1, crossStyle: 'dashed',
  textColor: '#787b86', axisColor: '#2a2e39', fontSize: 11,
  priceLine: true, countdown: true, breaks: false, breaksColor: 'rgba(255, 255, 255, 0.12)',
  legendOHLC: true, legendChange: true, legendVolume: true,
  indTitles: true, indArgs: true, indValues: true,
};
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\))$/;
export const validColor = (c: unknown): c is string => typeof c === 'string' && c.length <= 40 && COLOR_RE.test(c.trim());
function mergeChart(saved: any, base: ChartCfg): ChartCfg {
  const c: ChartCfg = { ...base };
  if (!saved || typeof saved !== 'object') return c;
  for (const k of Object.keys(base) as (keyof ChartCfg)[]) {
    const v = saved[k], d = base[k];
    if (k === 'ctype') { if (CHART_TYPES.some(([t]) => t === v)) c.ctype = v; continue; }
    if (typeof d === 'boolean' && typeof v === 'boolean') (c as any)[k] = v;
    else if (typeof d === 'number' && typeof v === 'number' && v >= 1 && v <= 20) (c as any)[k] = v;
    else if (k === 'crossStyle' && (v === 'solid' || v === 'dashed')) c.crossStyle = v;
    else if (typeof d === 'string' && k !== 'crossStyle' && validColor(v)) (c as any)[k] = v;
  }
  return c;
}

// ---------- saved layouts ----------
/** What a saved layout restores: windows, timeframes, look, chart settings, indicators, tools, levels. */
export type LayoutSnapshot = Pick<Settings, 'layout' | 'panes' | 'look' | 'theme' | 'chart' | 'indicators' | 'toolTpl' | 'levels' | 'sessions' | 'rth'>;
export const SNAPSHOT_KEYS = ['layout', 'panes', 'look', 'theme', 'chart', 'indicators', 'toolTpl', 'levels', 'sessions', 'rth'] as const;
export const snapshotOf = (s: Settings): LayoutSnapshot => JSON.parse(JSON.stringify(Object.fromEntries(SNAPSHOT_KEYS.map(k => [k, s[k]])))) as LayoutSnapshot;

/** "9, 21" -> [9, 21]; null when the count or the values are not valid for that indicator. */
export function parseParams(key: IndKey, text: string): number[] | null {
  const def = INDS[key];
  const parts = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.length < def.min || parts.length > def.max) return null;
  for (let i = 0; i < parts.length; i++) {
    const wholeNumber = !(key === 'BOLL' && i === 1); // Bollinger deviations may be 2.5
    if (!Number.isFinite(parts[i]) || parts[i] <= 0 || parts[i] > 1000) return null;
    if (wholeNumber && !Number.isInteger(parts[i])) return null;
  }
  return parts;
}

export function syncIndicators(chart: Chart, s: Settings, tf: number) {
  for (const key of IND_KEYS) {
    const def = INDS[key], cfg = s.indicators[key];
    const paneId = def.main ? PANE : `jc_${key}`;
    const exists = chart.getIndicators({ name: def.name }).length > 0;
    const styles: Record<string, unknown> = {};
    const cols = LINE_COLORS[key];
    if (cols) styles.lines = lineNames(key, cfg.params).map((_, i) => ({ color: cfg.lines?.[i]?.color ?? cols[i % cols.length], size: cfg.lines?.[i]?.size ?? 1 }));
    if (key === 'VOL') {
      const b = cfg.bars ?? (s.look === 'tv' ? VOL_BARS_TV : VOL_BARS_STD);
      styles.bars = [{ upColor: b.up, downColor: b.down, noChangeColor: b.up, style: 'fill' }];
    }
    const spec = { name: def.name, paneId, calcParams: cfg.params, visible: !cfg.hidden, styles, extendData: { tfMin: tf, style: cfg.nq } };
    if (cfg.on && !exists) chart.createIndicator(spec, def.main);
    else if (cfg.on) chart.overrideIndicator(spec);
    else if (exists) chart.removeIndicator({ name: def.name });
  }
  // Heikin Ashi: drawn by an indicator over the (hidden) real candles
  const ha = chart.getIndicators({ name: 'JC_HA' }).length > 0;
  const haSpec = { name: 'JC_HA', paneId: PANE, extendData: { up: s.chart.upBody, down: s.chart.downBody, wickUp: s.chart.upWick, wickDown: s.chart.downWick, borderUp: s.chart.upBorder, borderDown: s.chart.downBorder } };
  if (s.chart.ctype === 'heikin' && !ha) chart.createIndicator(haSpec, true);
  else if (s.chart.ctype === 'heikin') chart.overrideIndicator(haSpec);
  else if (ha) chart.removeIndicator({ name: 'JC_HA' });
}

// ---------- layout ----------
export type LayoutMode = '1' | '2v' | '2h' | '3' | '4';
export const LAYOUTS: { mode: LayoutMode; count: number; label: string }[] = [
  { mode: '1', count: 1, label: 'One chart' },
  { mode: '2v', count: 2, label: 'Two side by side' },
  { mode: '2h', count: 2, label: 'Two stacked' },
  { mode: '3', count: 3, label: 'One large + two' },
  { mode: '4', count: 4, label: 'Four (2 × 2)' },
];
export type PaneSource = 'journal' | 'tv';
export interface PaneCfg { tf: number; src: PaneSource; }

// ---------- settings (saved per user) ----------
export interface Settings {
  clock: Clock; theme: Theme;
  sessions: boolean; rth: boolean; log: boolean; rolls: boolean;
  levels: { pd: boolean; on: boolean; open: boolean; round: boolean };
  indicators: Record<IndKey, IndCfg>;
  chart: ChartCfg;                 // candles, background, grid, crosshair, scales, status line
  saved: { name: string; data: LayoutSnapshot }[];  // the trader's own layouts
  magnet: Magnet; drawHidden: boolean; drawLocked: boolean;
  stayDrawing: boolean;    // a drawing tool stays on after each drawing until right-click / Esc
  favTools: Tool[];        // favourites toolbar (Kay's TradingView favourites)
  favBar: boolean;         // favourites toolbar shown
  drawBar: boolean;        // left drawing toolbar shown
  notesOpen: boolean;
  layout: LayoutMode;
  panes: PaneCfg[];        // always 4; the layout decides how many are shown
  active: number;          // window that the top bar, keys and replay steps act on
  syncCrosshair: boolean;
  syncTime: boolean;       // scrolling one window moves the others to the same time
  live: boolean;           // poll for new bars every minute
  customTfs: number[];     // extra timeframe buttons the trader added (minutes)
  alerts: ChartAlert[];    // price / drawing alerts
  look: Look;              // chart colours: 'tv' = the trader's TradingView chart, 'journal' = TradingView default
  toolTpl: Partial<Record<Tool, string>>; // template new drawings of each tool start from
  coach: CoachRules;       // practice rules the coach holds you to
}
export type Look = 'tv' | 'journal';
/** Kay's TradingView favourite drawing tools, in his order (read 2026-11-17). */
export const TV_FAV_TOOLS: Tool[] = ['hline', 'hray', 'rect', 'trend', 'vprofile', 'fib', 'vline', 'brush', 'dprange', 'path', 'channel', 'long', 'short', 'gann', 'highlight', 'daterange'];
/** Default template per tool in the TV preset: the styles used most on the TradingView chart. */
export const TV_TOOL_TPL: Partial<Record<Tool, string>> = {
  hline: '1w & 1 d', rect: 'zone purple', trend: 'white', fib: 'k1', vline: 'bl', channel: 'channel', long: 'k1', short: 'k1',
  gann: 'k', path: 'path',
};
const DEFAULT_PANES: PaneCfg[] = [{ tf: 5, src: 'journal' }, { tf: 1, src: 'journal' }, { tf: 15, src: 'journal' }, { tf: 60, src: 'journal' }];
export const DEFAULTS: Settings = {
  clock: 'ET', theme: 'dark',
  sessions: true, rth: false, log: false, rolls: true,
  magnet: 'off', drawHidden: false, drawLocked: false, notesOpen: false, stayDrawing: true,
  favTools: [...TV_FAV_TOOLS], favBar: true, drawBar: true,
  levels: { pd: true, on: true, open: true, round: false },
  indicators: IND_KEYS.reduce((acc, k) => {
    acc[k] = { on: k === 'VOL' || k === 'NQSYS', params: INDS[k].def, ...(k === 'VOL' ? { bars: { ...VOL_BARS_TV } } : {}), ...(k === 'NQSYS' ? { nq: { ...NQ_STYLE_TV } } : {}) };
    return acc;
  }, {} as Settings['indicators']),
  layout: '1', panes: DEFAULT_PANES, active: 0, syncCrosshair: true, syncTime: true, live: true,
  customTfs: [],
  alerts: [],
  look: 'tv',
  chart: { ...CHART_TV },
  saved: [],
  toolTpl: { ...TV_TOOL_TPL },
  coach: DEFAULT_RULES,
};
export const layoutCount = (m: LayoutMode) => LAYOUTS.find(l => l.mode === m)?.count ?? 1;

/** Saved settings may be partial, old or hand-edited: keep only what is valid. */
export function mergeSettings(saved: any): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULTS));
  if (!saved || typeof saved !== 'object') return s;
  if (saved.clock === 'ET' || saved.clock === 'BC') s.clock = saved.clock;
  if (saved.theme === 'dark' || saved.theme === 'light') s.theme = saved.theme;
  if (Array.isArray(saved.favTools)) s.favTools = [...new Set<Tool>(saved.favTools.filter((t: any) => typeof t === 'string' && t in TOOLS))].slice(0, 24);
  for (const k of ['sessions', 'rth', 'log', 'rolls', 'drawHidden', 'drawLocked', 'notesOpen', 'syncCrosshair', 'live', 'stayDrawing', 'favBar', 'drawBar', 'syncTime'] as const) {
    if (typeof saved[k] === 'boolean') s[k] = saved[k];
  }
  if (saved.magnet === 'off' || saved.magnet === 'weak' || saved.magnet === 'strong') s.magnet = saved.magnet;
  for (const k of ['pd', 'on', 'open', 'round'] as const) {
    if (typeof saved.levels?.[k] === 'boolean') s.levels[k] = saved.levels[k];
  }
  for (const k of IND_KEYS) {
    const i = saved.indicators?.[k];
    if (!i) continue;
    if (typeof i.on === 'boolean') s.indicators[k].on = i.on;
    const params = Array.isArray(i.params) ? (i.params.length === 0 && INDS[k].min === 0 ? [] : parseParams(k, i.params.join(','))) : null;
    if (params) s.indicators[k].params = params;
    if (typeof i.hidden === 'boolean') s.indicators[k].hidden = i.hidden;
    if (Array.isArray(i.lines)) s.indicators[k].lines = i.lines.slice(0, 8).filter((l: any) => validColor(l?.color) && l.size >= 1 && l.size <= 4).map((l: any) => ({ color: l.color, size: l.size }));
    if (i.bars && validColor(i.bars.up) && validColor(i.bars.down)) s.indicators[k].bars = { up: i.bars.up, down: i.bars.down };
    if (k === 'NQSYS' && i.nq && typeof i.nq === 'object') {
      const nq: Partial<NqStyle> = { ...NQ_STYLE_TV };
      for (const ln of ['ema', 'vwap', 'va', 'ib', 'pdh', 'pdl'] as const) {
        const v = i.nq[ln];
        if (v && validColor(v.color) && v.width >= 1 && v.width <= 4) nq[ln] = { color: v.color, width: v.width, show: v.show !== false };
      }
      for (const f of ['signals', 'plan', 'card', 'note'] as const) if (typeof i.nq[f] === 'boolean') nq[f] = i.nq[f];
      s.indicators[k].nq = nq;
    }
  }
  s.chart = mergeChart(saved.chart, s.look === 'journal' && !saved.chart ? CHART_STD : CHART_TV);
  if (Array.isArray(saved.saved)) {
    s.saved = saved.saved
      .filter((l: any) => l && typeof l.name === 'string' && l.name.trim() && l.data && typeof l.data === 'object')
      .slice(0, 20)
      .map((l: any) => ({ name: l.name.trim().slice(0, 40), data: l.data }));
  }
  if (LAYOUTS.some(l => l.mode === saved.layout)) s.layout = saved.layout;
  if (Array.isArray(saved.panes)) {
    saved.panes.slice(0, 4).forEach((p: any, i: number) => {
      if (validTf(p?.tf)) s.panes[i].tf = p.tf;
      if (p?.src === 'journal' || p?.src === 'tv') s.panes[i].src = p.src;
    });
  } else if (validTf(saved.tf)) {
    s.panes[0].tf = saved.tf; // settings saved before multi-chart had a single `tf`
  }
  if (Number.isInteger(saved.active) && saved.active >= 0 && saved.active < 4) s.active = saved.active;
  if (s.active >= layoutCount(s.layout)) s.active = 0;
  s.coach = mergeRules(saved.coach);
  if (saved.look === 'tv' || saved.look === 'journal') s.look = saved.look;
  if (saved.toolTpl && typeof saved.toolTpl === 'object') {
    const t: Partial<Record<Tool, string>> = {};
    for (const [k, v] of Object.entries(saved.toolTpl)) {
      if (typeof v === 'string' && TEMPLATES[k as Tool]?.some(x => x.name === v)) t[k as Tool] = v;
    }
    s.toolTpl = t;
  }
  s.alerts = cleanAlerts(saved.alerts);
  if (Array.isArray(saved.customTfs)) {
    s.customTfs = [...new Set<number>(saved.customTfs.filter(validTf))].filter(m => !TFS.some(t => t.m === m)).sort((a, b) => a - b).slice(0, 10);
  }
  return s;
}

export const viewOf = (s: Settings, tf: number): DrawView =>
  ({ tf, rth: s.rth, magnet: s.magnet, hidden: s.drawHidden, lockAll: s.drawLocked, tpl: s.toolTpl });

/** The "TV" preset: chart colours, indicators and tool templates from the trader's TradingView. */
export function applyTvPreset(cur: Settings): Settings {
  const indicators = { ...cur.indicators };
  for (const k of IND_KEYS) indicators[k] = { ...indicators[k], on: k === 'VOL' || k === 'NQSYS' };
  indicators.VOL = { ...indicators.VOL, params: [], bars: { ...VOL_BARS_TV }, lines: undefined };
  indicators.NQSYS = { ...indicators.NQSYS, nq: { ...NQ_STYLE_TV } };
  return { ...cur, look: 'tv', theme: 'dark', sessions: true, indicators, chart: { ...CHART_TV }, toolTpl: { ...TV_TOOL_TPL } };
}
/** TradingView's standard dark chart. */
export function applyStdPreset(cur: Settings): Settings {
  const indicators = { ...cur.indicators };
  for (const k of IND_KEYS) indicators[k] = { ...indicators[k], on: k === 'VOL' };
  indicators.VOL = { ...indicators.VOL, params: [20], bars: { ...VOL_BARS_STD }, lines: undefined };
  return { ...cur, look: 'journal', indicators, chart: { ...CHART_STD }, toolTpl: {} };
}
/** Apply a saved layout's snapshot on top of the current settings. */
export function applySnapshot(cur: Settings, data: Partial<LayoutSnapshot>): Settings {
  return mergeSettings({ ...cur, ...data, saved: cur.saved });
}

// ---------- data ----------
export interface BarsResp { bars: [number, number, number, number, number, number][]; older: boolean; newer: boolean; }
export interface Meta { first: number | null; last: number | null; count: number; rolls: { contract: string; from: number }[]; }
export const toK = (b: BarsResp['bars'][number]): KLineData =>
  ({ timestamp: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });

export interface FocusTrade {
  id: number; symbol: string; quantity: number | null; entry_price: number | null; exit_price: number | null;
  stop_loss: number | null; target: number | null; pnl: number | null; account_name: string;
  entry: number; exit: number | null; side: 'long' | 'short' | null; chartable: boolean;
}
