// Shared definitions for the market chart workspace and its chart windows.
import type { Chart, KLineData, Period } from 'klinecharts';
import type { Clock } from './time';
import type { Theme } from './theme';
import type { DrawView, Magnet } from './drawingController';
import { CoachRules, DEFAULT_RULES, mergeRules } from './coach';

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
export type IndKey = 'EMA' | 'SMA' | 'VWAP' | 'BOLL' | 'VOL' | 'RSI' | 'ATR' | 'MACD';
export interface IndDef { label: string; name: string; main: boolean; def: number[]; hint: string; min: number; max: number; }
export const INDS: Record<IndKey, IndDef> = {
  EMA: { label: 'EMA', name: 'EMA', main: true, def: [9, 21], hint: 'Periods, e.g. 9, 21, 50', min: 1, max: 6 },
  SMA: { label: 'SMA', name: 'JC_SMA', main: true, def: [50, 200], hint: 'Periods, e.g. 50, 200', min: 1, max: 6 },
  VWAP: { label: 'VWAP', name: 'JC_VWAP', main: true, def: [], hint: 'Resets at the 6pm ET session open', min: 0, max: 0 },
  BOLL: { label: 'Bollinger Bands', name: 'BOLL', main: true, def: [20, 2], hint: 'Period, deviations', min: 2, max: 2 },
  VOL: { label: 'Volume', name: 'VOL', main: false, def: [20], hint: 'Average period', min: 1, max: 1 },
  RSI: { label: 'RSI', name: 'RSI', main: false, def: [14], hint: 'Period', min: 1, max: 1 },
  ATR: { label: 'ATR', name: 'JC_ATR', main: false, def: [14], hint: 'Period', min: 1, max: 1 },
  MACD: { label: 'MACD', name: 'MACD', main: false, def: [12, 26, 9], hint: 'Fast, slow, signal', min: 3, max: 3 },
};
export const IND_KEYS = Object.keys(INDS) as IndKey[];

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
    const spec = { name: def.name, paneId, calcParams: cfg.params, extendData: { tfMin: tf } };
    if (cfg.on && !exists) chart.createIndicator(spec, def.main);
    else if (cfg.on) chart.overrideIndicator(spec);
    else if (exists) chart.removeIndicator({ name: def.name });
  }
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
  indicators: Record<IndKey, { on: boolean; params: number[] }>;
  magnet: Magnet; drawHidden: boolean; drawLocked: boolean;
  notesOpen: boolean;
  layout: LayoutMode;
  panes: PaneCfg[];        // always 4; the layout decides how many are shown
  active: number;          // window that the top bar, keys and replay steps act on
  syncCrosshair: boolean;
  live: boolean;           // poll for new bars every minute
  customTfs: number[];     // extra timeframe buttons the trader added (minutes)
  coach: CoachRules;       // practice rules the coach holds you to
}
const DEFAULT_PANES: PaneCfg[] = [{ tf: 5, src: 'journal' }, { tf: 1, src: 'journal' }, { tf: 15, src: 'journal' }, { tf: 60, src: 'journal' }];
export const DEFAULTS: Settings = {
  clock: 'ET', theme: 'dark',
  sessions: true, rth: false, log: false, rolls: true,
  magnet: 'off', drawHidden: false, drawLocked: false, notesOpen: false,
  levels: { pd: true, on: true, open: true, round: false },
  indicators: IND_KEYS.reduce((acc, k) => {
    acc[k] = { on: k === 'VOL', params: INDS[k].def };
    return acc;
  }, {} as Settings['indicators']),
  layout: '1', panes: DEFAULT_PANES, active: 0, syncCrosshair: true, live: true,
  customTfs: [],
  coach: DEFAULT_RULES,
};
export const layoutCount = (m: LayoutMode) => LAYOUTS.find(l => l.mode === m)?.count ?? 1;

/** Saved settings may be partial, old or hand-edited: keep only what is valid. */
export function mergeSettings(saved: any): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULTS));
  if (!saved || typeof saved !== 'object') return s;
  if (saved.clock === 'ET' || saved.clock === 'BC') s.clock = saved.clock;
  if (saved.theme === 'dark' || saved.theme === 'light') s.theme = saved.theme;
  for (const k of ['sessions', 'rth', 'log', 'rolls', 'drawHidden', 'drawLocked', 'notesOpen', 'syncCrosshair', 'live'] as const) {
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
    const params = Array.isArray(i.params) ? parseParams(k, i.params.join(',')) : null;
    if (params) s.indicators[k].params = params;
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
  if (Array.isArray(saved.customTfs)) {
    s.customTfs = [...new Set<number>(saved.customTfs.filter(validTf))].filter(m => !TFS.some(t => t.m === m)).sort((a, b) => a - b).slice(0, 10);
  }
  return s;
}

export const viewOf = (s: Settings, tf: number): DrawView =>
  ({ tf, rth: s.rth, magnet: s.magnet, hidden: s.drawHidden, lockAll: s.drawLocked });

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
