import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { init, dispose } from 'klinecharts';
import type { Chart, KLineData, Period, DataLoaderGetBarsParams, DataLoadMore } from 'klinecharts';
import { registerChartIndicators, BgData, LevelsData } from '../chart/indicators';
import { chartStyles, Theme } from '../chart/theme';
import { Clock, TZ, wallToUtc, fmtWall, utcLabel } from '../chart/time';
import { registerDrawingOverlays } from '../chart/overlays';
import { DrawingController, DrawView, Magnet } from '../chart/drawingController';
import { Drawing, Tool, validDrawing } from '../chart/drawings';
import { DrawToolbar, DrawEditBar } from './DrawingTools';
import '../styles/MarketChart.css';

// Drawing shortcuts (TradingView's), matched on the physical key
const DRAW_KEYS: Record<string, Tool> = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyF: 'fib' };

// ---------- timeframes ----------
const TFS = [
  { m: 1, label: '1m' }, { m: 3, label: '3m' }, { m: 5, label: '5m' }, { m: 15, label: '15m' },
  { m: 30, label: '30m' }, { m: 60, label: '1h' }, { m: 240, label: '4h' }, { m: 1440, label: 'D' },
];
const tfLabel = (m: number) => TFS.find(t => t.m === m)?.label ?? `${m}m`;
function periodOf(m: number): Period {
  if (m >= 1440) return { type: 'day', span: 1 };
  if (m >= 60) return { type: 'hour', span: m / 60 };
  return { type: 'minute', span: m };
}
/** "5" -> 5, "60" / "1H" -> 60, "D" / "1D" -> 1440. Null when it is not a timeframe we have. */
function parseTfInput(text: string): number | null {
  const t = text.trim().toUpperCase();
  let m: number | null = null;
  if (/^\d+$/.test(t)) m = Number(t);
  else if (/^\d+M$/.test(t)) m = Number(t.slice(0, -1));
  else if (/^\d+H$/.test(t)) m = Number(t.slice(0, -1)) * 60;
  else if (/^1?D$/.test(t)) m = 1440;
  return m !== null && TFS.some(x => x.m === m) ? m : null;
}

// ---------- indicators ----------
type IndKey = 'EMA' | 'SMA' | 'VWAP' | 'BOLL' | 'VOL' | 'RSI' | 'ATR' | 'MACD';
interface IndDef { label: string; name: string; main: boolean; def: number[]; hint: string; min: number; max: number; }
const INDS: Record<IndKey, IndDef> = {
  EMA: { label: 'EMA', name: 'EMA', main: true, def: [9, 21], hint: 'Periods, e.g. 9, 21, 50', min: 1, max: 6 },
  SMA: { label: 'SMA', name: 'JC_SMA', main: true, def: [50, 200], hint: 'Periods, e.g. 50, 200', min: 1, max: 6 },
  VWAP: { label: 'VWAP', name: 'JC_VWAP', main: true, def: [], hint: 'Resets at the 6pm ET session open', min: 0, max: 0 },
  BOLL: { label: 'Bollinger Bands', name: 'BOLL', main: true, def: [20, 2], hint: 'Period, deviations', min: 2, max: 2 },
  VOL: { label: 'Volume', name: 'VOL', main: false, def: [20], hint: 'Average period', min: 1, max: 1 },
  RSI: { label: 'RSI', name: 'RSI', main: false, def: [14], hint: 'Period', min: 1, max: 1 },
  ATR: { label: 'ATR', name: 'JC_ATR', main: false, def: [14], hint: 'Period', min: 1, max: 1 },
  MACD: { label: 'MACD', name: 'MACD', main: false, def: [12, 26, 9], hint: 'Fast, slow, signal', min: 3, max: 3 },
};
const IND_KEYS = Object.keys(INDS) as IndKey[];

