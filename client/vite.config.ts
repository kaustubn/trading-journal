import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Bigger grab areas for chart drawings (KLineChart 10.1.0 only counts a click within 2 px of a line, which made
 * drawings very hard to select, drag or delete), and figures marked `ignoreEvent: true` no longer swallow the click
 * (in KLineChart they still caught it without selecting anything). Patched at build time; the build fails if the
 * library code changes, so an upgrade can't silently drop the fix.
 */
function klineHitAreas(): Plugin {
  const PATCHES: [string, string][] = [
    ['var DEVIATION = 2;', 'var DEVIATION = 6;'],
    // drawing handles (circles): hit radius = drawn radius + the tolerance
    ['var x = circle_1.x, y = circle_1.y, r = circle_1.r;', 'var x = circle_1.x, y = circle_1.y, r = circle_1.r + DEVIATION;'],
    ["var events = _this._createFigureEvents(overlay, 'other', figureIndex, figure);",
      "var events = figure.ignoreEvent === true ? null : _this._createFigureEvents(overlay, 'other', figureIndex, figure);"],
    // key events sent to the document itself (no tagName) crashed the chart's keyboard handler
    ["var tagName = target === null || target === void 0 ? void 0 : target.tagName.toLowerCase();",
      "var tagName = target === null || target === void 0 ? void 0 : String(target.tagName || '').toLowerCase();"],
  ];
  return {
    name: 'kline-hit-areas',
    enforce: 'pre',
    transform(code, id) {
      if (!/klinecharts[\\/]dist[\\/]index\.esm\.js/.test(id)) return null;
      let out = code;
      for (const [from, to] of PATCHES) {
        if (!out.includes(from)) throw new Error(`kline-hit-areas: KLineChart code changed, patch not applied: ${from}`);
        out = out.replace(from, to);
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), klineHitAreas()],
  // dev server: don't pre-bundle KLineChart, so the patch above also applies in `vite dev`
  optimizeDeps: { exclude: ['klinecharts'] },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
