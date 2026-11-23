// News lines for the market chart: loads /api/calendar/chart one year at a time (only the years the charts show),
// keeps them for the session, and tells the chart windows when new ones arrive.
import axios from 'axios';
import { ChartNews, NewsGroup, groupNews, asOf, outlook } from '../../../src/shared/chartNews';

export interface NewsMark { ms: number; label: string; impact: 'high' | 'medium' | 'low'; bias: 'up' | 'down' | 'none'; future: boolean }

const loaded = new Map<string, ChartNews[]>();   // "2024|m" -> events of that year
const loading = new Set<string>();
const listeners = new Set<() => void>();
let lastFetchNow = 0;

export function onNews(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Make sure the years covering [fromMs, toMs] are loaded (the current year is refreshed every 30 min). */
export function ensureNews(fromMs: number, toMs: number, medium: boolean, auth: () => { headers: { Authorization: string } }) {
  const y0 = new Date(fromMs).getUTCFullYear(), y1 = new Date(Math.min(toMs, Date.now() + 60 * 86400000)).getUTCFullYear();
  const nowY = new Date().getUTCFullYear();
  if (Date.now() - lastFetchNow > 30 * 60000) { for (const k of [...loaded.keys()]) if (Number(k.split('|')[0]) >= nowY) loaded.delete(k); lastFetchNow = Date.now(); }
  for (let y = Math.max(2016, y0); y <= y1 && y <= nowY + 1; y++) {
    const key = `${y}|${medium ? 'm' : 'h'}`;
    if (loaded.has(key) || loading.has(key)) continue;
    loading.add(key);
    const from = Date.UTC(y, 0, 1), to = Date.UTC(y + 1, 0, 1);
    axios.get('/api/calendar/chart', { ...auth(), params: { from, to, medium: medium ? 1 : undefined } })
      .then(r => { loaded.set(key, r.data.events || []); listeners.forEach(f => f()); })
      .catch(() => { loaded.set(key, []); })
      .finally(() => loading.delete(key));
  }
}

/** Release groups between two times, as known at `cursorMs` (replay hides actuals after the cursor). */
export function newsGroups(fromMs: number, toMs: number, medium: boolean, cursorMs: number | null): NewsGroup[] {
  const evs: ChartNews[] = [];
  const tag = medium ? 'm' : 'h';
  for (const [k, list] of loaded) {
    if (!k.endsWith('|' + tag)) continue;
    for (const e of list) { const ms = Date.parse(e.utc); if (ms >= fromMs && ms <= toMs) evs.push(asOf(e, cursorMs)); }
  }
  return groupNews(evs);
}

export function marksOf(groups: NewsGroup[], nowMs: number, price: number | null): NewsMark[] {
  return groups.map(g => ({ ms: g.ms, label: g.label, impact: g.impact, bias: outlook(g.main, price).bias, future: g.ms > nowMs }));
}
