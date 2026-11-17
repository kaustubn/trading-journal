// Drawing model for the market chart.
// A drawing is stored with real times (UTC ms) and prices, independent of the
// timeframe it was drawn on. To show it on the chart, each time is snapped to the
// start of the bar that contains it on the current timeframe (see barTime), so the
// same drawing lines up on 1m, 1h or daily.
import { etOffset } from './time';

export type Tool =
  | 'trend' | 'hline' | 'hray' | 'vline' | 'rect' | 'fib'
  | 'channel' | 'text' | 'arrow' | 'long' | 'short';
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type Contract = 'NQ' | 'MNQ';

export interface DPoint { t: number; p: number; }
export interface Drawing {
  id: string;
  tool: Tool;
  points: DPoint[];
  color: string;
  width: number;
  line: LineStyle;
  locked?: boolean;
  text?: string;          // text tool
  qty?: number;           // long / short position
  contract?: Contract;    // long / short position
}

export interface ToolDef {
  label: string;
  overlay: string;        // registered overlay name
  steps: number;          // KLineChart totalStep (clicks + 1)
  key?: string;           // keyboard shortcut label
  color: string;
  width: number;
}
export const TOOLS: Record<Tool, ToolDef> = {
  trend: { label: 'Trend line', overlay: 'jc_trend', steps: 3, key: 'Alt+T', color: '#2962ff', width: 2 },
  hline: { label: 'Horizontal line', overlay: 'jc_hline', steps: 2, key: 'Alt+H', color: '#2962ff', width: 1 },
  hray: { label: 'Horizontal ray', overlay: 'jc_hray', steps: 2, key: 'Alt+J', color: '#2962ff', width: 1 },
  vline: { label: 'Vertical line', overlay: 'jc_vline', steps: 2, key: 'Alt+V', color: '#2962ff', width: 1 },
  rect: { label: 'Rectangle', overlay: 'jc_rect', steps: 3, key: 'Alt+Shift+R', color: '#9c27b0', width: 1 },
  fib: { label: 'Fib retracement', overlay: 'jc_fib', steps: 3, key: 'Alt+F', color: '#787b86', width: 1 },
  channel: { label: 'Parallel channel', overlay: 'jc_channel', steps: 4, color: '#2962ff', width: 2 },
  text: { label: 'Text', overlay: 'jc_text', steps: 2, color: '#2962ff', width: 1 },
  arrow: { label: 'Arrow', overlay: 'jc_arrow', steps: 3, color: '#2962ff', width: 2 },
  long: { label: 'Long position', overlay: 'jc_long', steps: 2, color: '#089981', width: 1 },
  short: { label: 'Short position', overlay: 'jc_short', steps: 2, color: '#f23645', width: 1 },
};
export const TOOL_KEYS = Object.keys(TOOLS) as Tool[];
export const OVERLAY_TO_TOOL: Record<string, Tool> =
  Object.fromEntries(TOOL_KEYS.map(k => [TOOLS[k].overlay, k]));

export const COLORS = ['#2962ff', '#089981', '#f23645', '#ff9800', '#9c27b0', '#00bcd4', '#787b86', '#ffffff', '#131722'];

// ---------- NQ contract maths ----------
export const TICK = 0.25;
export const POINT_VALUE: Record<Contract, number> = { NQ: 20, MNQ: 2 };

export const fmtPrice = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtUsd = (v: number) =>
  `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signed = (v: number, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

/** 1d 4h 35m — calendar time between two points. */
export function fmtSpan(ms: number): string {
  let m = Math.round(Math.abs(ms) / 60000);
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}

// ---------- timeframe snapping ----------
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const floorTo = (t: number, step: number, origin = 0) => Math.floor((t - origin) / step) * step + origin;

/**
 * Start time of the bar containing `t`, matching how the server builds bars:
 * minutes/hours on the UTC clock (RTH hours start at :30), 4h anchored at 6pm ET
 * (9:30am ET for RTH), daily stamped at noon ET of the session date.
 */
export function barTime(t: number, tf: number, rth: boolean): number {
  if (tf < 60 && 60 % tf === 0) return floorTo(t, tf * MIN);
  if (tf === 60) return rth ? floorTo(t, HOUR, 30 * MIN) : floorTo(t, HOUR);
  const off = etOffset(t);
  const local = t + off;
  if (tf < 1440) {
    // Other intraday timeframes (7m, 45m, 2h, 4h…) count from the session open each
    // day — 6pm ET, or 9:30am ET for RTH — like TradingView.
    const origin = rth ? Math.floor(local / DAY) * DAY + 9.5 * HOUR : Math.floor((local + 6 * HOUR) / DAY) * DAY - 6 * HOUR;
    return floorTo(local, tf * MIN, origin) - off;
  }
  // Daily: full session runs 6pm -> 5pm ET and is dated by the day it ends on
  const day = Math.floor((local + (rth ? 0 : 6 * HOUR)) / DAY);
  return day * DAY + 12 * HOUR - off;
}

export function newId(): string {
  try { return crypto.randomUUID(); } catch { return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

/** Default stop/target for a new position: 1R = ~6% of the visible price range, target 2R; box ends at `rightT`. */
export function positionPoints(entry: DPoint, side: 'long' | 'short', priceRange: number, rightT: number): DPoint[] {
  const risk = Math.max(TICK * 8, Math.round((priceRange * 0.06) / TICK) * TICK);
  const dir = side === 'long' ? 1 : -1;
  const right = rightT;
  return [
    entry,
    { t: entry.t, p: entry.p + dir * risk * 2 },  // target
    { t: entry.t, p: entry.p - dir * risk },      // stop
    { t: right, p: entry.p },                     // right edge
  ];
}

/** Basic shape checks for drawings loaded from the server. */
export function validDrawing(x: any): x is Drawing {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !(x.tool in TOOLS)) return false;
  if (!Array.isArray(x.points) || !x.points.length) return false;
  if (!x.points.every((p: any) => p && Number.isFinite(p.t) && Number.isFinite(p.p))) return false;
  if ((x.tool === 'long' || x.tool === 'short') && x.points.length !== 4) return false;
  return typeof x.color === 'string' && Number.isFinite(x.width);
}
