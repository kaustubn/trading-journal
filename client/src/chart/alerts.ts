// Price alerts and alerts on drawings (horizontal line / ray, trend line, rectangle zone,
// vertical line = a time). Checked on every new price: live bars, replay and forward test.
import type { Drawing } from './drawings';

export type AlertCond = 'cross' | 'above' | 'below';
export interface ChartAlert {
  id: string;
  kind: 'price' | 'drawing';
  price?: number;          // price alerts
  drawingId?: string;      // drawing alerts
  cond: AlertCond;
  note: string;
  active: boolean;
  repeat: boolean;         // false = switch off after it fires once
  created: number;
  fired?: number;          // last time it fired (ms)
}

export const ALERT_TOOLS = ['hline', 'hray', 'trend', 'rect', 'vline'] as const;
export const canAlert = (d: Drawing | null | undefined) => !!d && (ALERT_TOOLS as readonly string[]).includes(d.tool);

/** The level a drawing stands for at time t: a price, a [low, high] zone, or a time (vline). */
export type Level = { price: number } | { zone: [number, number] } | { time: number } | null;
export function levelOf(d: Drawing, t: number): Level {
  const [a, b] = d.points;
  if (!a) return null;
  if (d.tool === 'hline' || d.tool === 'hray') return { price: a.p };
  if (d.tool === 'vline') return { time: a.t };
  if (!b) return null;
  if (d.tool === 'rect') return { zone: [Math.min(a.p, b.p), Math.max(a.p, b.p)] };
  if (d.tool === 'trend') {
    if (b.t === a.t) return { price: b.p };
    // inside the segment, or beyond it only when the line is extended that way
    const t0 = Math.min(a.t, b.t), t1 = Math.max(a.t, b.t);
    if ((t < t0 && !d.extL) || (t > t1 && !d.extR)) return null;
    return { price: a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t) };
  }
  return null;
}

/**
 * Did the price move from `prev` to `cur` trigger the alert? `hi` / `lo` are the extremes in
 * between (a 1-minute bar's high and low), so a wick through the level counts like TradingView.
 */
export function triggered(cond: AlertCond, lvl: Level, prev: number, cur: number, prevT: number, t: number, hi = Math.max(prev, cur), lo = Math.min(prev, cur)): boolean {
  if (!lvl) return false;
  hi = Math.max(hi, cur); lo = Math.min(lo, cur);
  if ('time' in lvl) return prevT < lvl.time && t >= lvl.time;
  if ('zone' in lvl) {
    const [zlo, zhi] = lvl.zone;
    const inside = (p: number) => p >= zlo && p <= zhi;
    if (cond === 'above') return prev <= zhi && hi > zhi;
    if (cond === 'below') return prev >= zlo && lo < zlo;
    return !inside(prev) && hi >= zlo && lo <= zhi;   // "cross" a zone = enter it
  }
  const L = lvl.price;
  if (cond === 'above') return prev <= L && hi > L;
  if (cond === 'below') return prev >= L && lo < L;
  return (prev < L && hi >= L) || (prev > L && lo <= L);
}

export function describe(a: ChartAlert, d: Drawing | undefined, fmt: (n: number) => string): string {
  const c = { cross: 'crosses', above: 'goes above', below: 'goes below' }[a.cond];
  if (a.kind === 'price') return `Price ${c} ${fmt(a.price ?? 0)}`;
  if (!d) return 'Drawing deleted';
  const name = { hline: 'horizontal line', hray: 'horizontal ray', trend: 'trend line', rect: 'zone', vline: 'time line' }[d.tool as string] ?? d.tool;
  if (d.tool === 'vline') return `Time reaches the ${name}${d.text ? ` "${d.text}"` : ''}`;
  if (d.tool === 'rect') return `Price ${a.cond === 'cross' ? 'enters' : c} the ${name}`;
  return `Price ${c} the ${name}${d.text ? ` "${d.text}"` : ''}${d.tool !== 'trend' ? ` (${fmt(d.points[0].p)})` : ''}`;
}

/** Validate alerts loaded from saved settings. */
export function cleanAlerts(v: unknown): ChartAlert[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a: any) => a && typeof a.id === 'string' && (a.kind === 'price' || a.kind === 'drawing')
    && ['cross', 'above', 'below'].includes(a.cond)
    && (a.kind === 'price' ? Number.isFinite(a.price) : typeof a.drawingId === 'string'))
    .slice(0, 200)
    .map((a: any): ChartAlert => ({
      id: a.id, kind: a.kind, price: a.kind === 'price' ? Number(a.price) : undefined, drawingId: a.kind === 'drawing' ? a.drawingId : undefined,
      cond: a.cond, note: typeof a.note === 'string' ? a.note.slice(0, 120) : '', active: a.active !== false, repeat: !!a.repeat,
      created: Number(a.created) || Date.now(), fired: Number.isFinite(a.fired) ? Number(a.fired) : undefined,
    }));
}

/** A short beep (no sound file needed). */
export function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.5);
    o.onended = () => ctx.close();
  } catch { /* sound blocked */ }
}

export function notify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'jc-alert' });
  } catch { /* not available */ }
}
