import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { init, dispose } from 'klinecharts';
import type { Chart, KLineData, DataLoaderGetBarsParams, DataLoadMore, Crosshair } from 'klinecharts';
import { registerChartIndicators, BgData, LevelsData, newsX } from '../chart/indicators';
import { ensureNews, newsGroups, marksOf, onNews } from '../chart/newsStore';
import { outlook, NewsGroup } from '../../../src/shared/chartNews';
import { registerDrawingOverlays } from '../chart/overlays';
import { chartStyles } from '../chart/theme';
import { TZ, sessionDay } from '../chart/time';
import { barTime } from '../chart/drawings';
import { DrawingController, DrawingStore } from '../chart/drawingController';
import { ReplayEngine, ReplayView } from '../chart/replay';
import { PANE, Settings, Meta, BarsResp, FocusTrade, toK, periodOf, syncIndicators, viewOf, barEnd, INDS, IND_KEYS } from '../chart/config';

/** What the workspace shares with every chart window. Stable object; read through the getters. */
export interface Workspace {
  auth: () => { headers: { Authorization: string } };
  settings: () => Settings;
  meta: () => Meta | null;
  store: DrawingStore;
  engine: ReplayEngine;
  target: { ts: number; align: 'right' | 'center' } | null; // shared "go to" moment, null = latest bars
  focus: FocusTrade | null;                                 // trade opened from the journal
  measureArmed: () => boolean;
  setMeasureArmed: (v: boolean) => void;
  replayPick: () => boolean;
  startReplay: (t: number) => void;
  redraw: () => void;
  setError: (msg: string) => void;
  setBusy: (index: number, busy: boolean) => void;
  onChartDate: (index: number, day: string) => void;
  indicatorAction: (name: string, feature: string) => void;  // eye / gear / close in an indicator's legend
  toggleLegend: () => void;            // collapse / expand the main chart's indicator legends
  syncUntil: number;                   // time sync: ignore other windows' scroll events until then (they were caused by the sync)
  syncSrc: number;                     // the window being scrolled by the trader
  panes: Map<number, PaneHandle>;
}
export interface PaneHandle {
  index: number;
  chart: Chart;
  ctl: DrawingController;
  tf: () => number;
  reset: () => void;                   // reload around the shared target / replay cursor / latest
  onMinute: (k: KLineData) => void;    // replay revealed a minute
  onLive: (k: KLineData) => void;      // forward test: the playing minute grew
  drawReplay: () => void;              // bracket + trade markers
  drawFocus: () => void;
  appendLatest: () => Promise<void>;   // new bars arrived (near-live)
  showCrosshair: (ts: number | null, price: number | null) => void;
  showTime: (ts: number) => void;      // time sync: put the bar at ts on the right edge
  setHotkeys: (on: boolean) => void;
}

interface Props { index: number; tf: number; s: Settings; active: boolean; ws: Workspace; onActivate: (i: number) => void; }

/** Indicator legends on/off (the library has one switch for all panes). When open, leave a gap under the price
 *  line for the collapse button so it never covers a legend row, however many rows wrap. */
function applyLegend(chart: Chart, s: Settings) {
  const open = s.legendOpen !== false;
  const hasMain = IND_KEYS.some(k => INDS[k].main && s.indicators[k]?.on);
  chart.setStyles({ indicator: { tooltip: { showRule: open ? 'always' : 'none' } }, candle: { tooltip: { legend: { marginBottom: open && hasMain ? 28 : 4 } } } } as any);
}