/** "9, 21" -> [9, 21]; null when the count or the values are not valid for that indicator. */
function parseParams(key: IndKey, text: string): number[] | null {
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

// ---------- settings (saved per user) ----------
interface Settings {
  tf: number; clock: Clock; theme: Theme;
  sessions: boolean; rth: boolean; log: boolean; rolls: boolean;
  levels: { pd: boolean; on: boolean; open: boolean; round: boolean };
  indicators: Record<IndKey, { on: boolean; params: number[] }>;
  magnet: Magnet; drawHidden: boolean; drawLocked: boolean;
}
const DEFAULTS: Settings = {
  tf: 5, clock: 'ET', theme: 'dark',
  sessions: true, rth: false, log: false, rolls: true,
  magnet: 'off', drawHidden: false, drawLocked: false,
  levels: { pd: true, on: true, open: true, round: false },
  indicators: IND_KEYS.reduce((acc, k) => {
    acc[k] = { on: k === 'VOL', params: INDS[k].def };
    return acc;
  }, {} as Settings['indicators']),
};
/** Saved settings may be partial, old or hand-edited: keep only what is valid. */
function mergeSettings(saved: any): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULTS));
  if (!saved || typeof saved !== 'object') return s;
  if (TFS.some(t => t.m === saved.tf)) s.tf = saved.tf;
  if (saved.clock === 'ET' || saved.clock === 'BC') s.clock = saved.clock;
  if (saved.theme === 'dark' || saved.theme === 'light') s.theme = saved.theme;
  for (const k of ['sessions', 'rth', 'log', 'rolls', 'drawHidden', 'drawLocked'] as const) if (typeof saved[k] === 'boolean') s[k] = saved[k];
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
  return s;
}

interface BarsResp { bars: [number, number, number, number, number, number][]; older: boolean; newer: boolean; }
interface Meta { first: number | null; last: number | null; count: number; rolls: { contract: string; from: number }[]; }
const toK = (b: BarsResp['bars'][number]): KLineData =>
  ({ timestamp: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });

const PANE = 'candle_pane';
const viewOf = (s: Settings): DrawView =>
  ({ tf: s.tf, rth: s.rth, magnet: s.magnet, hidden: s.drawHidden, lockAll: s.drawLocked });

function syncIndicators(chart: Chart, s: Settings) {
  for (const key of IND_KEYS) {
    const def = INDS[key], cfg = s.indicators[key];
    const paneId = def.main ? PANE : `jc_${key}`;
    const exists = chart.getIndicators({ name: def.name }).length > 0;
    const spec = { name: def.name, paneId, calcParams: cfg.params, extendData: { tfMin: s.tf } };
    if (cfg.on && !exists) chart.createIndicator(spec, def.main);
    else if (cfg.on) chart.overrideIndicator(spec);
    else if (exists) chart.removeIndicator({ name: def.name });
  }
}

