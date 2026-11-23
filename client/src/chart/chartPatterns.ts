// Auto chart patterns: double / triple tops and bottoms, head & shoulders (and inverse), triangles, wedges, flags and
// channels, found on swing points and scored 0-100% by how close they are to the textbook shape ("similarity").
// A pattern is shown when its similarity >= the setting (default 75%).
//
// No repainting: a swing point only exists once price has moved back by `sensitivity x ATR` from it, and a pattern is
// only known at the bar that confirmed its last swing point. So it works the same live and in Replay (backtesting):
// the chart only holds bars up to the replay time.
// Backtest stats: for every pattern found in the loaded data, how often price then moved the pattern's way over the
// next N bars (shown in the indicator's legend).
import { registerIndicator, KLineData } from 'klinecharts';
import { PAT_INFO, findPatterns, patternStats, sanitizeCpat } from '../../../src/shared/chartPatterns';
import type { CpatOpts, Found, PatType } from '../../../src/shared/chartPatterns';
export * from '../../../src/shared/chartPatterns';

let cache: { key: string; found: Found[]; stats: ReturnType<typeof patternStats> } | null = null;

function analyse(d: KLineData[], o: CpatOpts) {
  const last = d[d.length - 1];
  const key = `${d.length}|${last?.timestamp}|${last?.close}|${JSON.stringify(o)}`;
  if (cache?.key === key) return cache;
  const found = findPatterns(d, o);
  cache = { key, found, stats: patternStats(d, found, o.ahead) };
  return cache;
}

export function registerChartPatterns() {
  registerIndicator<Record<string, number>, number, { opts?: Partial<CpatOpts> }>({
    name: 'JC_CPAT', shortName: 'Patterns', series: 'price', precision: 2, calcParams: [], figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: ({ chart, indicator }) => {
      const o = sanitizeCpat((indicator.extendData as any)?.opts);
      const d = chart.getDataList();
      if (d.length < 50 || !o.stats) return { name: `Chart patterns ≥ ${o.minSim}%`, calcParamsText: '', legends: [], features: undefined as never };
      const st = analyse(d, o).stats;
      const parts = (Object.entries(st) as [PatType, { n: number; ok: number; pts: number }][]).filter(([, s]) => s.n).sort((a, b) => b[1].n - a[1].n)
        .map(([t, s]) => `${PAT_INFO[t].short} ${s.n}× → ${Math.round((100 * s.ok) / s.n)}% its way, ${(s.pts / s.n >= 0 ? '+' : '') + (s.pts / s.n).toFixed(1)} pts`);
      const txt = parts.length ? ` · next ${o.ahead} bars: ${parts.slice(0, 4).join(' · ')}` : ' · none in the loaded bars';
      // stats in the title: the TV look hides inputs and values
      return { name: `Chart patterns ≥ ${o.minSim}%${txt}`, calcParamsText: '', legends: [], features: undefined as never };
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const d = chart.getDataList();
      if (d.length < 50) return true;
      const o = sanitizeCpat((indicator.extendData as any)?.opts);
      const { found } = analyse(d, o);
      const range = chart.getVisibleRange();
      const x = (i: number) => xAxis.convertToPixel(i), y = (p: number) => yAxis.convertToPixel(p);
      ctx.save();
      ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
      for (const f of found) {
        const a = f.pts[0].i, b = Math.max(f.conf, f.pts[f.pts.length - 1].i);
        if (b < range.from || a > range.to) continue;
        const info = PAT_INFO[f.type], col = info.bias > 0 ? '#089981' : info.bias < 0 ? '#f23645' : '#b2b5be';
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
        if (o.lines) {
          if (f.lines) {
            ctx.setLineDash([]);
            for (const [i0, p0, i1, p1] of f.lines) { ctx.beginPath(); ctx.moveTo(x(i0), y(p0)); ctx.lineTo(x(i1), y(p1)); ctx.stroke(); }
          }
          ctx.globalAlpha = f.lines ? 0.45 : 0.9; ctx.setLineDash(f.lines ? [3, 3] : []);
          ctx.beginPath(); f.pts.forEach((p, k) => (k ? ctx.lineTo(x(p.i), y(p.p)) : ctx.moveTo(x(p.i), y(p.p)))); ctx.stroke();
          ctx.globalAlpha = 1; ctx.setLineDash([]);
          // neckline for tops / bottoms / head & shoulders: through the inner swing points
          if (!f.lines && f.pts.length >= 4 && f.type !== 'bflag' && f.type !== 'beflag') {
            const inner = f.pts.filter((p, k) => k > 0 && k < f.pts.length - 1 && p.kind === f.pts[0].kind);
            if (inner.length) {
              const nl = inner.reduce((s, p) => s + p.p, 0) / inner.length;
              ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x(inner[0].i), y(nl)); ctx.lineTo(x(b) + 20, y(nl)); ctx.stroke(); ctx.setLineDash([]);
            }
          }
        }
        if (o.labels) {
          const lp = f.pts[f.pts.length - 1], above = lp.kind === 'H';
          ctx.textAlign = 'center'; ctx.textBaseline = above ? 'bottom' : 'top';
          ctx.fillText(`${info.short} ${Math.round(f.score * 100)}%`, x(lp.i), y(lp.p) + (above ? -6 : 6));
        }
      }
      ctx.restore();
      return true;
    },
  });
}