export default function ChartPane({ index, tf, s, active, ws, onActivate }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const ctlRef = useRef<DrawingController | null>(null);
  const viewRef = useRef<ReplayView | null>(null);
  const barCbRef = useRef<((k: KLineData) => void) | null>(null);
  const tfRef = useRef(tf);
  const sRef = useRef(s);
  const appliedRef = useRef<{ s: Settings; tf: number } | null>(null);
  const localTarget = useRef<{ ts: number; align: 'right' | 'center' | 'mid' } | null>(null); // keeps this window's moment on a timeframe change
  const loadSeq = useRef(0);
  const levelsRef = useRef<LevelsData | null>(null);
  const levelsAt = useRef<number | null>(null);
  const levelsTimer = useRef<number | undefined>(undefined);
  const [guideX, setGuideX] = useState<number | null>(null);
  const [newsHover, setNewsHover] = useState<{ x: number; flip: boolean; g: NewsGroup; move: number | null; price: number | null } | null>(null);
  const newsRef = useRef<NewsGroup[]>([]);
  const [countdown, setCountdown] = useState<{ y: number; left: number; width: number; text: string; up: boolean } | null>(null);

  // ----- time to the candle's close, under the last price on the right scale (like TradingView) -----
  useEffect(() => {
    const tick = () => {
      const chart = chartRef.current, st = sRef.current, tfm = tfRef.current, eng = ws.engine;
      if (!chart || tfm >= 1440 || !st.chart.countdown) { setCountdown(null); return; }
      const data = chart.getDataList();
      const last = data[data.length - 1];
      const now = eng.active ? (eng.live ? eng.nowMs : null) : Date.now();
      if (!last || now === null) { setCountdown(null); return; }
      const end = barEnd(last.timestamp, tfm, st.rth) + 60000;
      const rem = end - now;
      if (rem <= 0 || rem > tfm * 60000 + 60000) { setCountdown(null); return; }
      const px = chart.convertToPixel({ timestamp: last.timestamp, value: last.close }, { paneId: PANE }) as { y?: number };
      const ax = chart.getSize(PANE, 'yAxis' as any) as { left: number; width: number; height: number } | null;
      if (!ax || typeof px?.y !== 'number' || px.y < 0 || px.y > ax.height) { setCountdown(null); return; }
      const sec = Math.ceil(rem / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
      const text = `${h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;
      setCountdown({ y: px.y + 10, left: ax.left, width: ax.width, text, up: last.close >= (data[data.length - 2]?.close ?? last.open) });
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [ws]);
  tfRef.current = tf;
  sRef.current = s;

  const get = (p: Record<string, unknown>) => axios.get<BarsResp>('/api/bars', {
    ...ws.auth(), params: { symbol: 'NQ', tf: tfRef.current === 1440 ? 'D' : tfRef.current, rth: sRef.current.rth ? 1 : undefined, ...p },
  }).then(r => r.data);

  // ----- background layer (sessions, levels, rolls) -----
  const pushBg = useCallback(() => {
    const chart = chartRef.current, st = sRef.current;
    if (!chart) return;
    const extendData: BgData = {
      tfMin: tfRef.current, dark: st.theme === 'dark', sessions: st.sessions && !st.rth, breaks: st.chart.breaks, breaksColor: st.chart.breaksColor,
      breaksStyle: st.chart.breaksStyle, breaksWidth: st.chart.breaksWidth,
      rolls: st.rolls ? ws.meta()?.rolls ?? [] : null,
      levels: levelsRef.current, show: st.levels,
      news: null,
    };
    if (st.news) {
      const eng = ws.engine, cursor = eng.active ? eng.cursor : null;
      const data = chart.getDataList();
      newsRef.current = newsGroups(-Infinity, Infinity, st.newsMedium, cursor, st.newsHeadlines !== false);
      extendData.news = marksOf(newsRef.current, cursor ?? Date.now(), data.length ? data[data.length - 1].close : null);
    } else newsRef.current = [];
    chart.overrideIndicator({ name: 'JC_BG', paneId: PANE, extendData });
  }, [ws]);

  // Levels and the notes' trading day belong to the bar at the right edge. Debounced.
  const refreshLevels = useCallback(() => {
    window.clearTimeout(levelsTimer.current);
    levelsTimer.current = window.setTimeout(async () => {
      const chart = chartRef.current, st = sRef.current, tfm = tfRef.current;
      if (!chart) return;
      const data = chart.getDataList();
      if (!data.length) return;
      const eng = ws.engine;
      const edge = data[Math.max(0, Math.min(data.length, chart.getVisibleRange().to) - 1)].timestamp;
      let at = edge + (tfm - 1) * 60000;                  // last minute of the right-most bar
      if (eng.active) at = Math.min(at, eng.cursor);      // replay: nothing after the revealed minute
      const dayAt = eng.active ? at : ws.focus?.entry ?? edge;
      if (st.news) {
        ensureNews(data[Math.max(0, chart.getVisibleRange().from)].timestamp - 86400000, Math.max(at, edge) + 45 * 86400000, st.newsMedium, ws.auth, st.newsHeadlines !== false);
        pushBg();   // replay: releases the cursor has passed now show their actual numbers
      }
      ws.onChartDate(index, new Date(sessionDay(dayAt) * 86400000).toISOString().slice(0, 10));
      const wanted = tfm < 1440 && (st.levels.pd || st.levels.on || st.levels.open);
      if (!wanted) {
        levelsAt.current = null;
        if (levelsRef.current) { levelsRef.current = null; pushBg(); }
        return;
      }
      const cur = levelsRef.current;
      // After the 9:30 open every level of a session is fixed, so nothing new to fetch
      if (cur && levelsAt.current !== null && at >= cur.nyStart && at < cur.end + 3600000 && levelsAt.current >= cur.nyStart) return;
      if (levelsAt.current === at) return;
      levelsAt.current = at;
      try {
        const r = await axios.get('/api/bars/levels', { ...ws.auth(), params: { symbol: 'NQ', at } });
        if (levelsAt.current !== at) return;
        levelsRef.current = r.data.levels;
        pushBg();
      } catch { /* levels are optional */ }
    }, 450);
  }, [ws, index, pushBg]);

  /** Entry/exit markers (and stop/target) of the trade opened from the journal. */
  const drawFocus = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.removeOverlay({ groupId: 'focus' });
    const t = ws.focus;
    if (!t || !t.chartable || t.entry_price === null) return;
    const { rth } = sRef.current, tfm = tfRef.current;
    const exitT = t.exit ?? t.entry, exitP = t.exit_price ?? t.entry_price;
    const dir = t.side === 'short' ? -1 : 1;
    const risk = t.stop_loss !== null && t.side ? Math.abs(t.entry_price - t.stop_loss) : 0;
    chart.createOverlay({
      name: 'jc_trade', groupId: 'focus', paneId: PANE, lock: true,
      points: [{ timestamp: barTime(t.entry, tfm, rth), value: t.entry_price }, { timestamp: barTime(exitT, tfm, rth), value: exitP }],
      extendData: { side: t.side, pnl: t.pnl, r: risk > 0 ? ((exitP - t.entry_price) * dir) / risk : null, stop: t.stop_loss, target: t.target },
    });
  }, [ws]);

  // ----- data loading -----
  // KLineChart naming: 'forward' asks for OLDER bars (left edge), 'backward' for NEWER ones.
  const loadBars = useCallback(async ({ type, timestamp, callback }: DataLoaderGetBarsParams) => {
    const seq = type === 'init' ? ++loadSeq.current : loadSeq.current;
    if (type === 'init') ws.setBusy(index, true);
    try {
      const eng = ws.engine;
      if (eng.active) {
        // Replay: history up to the candle the cursor is in (built from 1m bars); nothing newer
        if (type === 'backward') { callback([], { backward: false }); return; }
        if (type === 'init') {
          const r = await get({ to: eng.historyEnd(tfRef.current), limit: 1500 });
          if (seq !== loadSeq.current) return;
          const ks = r.bars.map(toK);
          const forming = viewRef.current?.formingCandle();
          if (forming) ks.push(forming);
          callback(ks, { forward: r.older, backward: false });
          viewRef.current?.redrawTrades();
          drawFocus();
          levelsAt.current = null;
          refreshLevels();
          return;
        }
      }
      let bars: BarsResp['bars'] = [];
      let more: DataLoadMore = false;
      const tgt = localTarget.current ?? ws.target;
      if (type === 'init' && tgt) {
        // Bars from the target on, then the bars before them: both pages are bucket-aligned
        const after = await get({ after: tgt.ts - 1, limit: 600 });
        const pivot = after.bars.length ? after.bars[0][0] : tgt.ts + 1;
        const before = await get({ to: pivot, limit: 1200 });
        bars = before.bars.concat(after.bars);
        more = { forward: before.older, backward: after.newer };
      } else if (type === 'init') {
        const r = await get({ limit: 1500 });
        bars = r.bars; more = { forward: r.older, backward: false };
      } else if (type === 'forward') {
        const r = await get({ to: timestamp, limit: 1500 });
        bars = r.bars; more = { forward: r.older };
      } else if (type === 'backward') {
        const r = await get({ after: timestamp, limit: 1500 });
        bars = r.bars; more = { backward: r.newer };
      }
      if (seq !== loadSeq.current) return; // a newer load has started
      callback(bars.map(toK), more);
      if (type === 'init') {
        const chart = chartRef.current;
        if (chart && tgt && bars.length) {
          const data = chart.getDataList();
          let idx = data.findIndex(k => k.timestamp >= tgt.ts);
          if (idx < 0) idx = data.length - 1;
          if (tgt.align === 'center') {
            const vr = chart.getVisibleRange();
            idx = Math.min(data.length - 1, idx + Math.round((vr.to - vr.from) * 0.35));
          }
          if (tgt.align === 'mid') {
            // after the chart has applied the new bars: put the remembered bar in the middle
            // (scrollToDataIndex(i) puts bar i at the right edge)
            const ts = tgt.ts;
            const place = () => {
              const c2 = chartRef.current;
              if (!c2) return;
              const d2 = c2.getDataList();
              let i2 = d2.findIndex(k => k.timestamp >= ts);
              if (i2 < 0) i2 = d2.length - 1;
              const vr = c2.getVisibleRange();
              c2.scrollToDataIndex(Math.min(d2.length - 1, i2 + Math.floor((vr.to - vr.from) / 2)));
            };
            place();
            window.setTimeout(place, 60);
          } else chart.scrollToDataIndex(idx);
        }
        viewRef.current?.drawOverlays();
        drawFocus();
        levelsAt.current = null;
        refreshLevels();
      }
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      callback([], false);
      ws.setError(e?.response?.status === 429
        ? 'Too many requests — wait a few seconds and scroll again.'
        : 'Could not load price data. Check your connection and try again.');
    } finally {
      if (type === 'init' && seq === loadSeq.current) ws.setBusy(index, false);
    }
  }, [ws, index, refreshLevels, drawFocus]);

  // ----- create the chart (once per window) -----
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    registerChartIndicators();
    registerDrawingOverlays();
    const st = sRef.current;
    const chart = init(box, { timezone: TZ[st.clock], styles: st.theme, locale: 'en-US' });
    if (!chart) { ws.setError('The chart could not start in this browser.'); return; }
    chartRef.current = chart;
    appliedRef.current = { s: st, tf: tfRef.current };
    chart.setStyles(chartStyles(st.theme, st.chart));
    applyLegend(chart, st);
    chart.subscribeAction('onIndicatorTooltipFeatureClick', (d: any) => { if (d?.indicator?.name && d?.feature?.id) ws.indicatorAction(d.indicator.name, d.feature.id); });
    chart.setSymbol({ ticker: 'NQ', pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(periodOf(tfRef.current));
    chart.createIndicator({ name: 'JC_BG', paneId: PANE }, true);
    pushBg();
    syncIndicators(chart, st, tfRef.current);
    if (st.log) chart.overrideYAxis({ paneId: PANE, name: 'logarithm' });
    if (ws.engine.active) chart.setHotkey({ enabled: false });
    chart.setDataLoader({
      getBars: loadBars,
      // used by replay and near-live updates to grow the newest candle
      subscribeBar: ({ callback }) => { barCbRef.current = callback; },
      unsubscribeBar: () => { barCbRef.current = null; },
    });
    chart.subscribeAction('onVisibleRangeChange', refreshLevels);
    // crosshair sync: tell the other windows where this one's crosshair is
    const onCross = (data?: unknown) => {
      if (!sRef.current.syncCrosshair) return;
      const c = data as Crosshair | undefined;
      const others = [...ws.panes.values()].filter(p => p.index !== index);
      if (!others.length) return;
      let price: number | null = null;
      if (c?.paneId === PANE && typeof c.y === 'number') {
        const p = chart.convertFromPixel([{ y: c.y }], { paneId: PANE });
        const v = (Array.isArray(p) ? p[0] : p)?.value;
        price = typeof v === 'number' ? v : null;
      }
      const ts = typeof c?.x === 'number' && typeof c?.timestamp === 'number' ? c.timestamp : null;
      others.forEach(p => p.showCrosshair(ts, price));
    };
    chart.subscribeAction('onCrosshairChange', onCross);
    // news lines: details of the release under the crosshair
    const onNewsCross = (d?: unknown) => {
      const c = d as Crosshair | undefined;
      const groups = newsRef.current;
      if (!groups.length || typeof c?.x !== 'number') { setNewsHover(h => (h ? null : h)); return; }
      const data = chart.getDataList();
      if (!data.length) return;
      const tfMs = tfRef.current * 60000, lastTs = data[data.length - 1].timestamp, bar = chart.getBarSpace();
      const toPx = (i: number) => { const b = Math.floor(i); const p = chart.convertToPixel({ dataIndex: b }, { paneId: PANE }) as { x?: number }; return (p?.x ?? NaN) + (i - b) * bar.bar; };
      let best: NewsGroup | null = null, bx = 0;
      for (const g of groups) {
        const gx = newsX(data, g.ms, tfMs, lastTs, toPx, bar.halfBar);
        if (gx !== null && Math.abs(gx - c.x) <= 6 && (!best || Math.abs(gx - c.x) < Math.abs(bx - c.x))) { best = g; bx = gx; }
      }
      if (!best) { setNewsHover(h => (h ? null : h)); return; }
      // what NQ actually did in the 15 minutes after this release (only when those minutes are on the chart and revealed)
      let move: number | null = null;
      const eng = ws.engine, known = eng.active ? eng.cursor : Date.now();
      if (tfRef.current <= 15 && best.ms + 15 * 60000 <= known) {
        const idx = (ms: number) => { let lo = 0, hi = data.length; while (lo < hi) { const m = (lo + hi) >> 1; if (data[m].timestamp <= ms) lo = m + 1; else hi = m; } return lo - 1; };
        const before = idx(best.ms - 1), after = idx(best.ms + 15 * 60000 - 1);
        if (before >= 0 && after > before && data[before].timestamp >= best.ms - 2 * tfMs && data[after].timestamp + tfMs <= best.ms + 15 * 60000 + 1)
          move = data[after].close - data[before].close;
      }
      const width = chart.getSize(PANE, 'main' as any)?.width ?? 800;
      setNewsHover({ x: bx, flip: bx > width - 330, g: best, move, price: data[data.length - 1].close });
    };
    chart.subscribeAction('onCrosshairChange', onNewsCross);
    const offNews = onNews(() => pushBg());
    // time sync: scrolling / zooming one window moves the others to the same time
    let raf = 0;
    const onMove = () => {
      if (!sRef.current.syncTime || (Date.now() < ws.syncUntil && ws.syncSrc !== index)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const others = [...ws.panes.values()].filter(p => p.index !== index);
        const data = chart.getDataList();
        if (!others.length || !data.length) return;
        const vr = chart.getVisibleRange();
        const right = data[Math.max(0, Math.min(data.length, vr.to) - 1)];
        if (!right) return;
        ws.syncUntil = Date.now() + 250;
        ws.syncSrc = index;
        const t = right.timestamp + tfRef.current * 60000 - 60000;   // last minute of the right-most bar
        others.forEach(p => p.showTime(t));
      });
    };
    chart.subscribeAction('onScroll', onMove);
    chart.subscribeAction('onZoom', onMove);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(box);

    const ctl = new DrawingController(chart, viewOf(st, tfRef.current), ws.store, ws.redraw);
    ctlRef.current = ctl;
    const view = new ReplayView(chart, ws.engine, () => ({ tf: tfRef.current, rth: sRef.current.rth }), k => barCbRef.current?.(k));
    viewRef.current = view;

    const handle: PaneHandle = {
      index, chart, ctl,
      tf: () => tfRef.current,
      reset: () => { localTarget.current = null; chart.resetData(); },
      onMinute: k => view.onMinute(k),
      onLive: k => view.onLive(k),
      drawReplay: () => view.drawOverlays(),
      drawFocus,
      appendLatest: async () => {
        // near-live: add the newest bars when this window is showing the latest data
        if (ws.engine.active || ws.target || localTarget.current || !barCbRef.current) return;
        const data = chart.getDataList();
        if (!data.length) return;
        const r = await get({ from: data[data.length - 1].timestamp, limit: 600 });
        if (r.bars.length >= 600) { chart.resetData(); return; }
        r.bars.map(toK).forEach(k => barCbRef.current?.(k));
      },
      showCrosshair: (ts, price) => {
        if (ts === null) { chart.executeAction('onCrosshairChange', {} as Crosshair); return; }
        const pt: { timestamp: number; value?: number } = { timestamp: barTime(ts, tfRef.current, sRef.current.rth) };
        if (price !== null) pt.value = price;
        const px = chart.convertToPixel(pt, { paneId: PANE });
        const c = Array.isArray(px) ? px[0] : px;
        if (typeof c?.x !== 'number') return;
        chart.executeAction('onCrosshairChange', { x: c.x, y: typeof c.y === 'number' ? c.y : undefined, paneId: PANE });
      },
      setHotkeys: on => chart.setHotkey({ enabled: on }),
      showTime: ts => {
        const data = chart.getDataList();
        if (!data.length) return;
        const key = barTime(ts, tfRef.current, sRef.current.rth);
        if (key < data[0].timestamp) {
          if (ws.engine.active) { chart.scrollToDataIndex(0); return; }
          localTarget.current = { ts: key, align: 'right' };   // older than loaded: reload around it
          chart.resetData();
          return;
        }
        let idx = data.findIndex(k => k.timestamp >= key);
        if (idx < 0) idx = data.length - 1;
        if (data[idx].timestamp > key && idx > 0) idx--;
        chart.scrollToDataIndex(idx);
      },
    };
    ws.panes.set(index, handle);
    ws.redraw();

    return () => {
      ws.panes.delete(index);
      ctl.dispose();
      ctlRef.current = null;
      viewRef.current = null;
      ro.disconnect();
      offNews();
      window.clearTimeout(levelsTimer.current);
      loadSeq.current++; // drop any answer still in flight
      dispose(box);
      chartRef.current = null;
      appliedRef.current = null;
      ws.redraw();
    };
  }, [ws, index, loadBars, pushBg, refreshLevels, drawFocus]);

  // ----- apply setting / timeframe changes -----
  useEffect(() => {
    const chart = chartRef.current, a = appliedRef.current;
    if (!chart || !a || (a.s === s && a.tf === tf)) return;
    if (a.tf !== tf) {
      // keep looking at the same moment when this window's timeframe changes
      const data = chart.getDataList();
      const vr = chart.getVisibleRange();
      const atEnd = !data.length || vr.to >= data.length;
      // the bar in the middle of the view stays in the middle on the new timeframe
      const mid = data[Math.max(0, Math.min(data.length - 1, Math.round((vr.from + vr.to) / 2)))];
      if (!atEnd && !ws.engine.active && mid) localTarget.current = { ts: mid.timestamp, align: 'mid' };
      chart.setPeriod(periodOf(tf));
    } else if (a.s.rth !== s.rth) {
      const data = chart.getDataList();
      const vr = chart.getVisibleRange();
      const mid = data[Math.max(0, Math.min(data.length - 1, Math.round((vr.from + vr.to) / 2)))];
      if (data.length && vr.to < data.length && !ws.engine.active && mid) localTarget.current = { ts: mid.timestamp, align: 'mid' };
      chart.resetData();
    }
    if (a.s.clock !== s.clock) chart.setTimezone(TZ[s.clock]);
    if (a.s.theme !== s.theme || a.s.look !== s.look || a.s.chart !== s.chart) { chart.setStyles(s.theme); chart.setStyles(chartStyles(s.theme, s.chart)); }
    applyLegend(chart, s);
    if (a.s.log !== s.log) chart.overrideYAxis({ paneId: PANE, name: s.log ? 'logarithm' : 'normal' });
    if (a.s.indicators !== s.indicators || a.tf !== tf || a.s.look !== s.look || a.s.chart.ctype !== s.chart.ctype || (s.chart.ctype === 'heikin' && a.s.chart !== s.chart)) syncIndicators(chart, s, tf);
    pushBg();
    if (a.s.levels !== s.levels || a.tf !== tf || a.s.news !== s.news || a.s.newsMedium !== s.newsMedium || a.s.newsHeadlines !== s.newsHeadlines) { levelsAt.current = null; refreshLevels(); }
    ctlRef.current?.setView(viewOf(s, tf));
    if (ctlRef.current) ctlRef.current.stayDrawing = s.stayDrawing;
    appliedRef.current = { s, tf };
  }, [s, tf, ws, pushBg, refreshLevels]);

  // ----- mouse: activate on click, measure (Shift + drag / ruler), replay start pick -----
  // Capture phase, so the chart does not also start panning.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let follow = false;          // clicked without dragging: second click finishes
    let start: { x: number; y: number } | null = null;
    const pointAt = (e: MouseEvent) => {
      const chart = chartRef.current;
      const paneEl = chart?.getDom(PANE, 'main');
      if (!chart || !paneEl) return null;
      const r = paneEl.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
      const p = chart.convertFromPixel([{ x, y }], { paneId: PANE });
      return Array.isArray(p) ? p[0] : p;
    };
    const onMove = (e: MouseEvent) => {
      const p = pointAt(e);
      if (p) ctlRef.current?.moveMeasure(p);
    };
    const stop = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    };
    const onUp = (e: MouseEvent) => {
      if (!start) return;
      const dragged = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
      start = null;
      if (dragged) { stop(); ctlRef.current?.endMeasure(); ws.setMeasureArmed(false); }
      else { follow = true; window.removeEventListener('mouseup', onUp, true); }
    };
    const onDown = (e: MouseEvent) => {
      const ctl = ctlRef.current;
      if (!ctl) return;
      if (e.button === 2) return;               // right-click: handled by onContext
      if (e.button !== 0) return;
      // a tool picked while another window was active follows the click to this window
      if (!ctl.active) {
        const other = [...ws.panes.values()].find(p => p.index !== index && p.ctl.active);
        if (other) { const tool = other.ctl.active!; other.ctl.cancel(); ctl.start(tool); }
      }
      onActivate(index);
      if (ws.replayPick()) {
        // Replay start: the clicked candle becomes the last one shown
        const p = pointAt(e);
        if (!p || typeof p.timestamp !== 'number') return;
        e.stopPropagation(); e.preventDefault();
        ws.startReplay(barEnd(p.timestamp, tfRef.current, sRef.current.rth));
        return;
      }
      if (ctl.manualTool) {
        // path: each click adds a point; brush / highlighter: drag to draw
        const p = pointAt(e);
        if (!p) return;
        e.stopPropagation(); e.preventDefault();
        ctl.manualDown(p);
        if (ctl.manualTool === 'brush' || ctl.manualTool === 'highlight') {
          const mv = (ev: MouseEvent) => { const q = pointAt(ev); if (q) ctl.manualMove(q); };
          const up = () => { window.removeEventListener('mousemove', mv, true); window.removeEventListener('mouseup', up, true); ctl.manualUp(); };
          window.addEventListener('mousemove', mv, true);
          window.addEventListener('mouseup', up, true);
        }
        return;
      }
      if (follow) {
        follow = false;
        e.stopPropagation(); e.preventDefault();
        stop(); ctl.endMeasure(); ws.setMeasureArmed(false);
        return;
      }
      if (ctl.canDragPlace) {
        // Two-point tool: press, drag and release draws it in one move (TradingView style). A plain click
        // still goes to the chart, which places the points one click at a time. The chart doesn't pan meanwhile.
        const a = pointAt(e);
        const chart = chartRef.current;
        if (!a || !chart) return;
        const sx = e.clientX, sy = e.clientY;
        const scroll = chart.isScrollEnabled();
        chart.setScrollEnabled(false);
        let dragging = false;
        const mv = (ev: MouseEvent) => {
          if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) dragging = true;
          if (dragging) { const b = pointAt(ev); if (b) ctl.dragPreview(a, b); }
        };
        const up = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', mv, true);
          window.removeEventListener('mouseup', up, true);
          chart.setScrollEnabled(scroll);
          if (!dragging) return;
          const b = pointAt(ev);
          if (b) ctl.dragPlace(a, b); else ctl.dragCancel();
        };
        window.addEventListener('mousemove', mv, true);
        window.addEventListener('mouseup', up, true);
        return;
      }
      if (!(e.shiftKey || ws.measureArmed()) || ctl.active) {
        // An ordinary click removes the last measurement, like TradingView
        if (ctl.hasMeasure && !ctl.measuring) ctl.clearMeasure();
        return;
      }
      const p = pointAt(e);
      if (!p) return;
      e.stopPropagation(); e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      ctl.startMeasure(p);
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    };
    const onGuide = (e: MouseEvent) => {
      const ctl = ctlRef.current;
      if (ctl?.manualTool === 'path') { const p = pointAt(e); if (p) ctl.manualMove(p); }
      if (!ws.replayPick()) { setGuideX(null); return; }
      const r = root.getBoundingClientRect();
      setGuideX(e.clientX - r.left);
    };
    const onLeave = () => setGuideX(null);
    const onContext = (e: MouseEvent) => {
      // right-click cancels the tool (a path is finished), like TradingView; no browser menu on the chart
      e.preventDefault();
      const ctl = ctlRef.current;
      if (!ctl) return;
      if (ctl.active) { e.stopPropagation(); ctl.release(); return; }
      if (ctl.hasMeasure) { ctl.clearMeasure(); return; }
      if (ctl.selected) ctl.select(null);
    };
    const onDbl = (e: MouseEvent) => {
      const ctl = ctlRef.current;
      if (ctl?.manualTool === 'path') { e.stopPropagation(); e.preventDefault(); ctl.manualFinish(); }
    };
    const onKey = (e: KeyboardEvent) => {
      const ctl = ctlRef.current;
      if (ctl?.manualTool === 'path' && e.key === 'Enter') { e.preventDefault(); ctl.release(); }
    };
    root.addEventListener('dblclick', onDbl, true);
    root.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', onDown, true);
    root.addEventListener('mousemove', onGuide);
    root.addEventListener('mouseleave', onLeave);
    return () => {
      root.removeEventListener('dblclick', onDbl, true);
      root.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('mousedown', onDown, true);
      root.removeEventListener('mousemove', onGuide);
      root.removeEventListener('mouseleave', onLeave);
      stop();
    };
  }, [ws, index, onActivate]);

  // legend collapse button (like TradingView): below the price line, or below the indicator rows when open
  const mainInds = IND_KEYS.filter(k => INDS[k].main && s.indicators[k]?.on).length;
  const legendOpen = s.legendOpen !== false;
  const LEG_ROW = 20, LEG_TOP = 8;
  const legendBtnTop = LEG_TOP + 2 * LEG_ROW + 2;   // right under the price line (open: in the gap left for it)
  const fmtNy = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div ref={rootRef} className={`mc-pane-chart${active ? ' active' : ''}${ws.measureArmed() ? ' mc-measuring' : ''}`}>
      <div ref={boxRef} className="mc-chart" />
      {ws.replayPick() && guideX !== null && <div className="mc-guide" style={{ left: guideX }} />}
      {mainInds > 0 && (
        <button className={`mc-legend-btn${legendOpen ? '' : ' closed'}`} style={{ top: legendBtnTop }}
          onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ws.toggleLegend(); }}
          title={legendOpen ? 'Hide indicator legends' : `Show indicator legends (${mainInds})`} aria-label={legendOpen ? 'Hide indicator legends' : 'Show indicator legends'}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d={legendOpen ? 'M1.5 6.5 5 3l3.5 3.5' : 'M1.5 3.5 5 7l3.5-3.5'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {!legendOpen && <span>{mainInds}</span>}
        </button>
      )}
      {countdown && (
        <div className={`mc-countdown${countdown.up ? ' up' : ' down'}`} style={{ top: countdown.y, left: countdown.left, width: countdown.width }}
          title="Time left until this candle closes">{countdown.text}</div>
      )}
      {newsHover && s.news && (
        <div className={`mc-news-card${newsHover.flip ? ' flip' : ''}`} style={newsHover.flip ? { right: `calc(100% - ${newsHover.x - 8}px)` } : { left: newsHover.x + 8 }}>
          <div className="mc-news-when">{fmtNy(newsHover.g.ms)} New York{newsHover.g.ms > (ws.engine.active ? ws.engine.cursor : Date.now()) ? ' · upcoming' : ''}</div>
          {newsHover.g.events.slice(0, 4).map((e, i) => {
            const o = outlook(e, newsHover.price);
            return (
              <div key={i} className="mc-news-ev">
                <div className={`mc-news-title ${e.kind === 'headline' ? 'headline' : e.impact}`}>{e.title}</div>
                {(e.actual || e.forecast || e.previous) && <div className="mc-news-vals">{e.actual ? <>actual <b>{e.actual}</b> · </> : null}forecast {e.forecast ?? '—'} · previous {e.previous ?? '—'}</div>}
                {(i === 0 ? o.lines : o.lines.slice(0, 1)).map((l, k) => <div key={k} className="mc-news-line">{l}</div>)}
              </div>
            );
          })}
          {newsHover.g.events.length > 4 && <div className="mc-news-line">+{newsHover.g.events.length - 4} more at the same time</div>}
          {newsHover.move !== null && <div className={`mc-news-this ${newsHover.move >= 0 ? 'up' : 'down'}`}>This time: NQ {newsHover.move >= 0 ? '+' : ''}{newsHover.move.toFixed(2)} pts in the 15 min after</div>}
          <div className="mc-news-foot">From NQ's reactions to past releases. Odds, not a forecast.</div>
        </div>
      )}
    </div>
  );
}