export default function MarketChart({ token }: { token: string }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);       // saved settings + data range loaded
  const [fatal, setFatal] = useState('');          // page cannot work (e.g. not the owner)
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [panel, setPanel] = useState<null | 'ind' | 'levels' | 'goto'>(null);
  const [tfKeys, setTfKeys] = useState('');        // digits typed to switch timeframe
  const [target, setTarget] = useState<number | null>(null); // viewing a past date instead of the latest bars
  const [now, setNow] = useState(Date.now());
  const [paramText, setParamText] = useState<Record<string, string>>({});
  const [goDate, setGoDate] = useState('');
  const [goTime, setGoTime] = useState('09:30');
  const [, redraw] = useState(0);                  // drawing controller changed
  const [measureArmed, setMeasureArmed] = useState(false); // ruler button: next drag measures

  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<DrawingController | null>(null);
  const measureArmedRef = useRef(false);
  measureArmedRef.current = measureArmed;
  const chartRef = useRef<Chart | null>(null);
  const sRef = useRef<Settings>(DEFAULTS);
  const appliedRef = useRef<Settings | null>(null);
  const savedRef = useRef('');
  const metaRef = useRef<Meta | null>(null);
  const targetRef = useRef<{ ts: number; align: 'right' | 'center' } | null>(null);
  const loadSeq = useRef(0);
  const levelsRef = useRef<LevelsData | null>(null);
  const levelsAt = useRef<number | null>(null);
  const levelsTimer = useRef<number | undefined>(undefined);
  const tfKeysRef = useRef('');
  const panelRef = useRef<typeof panel>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  panelRef.current = panel;
  const auth = () => ({ headers: { Authorization: `Bearer ${tokenRef.current}` } });

  const update = useCallback((patch: Partial<Settings> | ((cur: Settings) => Settings)) => {
    setS(cur => (typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }));
  }, []);

  // ----- background layer (sessions, levels, rolls) -----
  const pushBg = useCallback(() => {
    const chart = chartRef.current, st = sRef.current;
    if (!chart) return;
    const extendData: BgData = {
      tfMin: st.tf, dark: st.theme === 'dark', sessions: st.sessions && !st.rth, // RTH is all New York: shading would cover everything
      rolls: st.rolls ? metaRef.current?.rolls ?? [] : null,
      levels: levelsRef.current, show: st.levels,
    };
    chart.overrideIndicator({ name: 'JC_BG', paneId: PANE, extendData });
  }, []);

  // Levels belong to the session at the right edge of the view. Fetched only once
  // scrolling settles, so dragging the chart does not fire a request per frame.
  const refreshLevels = useCallback(() => {
    window.clearTimeout(levelsTimer.current);
    levelsTimer.current = window.setTimeout(async () => {
      const chart = chartRef.current, st = sRef.current;
      if (!chart) return;
      const wanted = st.tf < 1440 && (st.levels.pd || st.levels.on || st.levels.open);
      const data = chart.getDataList();
      if (!wanted || !data.length) {
        levelsAt.current = null;
        if (levelsRef.current) { levelsRef.current = null; pushBg(); }
        return;
      }
      const idx = Math.max(0, Math.min(data.length, chart.getVisibleRange().to) - 1);
      const at = data[idx].timestamp + (st.tf - 1) * 60000; // last minute of the right-most bar
      const cur = levelsRef.current;
      // After the 9:30 open every level of a session is fixed, so nothing new to fetch
      if (cur && levelsAt.current !== null && at >= cur.nyStart && at < cur.end + 3600000 && levelsAt.current >= cur.nyStart) return;
      if (levelsAt.current === at) return;
      levelsAt.current = at;
      try {
        const r = await axios.get('/api/bars/levels', { ...auth(), params: { symbol: 'NQ', at } });
        if (levelsAt.current !== at) return;
        levelsRef.current = r.data.levels;
        pushBg();
      } catch { /* levels are optional: leave the last ones on screen */ }
    }, 450);
  }, [pushBg]);

  // ----- data loading -----
  // KLineChart naming: 'forward' asks for OLDER bars (left edge), 'backward' for NEWER ones.
  const loadBars = useCallback(async ({ type, timestamp, callback }: DataLoaderGetBarsParams) => {
    const st = sRef.current;
    const seq = type === 'init' ? ++loadSeq.current : loadSeq.current;
    const get = (p: Record<string, unknown>) => axios.get<BarsResp>('/api/bars', {
      ...auth(), params: { symbol: 'NQ', tf: st.tf === 1440 ? 'D' : st.tf, rth: st.rth ? 1 : undefined, ...p },
    }).then(r => r.data);
    if (type === 'init') setBusy(true);
    try {
      let bars: BarsResp['bars'] = [];
      let more: DataLoadMore = false;
      const tgt = targetRef.current;
      if (type === 'init' && tgt) {
        // Bars from the target on, then the bars before the first of those: both pages
        // are bucket-aligned, so no candle is built from part of its time span.
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
      // The timeframe or date changed while this was in flight: the chart has already
      // started a fresh load, so this answer must not be drawn.
      if (seq !== loadSeq.current) return;
      callback(bars.map(toK), more);
      setError('');
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
          chart.scrollToDataIndex(idx);
        }
        levelsAt.current = null;
        refreshLevels();
      }
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      callback([], false);
      setError(e?.response?.status === 429
        ? 'Too many requests — wait a few seconds and scroll again.'
        : 'Could not load price data. Check your connection and try again.');
    } finally {
      if (type === 'init' && seq === loadSeq.current) setBusy(false);
    }
  }, [refreshLevels]);

  // ----- load saved settings + data range -----
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          axios.get('/api/chart/settings', auth()),
          axios.get<Meta>('/api/bars/meta', auth()),
        ]);
        if (dead) return;
        const merged = mergeSettings(a.data.settings);
        savedRef.current = JSON.stringify(merged);
        sRef.current = merged;
        metaRef.current = b.data;
        setS(merged);
        setMeta(b.data);
      } catch (e: any) {
        if (dead) return;
        setFatal(e?.response?.status === 403
          ? 'The market chart is available to the account owner only.'
          : 'Could not load the chart. Reload the page to try again.');
      } finally {
        if (!dead) setReady(true);
      }
    })();
    return () => { dead = true; };
  }, []);

  // ----- create the chart -----
  useEffect(() => {
    const box = boxRef.current;
    if (!ready || fatal || !box) return;
    registerChartIndicators();
    const st = sRef.current;
    const chart = init(box, { timezone: TZ[st.clock], styles: st.theme, locale: 'en-US' });
    if (!chart) { setFatal('The chart could not start in this browser.'); return; }
    chartRef.current = chart;
    appliedRef.current = st;
    chart.setStyles(chartStyles(st.theme));
    chart.setSymbol({ ticker: 'NQ', pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(periodOf(st.tf));
    chart.createIndicator({ name: 'JC_BG', paneId: PANE }, true);
    pushBg();
    syncIndicators(chart, st);
    if (st.log) chart.overrideYAxis({ paneId: PANE, name: 'logarithm' });
    chart.setDataLoader({ getBars: loadBars });
    chart.subscribeAction('onVisibleRangeChange', refreshLevels);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(box);

    // Drawings: saved as one list per symbol, a moment after each change
    registerDrawingOverlays();
    let saveTimer: number | undefined;
    let pending: Drawing[] | null = null;
    const flush = () => {
      window.clearTimeout(saveTimer);
      if (!pending) return;
      const list = pending;
      pending = null;
      axios.put('/api/chart/drawings', { drawings: list }, { ...auth(), params: { symbol: 'NQ' } })
        .catch(() => setError('Drawings could not be saved. Check your connection — your next change will retry.'));
    };
    const ctl = new DrawingController(chart, viewOf(st),
      list => { pending = list; window.clearTimeout(saveTimer); saveTimer = window.setTimeout(flush, 700); },
      () => redraw(n => n + 1));
    ctlRef.current = ctl;
    axios.get('/api/chart/drawings', { ...auth(), params: { symbol: 'NQ' } })
      .then(r => { if (ctlRef.current === ctl) ctl.load((r.data.drawings || []).filter(validDrawing)); })
      .catch(() => { if (ctlRef.current === ctl) setError('Your drawings could not be loaded. Reload the page to try again.'); });

    return () => {
      flush();
      ctlRef.current = null;
      ro.disconnect();
      window.clearTimeout(levelsTimer.current);
      loadSeq.current++; // drop any answer still in flight
      dispose(box);
      chartRef.current = null;
      appliedRef.current = null;
    };
  }, [ready, fatal, loadBars, pushBg, refreshLevels]);

  // ----- apply setting changes to the chart, then save them -----
  useEffect(() => {
    sRef.current = s;
    const chart = chartRef.current, a = appliedRef.current;
    if (chart && a && a !== s) {
      if (a.tf !== s.tf) {
        // Keep looking at the same moment when the timeframe changes
        const data = chart.getDataList();
        const vr = chart.getVisibleRange();
        const atEnd = !data.length || vr.to >= data.length;
        if (!atEnd && !(targetRef.current && targetRef.current.align === 'center' && vr.to >= data.length)) {
          targetRef.current = { ts: data[Math.max(0, vr.to - 1)].timestamp, align: 'right' };
          setTarget(targetRef.current.ts);
        }
        chart.setPeriod(periodOf(s.tf));
      } else if (a.rth !== s.rth) {
        chart.resetData();
      }
      if (a.clock !== s.clock) chart.setTimezone(TZ[s.clock]);
      if (a.theme !== s.theme) { chart.setStyles(s.theme); chart.setStyles(chartStyles(s.theme)); }
      if (a.log !== s.log) chart.overrideYAxis({ paneId: PANE, name: s.log ? 'logarithm' : 'normal' });
      if (a.indicators !== s.indicators || a.tf !== s.tf) syncIndicators(chart, s);
      pushBg();
      if (a.levels !== s.levels || a.tf !== s.tf) { levelsAt.current = null; refreshLevels(); }
      ctlRef.current?.setView(viewOf(s));
      appliedRef.current = s;
    }
    if (!ready || fatal) return;
    const json = JSON.stringify(s);
    if (json === savedRef.current) return;
    const t = window.setTimeout(() => {
      axios.put('/api/chart/settings', { settings: s }, auth())
        .then(() => { savedRef.current = json; })
        .catch(() => { /* not saved this time; the next change retries */ });
    }, 800);
    return () => window.clearTimeout(t);
  }, [s, ready, fatal, pushBg, refreshLevels]);

  // ----- go to date / back to latest -----
  const goTo = (ts: number) => {
    targetRef.current = { ts, align: 'center' };
    setTarget(ts);
    setPanel(null);
    chartRef.current?.resetData();
  };
  const goLatest = () => {
    targetRef.current = null;
    setTarget(null);
    chartRef.current?.resetData();
  };
  const submitGoTo = (e: React.FormEvent) => {
    e.preventDefault();
    const ts = wallToUtc(goDate, goTime, s.clock);
    if (!Number.isNaN(ts)) goTo(ts);
  };
  const openGoTo = () => {
    const base = target ?? metaRef.current?.last ?? Date.now();
    const w = fmtWall(base, sRef.current.clock);
    setGoDate(w.slice(0, 10));
    setPanel('goto');
  };

  // ----- keyboard: type a number + Enter to change timeframe, Alt+G to go to a date -----
  useEffect(() => {
    const setKeys = (v: string) => { tfKeysRef.current = v; setTfKeys(v); };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      const ctl = ctlRef.current;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const tool: Tool | undefined = e.shiftKey ? (e.code === 'KeyR' ? 'rect' : undefined) : DRAW_KEYS[e.code];
        if (e.code === 'KeyG' && !e.shiftKey) { e.preventDefault(); openGoTo(); return; }
        if (tool && ctl) { e.preventDefault(); setMeasureArmed(false); ctl.start(tool); return; }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ctl) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); ctl.undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); ctl.redo(); return; }
      }
      if (e.ctrlKey || e.metaKey) return;
      if (panelRef.current) { if (e.key === 'Escape') setPanel(null); return; }
      const cur = tfKeysRef.current;
      if (!cur && ctl) {
        if (e.key === 'Escape' && (ctl.active || ctl.hasMeasure || measureArmedRef.current || ctl.selected)) {
          ctl.cancel(); ctl.clearMeasure(); setMeasureArmed(false); ctl.select(null);
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && ctl.selected) { e.preventDefault(); ctl.remove(ctl.selected); return; }
      }
      if (/^\d$/.test(e.key)) { setKeys((cur + e.key).slice(0, 4)); e.preventDefault(); }
      else if (/^[dhm]$/i.test(e.key) && /^\d*$/.test(cur) && (cur || /d/i.test(e.key))) { setKeys(cur + e.key.toUpperCase()); e.preventDefault(); }
      else if (!cur) return;
      else if (e.key === 'Backspace') { setKeys(cur.slice(0, -1)); e.preventDefault(); }
      else if (e.key === 'Escape') setKeys('');
      else if (e.key === 'Enter') {
        const m = parseTfInput(cur);
        if (m !== null) { update({ tf: m }); setKeys(''); }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update]);

  // ----- clock, fullscreen -----
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onFs = () => { setFull(document.fullscreenElement === rootRef.current); chartRef.current?.resize(); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.();
  };

  // ----- measure: Shift + drag (or the ruler button, then drag or click-click) -----
  // Runs in the capture phase so the chart does not also start panning.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
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
      if (dragged) { stop(); ctlRef.current?.endMeasure(); setMeasureArmed(false); }
      else { follow = true; window.removeEventListener('mouseup', onUp, true); }
    };
    const onDown = (e: MouseEvent) => {
      const ctl = ctlRef.current;
      if (!ctl || e.button !== 0) return;
      if (follow) {
        // second click of click-move-click
        follow = false;
        e.stopPropagation(); e.preventDefault();
        stop(); ctl.endMeasure(); setMeasureArmed(false);
        return;
      }
      if (!(e.shiftKey || measureArmedRef.current) || ctl.active) {
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
    stage.addEventListener('mousedown', onDown, true);
    return () => { stage.removeEventListener('mousedown', onDown, true); stop(); };
  }, [ready, fatal]);

  // Auto-fit the price scale again after it was dragged (same as double-clicking it)
  const autoScale = () => {
    chartRef.current?.overrideYAxis({ paneId: PANE, name: s.log ? 'logarithm' : 'normal' });
    chartRef.current?.resize();
  };

  // ----- indicator panel -----
  const toggleInd = (key: IndKey) => update(cur => ({
    ...cur, indicators: { ...cur.indicators, [key]: { ...cur.indicators[key], on: !cur.indicators[key].on } },
  }));
  const commitParams = (key: IndKey) => {
    const text = paramText[key];
    if (text === undefined) return;
    const params = parseParams(key, text);
    if (!params) return; // stays red until fixed
    update(cur => ({ ...cur, indicators: { ...cur.indicators, [key]: { ...cur.indicators[key], params } } }));
    setParamText(p => { const n = { ...p }; delete n[key]; return n; });
  };
  const setLevel = (k: keyof Settings['levels']) => update(cur => ({ ...cur, levels: { ...cur.levels, [k]: !cur.levels[k] } }));

  if (fatal) return <div className="mc-fatal">{fatal}</div>;

  const typed = tfKeys ? parseTfInput(tfKeys) : null;
  const activeInds = IND_KEYS.filter(k => s.indicators[k].on).length;

  return (
    <div ref={rootRef} className={`mc-root mc-${s.theme}${full ? ' mc-full' : ''}`}>
      <div className="mc-top">
        <span className="mc-sym">NQ</span>
        <span className="mc-sym-sub">E-mini Nasdaq-100 · CME</span>
        <span className="mc-sep" />
        {TFS.map(t => (
          <button key={t.m} className={`mc-btn mc-tf${s.tf === t.m ? ' on' : ''}`} onClick={() => update({ tf: t.m })}
            title={`${t.label} — or type ${t.m === 1440 ? 'D' : t.m} and press Enter`}>{t.label}</button>
        ))}
        <span className="mc-sep" />
        <button className={`mc-btn${panel === 'ind' ? ' open' : ''}`} onClick={() => setPanel(panel === 'ind' ? null : 'ind')}>
          Indicators{activeInds ? <span className="mc-count">{activeInds}</span> : null}
        </button>
        <button className={`mc-btn${s.sessions ? ' on' : ''}`} onClick={() => update({ sessions: !s.sessions })}
          title="Shade Asia (6pm–2am), London (2–9:30am) and New York (9:30am–4pm ET). Shown on 1h and below.">Sessions</button>
        <button className={`mc-btn${s.rth ? ' on' : ''}`} onClick={() => update({ rth: !s.rth })}
          title={s.rth ? 'Showing regular trading hours only (9:30am–4pm ET). Click for the full session.' : 'Showing the full session. Click for regular trading hours only (9:30am–4pm ET).'}>
          {s.rth ? 'RTH' : 'ETH'}
        </button>
        <button className={`mc-btn${panel === 'levels' ? ' open' : ''}`} onClick={() => setPanel(panel === 'levels' ? null : 'levels')}>Levels</button>
        <span className="mc-grow" />
        <button className="mc-btn" disabled={!ctlRef.current?.canUndo} onClick={() => ctlRef.current?.undo()} title="Undo (Ctrl+Z)">↶</button>
        <button className="mc-btn" disabled={!ctlRef.current?.canRedo} onClick={() => ctlRef.current?.redo()} title="Redo (Ctrl+Y)">↷</button>
        <span className="mc-sep" />
        <button className="mc-btn" onClick={openGoTo} title="Go to a date and time (Alt+G)">Go to…</button>
        {target !== null && <button className="mc-btn mc-accent" onClick={goLatest} title="Back to the most recent bars">Latest »</button>}
        <button className="mc-btn" onClick={() => update({ theme: s.theme === 'dark' ? 'light' : 'dark' })}
          title={s.theme === 'dark' ? 'Switch to light chart' : 'Switch to dark chart'}>{s.theme === 'dark' ? '☀' : '☾'}</button>
        <button className="mc-btn" onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen'}>{full ? '🗗' : '⛶'}</button>
      </div>

      <div className="mc-body">
        <DrawToolbar ctl={ctlRef.current} magnet={s.magnet} hidden={s.drawHidden} lockAll={s.drawLocked}
          measureArmed={measureArmed}
          onMagnet={m => update({ magnet: m })} onHidden={v => update({ drawHidden: v })}
          onLockAll={v => update({ drawLocked: v })} onMeasure={setMeasureArmed} />
        <div ref={stageRef} className={`mc-stage${measureArmed ? ' mc-measuring' : ''}`}>
        <div ref={boxRef} className="mc-chart" />
        <DrawEditBar ctl={ctlRef.current} />
        {busy && <div className="mc-busy">Loading…</div>}
        {error && <div className="mc-error">{error}</div>}

        {tfKeys && (
          <div className="mc-tfpop">
            <div className="mc-tfpop-title">Change interval</div>
            <div className="mc-tfpop-keys">{tfKeys}</div>
            <div className={`mc-tfpop-hint${typed === null ? ' bad' : ''}`}>
              {typed !== null ? `${tfLabel(typed)} — press Enter` : 'Not available'}
            </div>
          </div>
        )}

        {panel === 'ind' && (
          <div className="mc-panel mc-panel-ind">
            <div className="mc-panel-title">Indicators</div>
            {IND_KEYS.map(k => {
              const def = INDS[k], cfg = s.indicators[k];
              const text = paramText[k] ?? cfg.params.join(', ');
              const bad = paramText[k] !== undefined && parseParams(k, paramText[k]) === null;
              return (
                <div key={k} className="mc-row">
                  <label className="mc-check">
                    <input type="checkbox" checked={cfg.on} onChange={() => toggleInd(k)} />
                    <span>{def.label}</span>
                  </label>
                  {def.max > 0 ? (
                    <input className={`mc-input${bad ? ' bad' : ''}`} value={text} placeholder={def.hint} title={def.hint}
                      onChange={e => setParamText(p => ({ ...p, [k]: e.target.value }))}
                      onBlur={() => commitParams(k)}
                      onKeyDown={e => { if (e.key === 'Enter') commitParams(k); }} />
                  ) : <span className="mc-hint">{def.hint}</span>}
                </div>
              );
            })}
          </div>
        )}

        {panel === 'levels' && (
          <div className="mc-panel mc-panel-levels">
            <div className="mc-panel-title">Levels</div>
            {([['pd', 'Previous day high / low / close'], ['on', 'Overnight high / low (6pm–9:30am ET)'],
              ['open', 'Session open (6pm) and NY open (9:30am)'], ['round', 'Round numbers']] as const).map(([k, label]) => (
              <label key={k} className="mc-check mc-row">
                <input type="checkbox" checked={s.levels[k]} onChange={() => setLevel(k)} />
                <span>{label}</span>
              </label>
            ))}
            <label className="mc-check mc-row">
              <input type="checkbox" checked={s.rolls} onChange={() => update({ rolls: !s.rolls })} />
              <span>Contract roll dates</span>
            </label>
            <div className="mc-hint">Previous day = the full 6pm–5pm ET session. Levels follow the day at the right edge of the chart.</div>
          </div>
        )}

        {panel === 'goto' && (
          <form className="mc-panel mc-panel-goto" onSubmit={submitGoTo}>
            <div className="mc-panel-title">Go to ({s.clock} time)</div>
            <div className="mc-row">
              <input className="mc-input" type="date" value={goDate} onChange={e => setGoDate(e.target.value)} required autoFocus
                min={meta?.first ? fmtWall(meta.first, s.clock).slice(0, 10) : undefined}
                max={meta?.last ? fmtWall(meta.last, s.clock).slice(0, 10) : undefined} />
              <input className="mc-input" type="time" value={goTime} onChange={e => setGoTime(e.target.value)} />
            </div>
            <div className="mc-row mc-row-end">
              <button type="button" className="mc-btn" onClick={() => setPanel(null)}>Cancel</button>
              <button type="submit" className="mc-btn mc-primary">Go</button>
            </div>
          </form>
        )}
        </div>
      </div>

      <div className="mc-bottom">
        {meta?.first && meta?.last ? (
          <span className="mc-dim" title="Range of price data stored in the journal">
            Data {fmtWall(meta.first, s.clock).slice(0, 10)} → {fmtWall(meta.last, s.clock)} {s.clock}
          </span>
        ) : null}
        <span className="mc-grow" />
        <span className="mc-dim">{fmtWall(now, s.clock, true).slice(11)} ({utcLabel(now, s.clock)})</span>
        <div className="mc-seg" title="Chart clock: New York time or BC time">
          {(['ET', 'BC'] as Clock[]).map(c => (
            <button key={c} className={s.clock === c ? 'on' : ''} onClick={() => update({ clock: c })}>{c}</button>
          ))}
        </div>
        <button className={`mc-btn mc-small${s.log ? ' on' : ''}`} onClick={() => update({ log: !s.log })} title="Logarithmic price scale">log</button>
        <button className="mc-btn mc-small" onClick={autoScale} title="Fit the price scale to the visible bars (or double-click the price scale)">auto</button>
      </div>
    </div>
  );
}
