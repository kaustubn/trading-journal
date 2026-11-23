// Candle patterns: mark the candle patterns you pick, alone or N in a row (e.g. 2 engulfing candles one after the
// other), on the chart's timeframe or a higher one (e.g. 5-minute patterns on a 1-minute chart, marked on the bar
// that closes the 5-minute candle). Only finished candles count, so nothing repaints, live or in Replay.
// Backtest stats: how often each pattern was followed by a move its way over the next N candles, and by how much.
import { registerIndicator, KLineData } from 'klinecharts';
import { candleStats, findCandles, sanitizeCndl, toTf } from '../../../src/shared/candlePatterns';
import type { CndlOpts, Hit } from '../../../src/shared/candlePatterns';
export * from '../../../src/shared/candlePatterns';

let cache: { key: string; hits: Hit[]; stats: ReturnType<typeof candleStats>; note: string } | null = null;

function analyse(d: KLineData[], chartTf: number, o: CndlOpts) {
  const last = d[d.length - 1];
  const key = `${d.length}|${last?.timestamp}|${last?.close}|${chartTf}|${JSON.stringify(o)}`;
  if (cache?.key === key) return cache;
  let tf = o.tf, note = '';
  if (tf && (tf < chartTf || tf % chartTf !== 0)) { note = ` (set ${tf}m is not a multiple of this ${chartTf}m chart: using the chart's candles)`; tf = 0; }
  const c = toTf(d, chartTf, tf, Date.now());
  const hits = findCandles(c, o);
  cache = { key, hits, stats: candleStats(c, hits, o.ahead), note };
  return cache;
}

export function registerCandlePatterns() {
  registerIndicator<Record<string, number>, number, { opts?: Partial<CndlOpts>; tfMin?: number }>({
    name: 'JC_CNDL', shortName: 'Candles', series: 'price', precision: 2, calcParams: [], figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: ({ chart, indicator }) => {
      const o = sanitizeCndl((indicator.extendData as any)?.opts), chartTf = (indicator.extendData as any)?.tfMin ?? 1;
      const name = `Candle patterns${o.tf ? ` (${o.tf}m)` : ''}${o.run > 1 ? `, ${o.run} in a row` : ''}`;
      const d = chart.getDataList();
      if (d.length < 10 || !o.stats) return { name, calcParamsText: '', legends: [], features: undefined as never };
      const r = analyse(d, chartTf, o);
      const parts = Object.entries(r.stats).sort((a, b) => b[1].n - a[1].n).slice(0, 4)
        .map(([l, s]) => `${l} ${s.n}× → ${Math.round((100 * s.ok) / s.n)}% its way, ${(s.pts / s.n >= 0 ? '+' : '') + (s.pts / s.n).toFixed(1)} pts`);
      // stats in the title: the TV look hides inputs and values
      return { name: `${name}${r.note} · next ${o.ahead} candles: ${parts.length ? parts.join(' · ') : 'none in the loaded bars'}`, calcParamsText: '', legends: [], features: undefined as never };
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const d = chart.getDataList();
      if (d.length < 10) return true;
      const o = sanitizeCndl((indicator.extendData as any)?.opts), chartTf = (indicator.extendData as any)?.tfMin ?? 1;
      if (!o.labels) return true;
      const { hits } = analyse(d, chartTf, o);
      const range = chart.getVisibleRange(), bar = chart.getBarSpace().bar;
      if (bar < 3) return true;
      const x = (i: number) => xAxis.convertToPixel(i), y = (p: number) => yAxis.convertToPixel(p);
      ctx.save();
      ctx.font = `${bar >= 10 ? 11 : 9}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      for (const h of hits) {
        if (h.last < range.from || h.last >= range.to) continue;
        const b = d[h.last], col = h.bias > 0 ? '#089981' : h.bias < 0 ? '#f23645' : '#b2b5be';
        ctx.fillStyle = col;
        if (h.bias >= 0) { ctx.textBaseline = 'top'; ctx.fillText('▲ ' + h.label, x(h.last), y(b.low) + 3); }
        else { ctx.textBaseline = 'bottom'; ctx.fillText(h.label + ' ▼', x(h.last), y(b.high) - 3); }
      }
      ctx.restore();
      return true;
    },
  });
}
