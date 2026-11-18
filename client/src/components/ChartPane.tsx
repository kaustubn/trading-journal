import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { init, dispose } from 'klinecharts';
import type { Chart, KLineData, DataLoaderGetBarsParams, DataLoadMore, Crosshair } from 'klinecharts';
import { registerChartIndicators, BgData, LevelsData } from '../chart/indicators';
import { registerDrawingOverlays } from '../chart/overlays';
import { chartStyles } from '../chart/theme';
import { TZ, sessionDay } from '../chart/time';
import { barTime } from '../chart/drawings';
import { DrawingController, DrawingStore } from '../chart/drawingController';
import { ReplayEngine, ReplayView } from '../chart/replay';
import { PANE, Settings, Meta, BarsResp, FocusTrade, toK, periodOf, syncIndicators, viewOf, barEnd } from '../chart/config';

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
  setHotkeys: (on: boolean) => void;
}

interface Props { index: number; tf: number; s: Settings; active: boolean; ws: Workspace; onActivate: (i: number) => void; }

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
      rolls: st.rolls ? ws.meta()?.rolls ?? [] : null,
      levels: levelsRef.current, show: st.levels,
    };
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
    };
    ws.panes.set(index, handle);
    ws.redraw();

    return () => {
      ws.panes.delete(index);
      ctl.dispose();
      ctlRef.current = null;
      viewRef.current = null;
      ro.disconnect();
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
    if (a.s.log !== s.log) chart.overrideYAxis({ paneId: PANE, name: s.log ? 'logarithm' : 'normal' });
    if (a.s.indicators !== s.indicators || a.tf !== tf || a.s.look !== s.look) syncIndicators(chart, s, tf);
    pushBg();
    if (a.s.levels !== s.levels || a.tf !== tf) { levelsAt.current = null; refreshLevels(); }
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

  return (
    <div ref={rootRef} className={`mc-pane-chart${active ? ' active' : ''}${ws.measureArmed() ? ' mc-measuring' : ''}`}>
      <div ref={boxRef} className="mc-chart" />
      {ws.replayPick() && guideX !== null && <div className="mc-guide" style={{ left: guideX }} />}
      {countdown && (
        <div className={`mc-countdown${countdown.up ? ' up' : ' down'}`} style={{ top: countdown.y, left: countdown.left, width: countdown.width }}
          title="Time left until this candle closes">{countdown.text}</div>
      )}
    </div>
  );
}
