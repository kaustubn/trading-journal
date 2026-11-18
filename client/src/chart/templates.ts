// Drawing templates, copied from the trader's TradingView drawing templates (2026-11-17)
// plus the styles used most on the TradingView chart that had no template there.
// Applying a template to a drawing copies these style fields onto it; the last template
// used for a tool becomes the style for that tool's next drawing.
import type { Drawing, Tool } from './drawings';

export type TplStyle = Partial<Pick<Drawing, 'color' | 'width' | 'line' | 'fill' | 'extL' | 'extR' | 'text' | 'textColor' | 'levels' | 'fibFill'>>
  & { stopPts?: number; targetPts?: number };   // long / short: default distances
export interface Template { name: string; style: TplStyle; from: 'TradingView' | 'TV chart'; }

const W = 'rgba(255, 255, 255, 1)', K = 'rgba(0, 0, 0, 1)';
const FIB_K1 = [
  { v: 0, c: W }, { v: 0.236, c: '#F23645' }, { v: 0.382, c: 'rgba(242, 54, 69, 1)' }, { v: 0.5, c: K }, { v: 0.618, c: K },
  { v: 0.786, c: 'rgba(255, 235, 59, 1)' }, { v: 1, c: 'rgba(178, 235, 242, 1)' }, { v: 1.618, c: '#2962FF' },
  { v: 2.618, c: 'rgba(103, 58, 183, 1)' }, { v: 3.618, c: 'rgba(242, 54, 69, 1)' }, { v: 4.236, c: 'rgba(128, 25, 34, 1)' },
];
const ray = (name: string, textColor: string): Template =>
  ({ name, from: 'TradingView', style: { color: 'rgba(46, 46, 46, 0.7962)', width: 2, line: 'solid', text: name, textColor } });

export const TEMPLATES: Partial<Record<Tool, Template[]>> = {
  hline: [
    { name: '1w & 1 d', from: 'TradingView', style: { color: 'rgba(252, 203, 205, 0.5)', width: 3, line: 'solid' } },
    { name: '4hr & 1hr', from: 'TradingView', style: { color: 'rgba(255, 245, 157, 0.5)', width: 3, line: 'solid' } },
  ],
  hray: [
    ray('asia high', 'rgba(233, 30, 99, 1)'), ray('asia low', 'rgba(233, 30, 99, 1)'),
    ray('london high', W), ray('london low', W),
    ray('newyork high', K), ray('newyork low', K),
  ],
  rect: [
    { name: '15 min', from: 'TradingView', style: { color: 'rgba(255, 255, 255, 0.2357)', width: 2, line: 'solid', fill: 'rgba(255, 255, 255, 0.1569)', extR: true, extL: false } },
    { name: 'trading', from: 'TradingView', style: { color: 'rgba(255, 255, 255, 0.2357)', width: 2, line: 'solid', fill: 'rgba(0, 0, 0, 0.1569)', extR: false, extL: false } },
    { name: 'zone red', from: 'TradingView', style: { color: 'rgba(255, 255, 255, 0.2357)', width: 2, line: 'solid', fill: 'rgba(242, 54, 69, 0.0805)', extR: false, extL: false } },
    { name: 'zone purple', from: 'TradingView', style: { color: 'rgba(103, 58, 183, 0.4013)', width: 2, line: 'solid', fill: 'rgba(103, 58, 183, 0.1146)', extR: false, extL: false } },
  ],
  trend: [
    { name: 'day high', from: 'TradingView', style: { color: 'rgba(156, 39, 176, 1)', width: 2, line: 'solid', text: 'day high', textColor: K } },
    { name: 'day low', from: 'TradingView', style: { color: 'rgba(156, 39, 176, 1)', width: 2, line: 'solid', text: 'day low', textColor: K } },
    { name: 'prev swing', from: 'TradingView', style: { color: 'rgba(156, 39, 176, 1)', width: 2, line: 'solid', text: 'swing & liquidity', textColor: K } },
    { name: 'k', from: 'TradingView', style: { color: K, width: 2, line: 'solid', text: '' } },
    { name: 'st', from: 'TradingView', style: { color: 'rgba(15, 15, 15, 1)', width: 1, line: 'solid', text: '' } },
    { name: 'white', from: 'TradingView', style: { color: 'rgba(255, 255, 255, 0.7)', width: 2, line: 'solid', text: '' } },
  ],
  fib: [
    { name: 'k1', from: 'TradingView', style: { color: '#787B86', width: 1, levels: FIB_K1, fibFill: true } },
    { name: 'k2', from: 'TradingView', style: { color: '#787B86', width: 1, levels: FIB_K1.filter(l => l.v !== 0.236), fibFill: false } },
    { name: 'retracement', from: 'TradingView', style: { color: '#787B86', width: 1, levels: [{ v: 0, c: W }, { v: 0.5, c: K }, { v: 0.618, c: W }, { v: 1, c: K }], fibFill: true } },
  ],
  vline: [
    { name: 'bl', from: 'TradingView', style: { color: K, width: 2, line: 'solid' } },
  ],
  channel: [
    { name: 'channel', from: 'TradingView', style: { color: 'rgba(0, 0, 0, 1)', width: 2, line: 'solid' } },
  ],
  gann: [
    { name: 'k', from: 'TradingView', style: { color: 'rgba(21, 56, 153, 0.8)', width: 2, line: 'solid' } },
  ],
  path: [
    { name: 'path', from: 'TradingView', style: { color: 'rgba(242, 54, 69, 1)', width: 2, line: 'solid' } },
  ],
  long: [
    { name: 'k1', from: 'TradingView', style: { color: W, width: 2, stopPts: 69, targetPts: 150 } },
  ],
  short: [
    { name: 'k1', from: 'TradingView', style: { color: W, width: 2, stopPts: 40, targetPts: 40 } },
  ],
};

/** Style fields of a template as a Drawing patch (drops the position distances). */
export function tplPatch(t: TplStyle): Partial<Drawing> {
  const { stopPts: _s, targetPts: _t, ...rest } = t;
  return rest;
}
