import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Clock, TZ, wallToUtc, fmtWall, utcLabel, sessionDay } from '../chart/time';
import DayNotes from './DayNotes';
import DataPanel from './DataPanel';
import ChartPane, { Workspace } from './ChartPane';
import TvPane from './TvPane';
import { DrawingStore } from '../chart/drawingController';
import { Drawing, Tool, validDrawing, fmtUsd } from '../chart/drawings';
import { DrawToolbar, DrawEditBar } from './DrawingTools';
import { ReplayEngine, ClosedTrade } from '../chart/replay';
import ReplayBar, { CoachHooks } from './ReplayBar';
import CoachPanel, { CoachMsg, Verdict } from './CoachPanel';
import { checkOrder, checkAfterClose, CoachRules } from '../chart/coach';
import { buildContext, PaneData } from '../chart/coachContext';
import type { KLineData } from 'klinecharts';
import type { OrderInput } from '../chart/replay';
import {
  TFS, tfLabel, parseTfInput, INDS, IND_KEYS, IndKey, parseParams, Settings, DEFAULTS, mergeSettings,
  Meta, BarsResp, toK, FocusTrade, LAYOUTS, LayoutMode, layoutCount, PaneSource,
} from '../chart/config';
import '../styles/MarketChart.css';

// Drawing shortcuts (TradingView's), matched on the physical key
const DRAW_KEYS: Record<string, Tool> = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyF: 'fib' };

interface LiveStatus { configured: boolean; delayMin: number | null; message?: string; }

export default function MarketChart({ token, focus }: { token: string; focus?: { tradeId: number; nonce: number } | null }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);       // saved settings + data range loaded
  const [fatal, setFatal] = useState('');          // page cannot work (e.g. not the owner)
  const [error, setErrorState] = useState('');
  const [busyPanes, setBusyPanes] = useState<Record<number, boolean>>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [panel, setPanel] = useState<null | 'ind' | 'levels' | 'goto' | 'replay' | 'data' | 'layout'>(null);
  const [tfKeys, setTfKeys] = useState('');        // digits typed to switch timeframe
  const [target, setTarget] = useState<number | null>(null); // viewing a past date instead of the latest bars
  const [now, setNow] = useState(Date.now());
  const [paramText, setParamText] = useState<Record<string, string>>({});
  const [goDate, setGoDate] = useState('');
  const [goTime, setGoTime] = useState('09:30');
  const [, setTick] = useState(0);                 // shared objects (drawings, replay) changed
  const redraw = useCallback(() => setTick(n => n + 1), []);
  const [measureArmed, setMeasureArmedState] = useState(false);
  const [replayPick, setReplayPickState] = useState(false);
  const [accounts, setAccounts] = useState<{ id: number; account_name: string }[]>([]);
  const [replayAcct, setReplayAcct] = useState<number | null>(null);
  const [focusTrade, setFocusTrade] = useState<FocusTrade | null>(null);
  const [chartDates, setChartDates] = useState<Record<number, string>>({});
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachMsgs, setCoachMsgs] = useState<CoachMsg[]>([]);
  const [coachBusy, setCoachBusy] = useState(false);
  const [widen, setWiden] = useState<{ prev: number } | null>(null); // stop was widened: put it back or log it

  const rootRef = useRef<HTMLDivElement>(null);
  const sRef = useRef<Settings>(DEFAULTS);
  const savedRef = useRef('');
  const metaRef = useRef<Meta | null>(null);
  const tokenRef = useRef(token);
  const tfKeysRef = useRef('');
  const panelRef = useRef<typeof panel>(null);
  const measureArmedRef = useRef(false);
  const replayPickRef = useRef(false);
  const replayAcctRef = useRef<number | null>(null);
  tokenRef.current = token;
  panelRef.current = panel;
  replayAcctRef.current = replayAcct;
  sRef.current = s;
  const auth = () => ({ headers: { Authorization: `Bearer ${tokenRef.current}` } });

  const setMeasureArmed = (v: boolean) => { measureArmedRef.current = v; setMeasureArmedState(v); };
  const setReplayPick = (v: boolean) => { replayPickRef.current = v; setReplayPickState(v); };
  const setError = (msg: string) => setErrorState(msg);

  // ----- shared objects: drawings, replay clock, and the workspace handed to every window -----
  const saveRef = useRef<{ timer?: number; pending: Drawing[] | null }>({ pending: null });
  const flushDrawings = () => {
    const sv = saveRef.current;
    window.clearTimeout(sv.timer);
    if (!sv.pending) return;
    const list = sv.pending;
    sv.pending = null;
    axios.put('/api/chart/drawings', { drawings: list }, { ...auth(), params: { symbol: 'NQ' } })
      .catch(() => setError('Drawings could not be saved. Check your connection — your next change will retry.'));
  };
  const store = useMemo(() => new DrawingStore(list => {
    const sv = saveRef.current;
    sv.pending = list;
    window.clearTimeout(sv.timer);
    sv.timer = window.setTimeout(flushDrawings, 700);
  }), []);

  const saveTradeRef = useRef<(t: ClosedTrade) => void>(() => {});
  const closedRef = useRef<(t: ClosedTrade) => void>(() => {});
  const widenRef = useRef<(prev: number) => void>(() => {});
  const wsRef = useRef<Workspace | null>(null);
  const panesOf = () => [...(wsRef.current?.panes.values() ?? [])];
  const engine = useMemo(() => new ReplayEngine({
    fetch1m: (after, limit) => axios.get<BarsResp>('/api/bars', { ...auth(), params: { symbol: 'NQ', tf: 1, after, limit } })
      .then(r => r.data.bars.map(toK)),
    rth: () => sRef.current.rth,
    stepTf: () => sRef.current.panes[sRef.current.active]?.tf ?? 5,
    onReset: () => panesOf().forEach(p => p.reset()),
    onMinute: k => panesOf().forEach(p => p.onMinute(k)),
    onOverlays: () => panesOf().forEach(p => p.drawReplay()),
    onChange: () => setTick(n => n + 1),
    onClosed: t => { saveTradeRef.current(t); closedRef.current(t); },
    onStopWidened: prev => widenRef.current(prev),
  }), []);

  if (!wsRef.current) {
    wsRef.current = {
      auth,
      settings: () => sRef.current,
      meta: () => metaRef.current,
      store, engine,
      target: null, focus: null,
      measureArmed: () => measureArmedRef.current,
      setMeasureArmed: v => setMeasureArmed(v),
      replayPick: () => replayPickRef.current,
      startReplay: t => startReplayRef.current(t),
      redraw,
      setError: msg => setError(msg),
      setBusy: (i, b) => setBusyPanes(cur => (cur[i] === b ? cur : { ...cur, [i]: b })),
      onChartDate: (i, day) => setChartDates(cur => (cur[i] === day ? cur : { ...cur, [i]: day })),
      panes: new Map(),
    };
  }
  const ws = wsRef.current;
  const startReplayRef = useRef<(t: number) => void>(() => {});
  const count = layoutCount(s.layout);
  const activeIdx = Math.min(s.active, count - 1);
  const activePane = ws.panes.get(activeIdx) ?? null;
  const ctl = activePane?.ctl ?? null;

  const update = useCallback((patch: Partial<Settings> | ((cur: Settings) => Settings)) => {
    setS(cur => (typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }));
  }, []);
  const setPane = (i: number, patch: Partial<{ tf: number; src: PaneSource }>) =>
    update(cur => ({ ...cur, panes: cur.panes.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const setActive = useCallback((i: number) => {
    if (sRef.current.active !== i) update({ active: i });
  }, [update]);

  // ----- load saved settings, data range and drawings -----
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
        axios.get('/api/chart/drawings', { ...auth(), params: { symbol: 'NQ' } })
          .then(r => { if (!dead) store.load((r.data.drawings || []).filter(validDrawing)); })
          .catch(() => { if (!dead) setError('Your drawings could not be loaded. Reload the page to try again.'); });
      } catch (e: any) {
        if (dead) return;
        setFatal(e?.response?.status === 403
          ? 'The market chart is available to the account owner only.'
          : 'Could not load the chart. Reload the page to try again.');
      } finally {
        if (!dead) setReady(true);
      }
    })();
    return () => {
      dead = true;
      // leaving the page mid-replay: an open position is closed at the current price and logged
      if (engine.active && engine.position) engine.closeAtMarket('end');
      engine.pause();
      flushDrawings();
    };
  }, []);

  // ----- save settings a moment after they change -----
  useEffect(() => {
    if (!ready || fatal) return;
    const json = JSON.stringify(s);
    if (json === savedRef.current) return;
    const t = window.setTimeout(() => {
      axios.put('/api/chart/settings', { settings: s }, auth())
        .then(() => { savedRef.current = json; })
        .catch(() => { /* not saved this time; the next change retries */ });
    }, 800);
    return () => window.clearTimeout(t);
  }, [s, ready, fatal]);

  // ----- go to date / back to latest (all windows) -----
  const resetAll = () => panesOf().forEach(p => p.reset());
  const goTo = (ts: number) => {
    ws.target = { ts, align: 'center' };
    setTarget(ts);
    setPanel(null);
    resetAll();
  };
  const goLatest = () => {
    ws.target = null;
    setTarget(null);
    resetAll();
  };
  /** New bars were stored (update or upload): refresh the data range and the windows showing the latest bars. */
  const dataChanged = () => {
    axios.get<Meta>('/api/bars/meta', auth()).then(r => { metaRef.current = r.data; setMeta(r.data); }).catch(() => {});
    if (!engine.active && !ws.target) resetAll();
  };
  const submitGoTo = (e: React.FormEvent) => {
    e.preventDefault();
    const ts = wallToUtc(goDate, goTime, s.clock);
    if (!Number.isNaN(ts)) goTo(ts);
  };
  const openGoTo = () => {
    if (engine.active) return; // replay moves with its own controls
    const base = target ?? metaRef.current?.last ?? Date.now();
    setGoDate(fmtWall(base, sRef.current.clock).slice(0, 10));
    setPanel('goto');
  };

  // ----- near-live: new bars from Databento once a minute while the page is open -----
  useEffect(() => {
    if (!ready || fatal || !s.live) return;
    let dead = false;
    const tick = async () => {
      if (dead || engine.active || document.visibilityState !== 'visible') return;
      try {
        const r = await axios.get('/api/bars/live', auth());
        if (dead) return;
        const st: LiveStatus = { configured: !!r.data.configured, delayMin: r.data.delayMin ?? null, message: r.data.message };
        setLive(st);
        const last = Number(r.data.last) || 0;
        if (last && (!metaRef.current?.last || last > metaRef.current.last)) {
          metaRef.current = { ...(metaRef.current as Meta), last };
          setMeta(m => (m ? { ...m, last } : m));
          if (!ws.target) panesOf().forEach(p => { void p.appendLatest(); });
        }
      } catch { /* try again next minute */ }
    };
    void tick();
    const t = window.setInterval(tick, 60000);
    return () => { dead = true; window.clearInterval(t); };
  }, [ready, fatal, s.live]);

  // ----- bar replay -----
  const loadAccounts = async () => {
    try {
      const r = await axios.get('/api/accounts', auth());
      const list: { id: number; account_name: string }[] = r.data?.data || [];
      setAccounts(list);
      const bt = list.find(a => /^backtesting$/i.test(a.account_name.trim())) ?? list.find(a => /backtest/i.test(a.account_name));
      setReplayAcct(cur => cur ?? bt?.id ?? null);
    } catch { /* the bar shows "Save to…" and trades are marked not saved */ }
  };
  const startReplay = async (t: number) => {
    setReplayPick(false); setPanel(null);
    ws.target = null; setTarget(null);
    panesOf().forEach(p => { p.ctl.cancel(); p.ctl.clearMeasure(); p.setHotkeys(false); });
    setMeasureArmed(false);
    if (!accounts.length) loadAccounts();
    await engine.start(t); // resets every window around the replay cursor
    if (!engine.active) panesOf().forEach(p => p.setHotkeys(true));
  };
  startReplayRef.current = startReplay;
  const exitReplay = () => {
    engine.exit();
    panesOf().forEach(p => { p.setHotkeys(true); p.reset(); });
  };
  /** A random weekday at 9:00am ET — half an hour before the New York open. */
  const randomReplay = () => {
    const m = metaRef.current;
    if (!m?.first || !m?.last) return;
    const DAY = 86400000;
    for (let i = 0; i < 50; i++) {
      const day = fmtWall(m.first + 3 * DAY + Math.random() * (m.last - m.first - 5 * DAY), 'ET').slice(0, 10);
      const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      startReplay(wallToUtc(day, '09:00', 'ET'));
      return;
    }
  };
  saveTradeRef.current = (t: ClosedTrade) => {
    const account = replayAcctRef.current;
    if (!account) { engine.markSaved(t.id, 'failed', 'Choose the journal account to save replay trades to.'); return; }
    engine.markSaved(t.id, 'pending');
    axios.post('/api/replay/trades', {
      account_id: account, client_id: t.id, symbol: t.contract, side: t.side, quantity: t.qty,
      entry_price: t.entry, exit_price: t.exit, stop_loss: t.stop, target: t.target,
      entry_time: new Date(t.entryTime).toISOString(), exit_time: new Date(t.exitTime).toISOString(),
      exit_reason: t.reason, timeframe: tfLabel(t.tf), setup_tag: t.setup || undefined, notes: t.notes || undefined,
      rule_breaks: t.ruleBreaks.length ? t.ruleBreaks : undefined,
    }, auth())
      .then(() => engine.markSaved(t.id, 'saved'))
      .catch(err => engine.markSaved(t.id, 'failed', err?.response?.data?.error || 'Could not reach the server.'));
  };

  // ----- Coach: your own rules checked instantly, Claude on request or on every trade -----
  const msgSeq = useRef(0);
  const coachNow = () => (engine.active && engine.cursor ? engine.cursor + 60000 : Date.now());
  const note = (from: CoachMsg['from'], text: string, verdict?: Verdict) =>
    setCoachMsgs(m => [...m.slice(-79), { id: ++msgSeq.current, at: coachNow(), from, text, verdict }]);
  const setCoachRules = (r: CoachRules) => update(cur => ({ ...cur, coach: r }));
  /** Candles on the open journal windows, left to right (TradingView windows are not readable). */
  const paneData = (): PaneData[] => {
    const cur = sRef.current;
    return panesOf()
      .filter(p => p.index < layoutCount(cur.layout) && cur.panes[p.index]?.src !== 'tv')
      .sort((a, b) => a.index - b.index)
      .map(p => ({ tf: p.tf(), bars: (p.chart.getDataList() as KLineData[]).slice(-300) }));
  };
  const askClaude = async (kind: 'entry' | 'exit' | 'ask', o: { question?: string; order?: OrderInput; checks?: string[]; trade?: ClosedTrade } = {}) => {
    setCoachOpen(true);
    setCoachBusy(true);
    try {
      const at = coachNow();
      const levels = await axios.get('/api/bars/levels', { ...auth(), params: { symbol: 'NQ', at } })
        .then(r => r.data.levels).catch(() => null);
      const context = buildContext({
        mode: engine.active ? 'replay' : 'live', now: at, panes: paneData(), levels, rules: sRef.current.coach,
        engine: engine.active ? engine : null, order: o.order ?? null, ruleChecks: o.checks, trade: o.trade ?? null,
      });
      const r = await axios.post('/api/coach/replay', { kind, question: o.question, context }, auth());
      const verdict = (r.data.verdict || 'INFO') as Verdict;
      note('claude', r.data.text || '(no answer)', verdict);
      return { verdict, text: String(r.data.text || '') };
    } catch (err: any) {
      note('error', err?.response?.data?.error || 'Could not reach Claude.');
      return null;
    } finally {
      setCoachBusy(false);
    }
  };
  const coachHooks: CoachHooks = {
    rules: s.coach,
    check: o => checkOrder(sRef.current.coach, o, coachNow(), engine.trades),
    review: (o, checks) => askClaude('entry', { order: o, checks }),
    note: (from, text, verdict) => { note(from, text, verdict); if (from !== 'claude') setCoachOpen(true); },
  };
  closedRef.current = (t: ClosedTrade) => {
    const r = sRef.current.coach;
    if (!r.enabled) return;
    const stop = checkAfterClose(r, t.exitTime, engine.trades);
    if (stop.length) {
      note('rule', stop.join('\n'));
      setCoachOpen(true);
      if (r.pauseOnBreak) engine.pause();
    }
    if (r.ai === 'trades') askClaude('exit', { trade: t }).then(res => { if (res?.verdict === 'STOP') engine.pause(); });
  };
  widenRef.current = (prev: number) => {
    const r = sRef.current.coach;
    if (!r.enabled || !r.noWidenStop) return;
    engine.pause();
    setWiden({ prev });
  };
  const keepWidened = () => {
    const p = engine.position;
    if (p && widen) {
      const text = `Widened the stop from ${widen.prev} to ${p.stop}`;
      engine.addRuleBreak(text);
      note('rule', `${text}: logged as a rule break on this trade.`);
      setCoachOpen(true);
    }
    setWiden(null);
  };
  const revertWidened = () => {
    if (widen) { engine.setStop(widen.prev); note('rule', `Stop put back at ${widen.prev}. Your stop is your plan.`); }
    setWiden(null);
  };
  useEffect(() => { if (!engine.position && widen) setWiden(null); });

  // ----- 'Open on chart' from the journal -----
  const showFocus = (t: FocusTrade | null) => {
    ws.focus = t;
    setFocusTrade(t);
    panesOf().forEach(p => p.drawFocus());
  };
  useEffect(() => {
    if (!focus || !ready || fatal) return;
    let dead = false;
    axios.get(`/api/chart/trade/${focus.tradeId}`, auth()).then(r => {
      if (dead) return;
      const t: FocusTrade = r.data.trade;
      if (engine.active) exitReplay();
      showFocus(t);
      setChartDates(cur => ({ ...cur, [activeIdx]: new Date(sessionDay(t.entry) * 86400000).toISOString().slice(0, 10) }));
      if (!t.chartable) { setError(`${t.symbol}: the chart only has NQ prices, so this trade can't be shown.`); return; }
      setError('');
      goTo(t.exit ? Math.round((t.entry + t.exit) / 2) : t.entry);
    }).catch(() => { if (!dead) setError('Could not load that trade for the chart.'); });
    return () => { dead = true; };
  }, [focus?.nonce, ready, fatal]);

  // ----- keyboard: drawing tools, undo, replay keys, type a number + Enter for the active window's timeframe -----
  useEffect(() => {
    const setKeys = (v: string) => { tfKeysRef.current = v; setTfKeys(v); };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      const st = sRef.current;
      const c = ws.panes.get(st.active)?.ctl ?? null;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const tool: Tool | undefined = e.shiftKey ? (e.code === 'KeyR' ? 'rect' : undefined) : DRAW_KEYS[e.code];
        if (e.code === 'KeyG' && !e.shiftKey) { e.preventDefault(); openGoTo(); return; }
        if (tool && c) { e.preventDefault(); setMeasureArmed(false); c.start(tool); return; }
        // Alt+1..4: make that window active
        const n = Number(e.key);
        if (n >= 1 && n <= layoutCount(st.layout)) { e.preventDefault(); setActive(n - 1); }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); c?.cancel(); store.undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); c?.cancel(); store.redo(); return; }
        return;
      }
      if (panelRef.current) { if (e.key === 'Escape') setPanel(null); return; }
      const cur = tfKeysRef.current;
      if (!cur && c) {
        if (e.key === 'Escape' && (c.active || c.hasMeasure || measureArmedRef.current || c.selected)) {
          c.cancel(); c.clearMeasure(); setMeasureArmed(false); c.select(null);
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && c.selected) { e.preventDefault(); c.remove(c.selected); return; }
      }
      if (!cur && replayPickRef.current && e.key === 'Escape') { setReplayPick(false); return; }
      if (!cur && engine.active) {
        if (e.key === 'ArrowRight') { e.preventDefault(); if (!engine.playing) engine.stepForward(); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); if (!engine.playing) engine.stepBack(); return; }
        // Space on a focused button already clicks it
        if (e.key === ' ' && el?.tagName !== 'BUTTON') { e.preventDefault(); if (engine.playing) engine.pause(); else engine.play(); return; }
      }
      if (/^\d$/.test(e.key)) { setKeys((cur + e.key).slice(0, 4)); e.preventDefault(); }
      else if (/^[dhm]$/i.test(e.key) && /^\d*$/.test(cur) && (cur || /d/i.test(e.key))) { setKeys(cur + e.key.toUpperCase()); e.preventDefault(); }
      else if (!cur) return;
      else if (e.key === 'Backspace') { setKeys(cur.slice(0, -1)); e.preventDefault(); }
      else if (e.key === 'Escape') setKeys('');
      else if (e.key === 'Enter') {
        const m = parseTfInput(cur);
        if (m !== null) { setPane(sRef.current.active, { tf: m }); setKeys(''); }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update, setActive]);

  // ----- clock, fullscreen -----
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.();
  };

  // Auto-fit the price scale of every window again (same as double-clicking it)
  const autoScale = () => panesOf().forEach(p => {
    p.chart.overrideYAxis({ paneId: 'candle_pane', name: s.log ? 'logarithm' : 'normal' });
    p.chart.resize();
  });

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
  const setLayout = (mode: LayoutMode) => update(cur => ({ ...cur, layout: mode, active: Math.min(cur.active, layoutCount(mode) - 1) }));

  if (fatal) return <div className="mc-fatal">{fatal}</div>;

  const typed = tfKeys ? parseTfInput(tfKeys) : null;
  const replayOn = engine.active;
  const activeInds = IND_KEYS.filter(k => s.indicators[k].on).length;
  const activeTf = s.panes[activeIdx].tf;
  const busy = Object.values(busyPanes).some(Boolean);
  const chartDate = chartDates[activeIdx] ?? null;

  return (
    <div ref={rootRef} className={`mc-root mc-${s.theme}${full ? ' mc-full' : ''}`}>
      <div className="mc-top">
        <span className="mc-sym">NQ</span>
        <span className="mc-sym-sub">E-mini Nasdaq-100 · CME</span>
        <span className="mc-sep" />
        {TFS.map(t => (
          <button key={t.m} className={`mc-btn mc-tf${activeTf === t.m ? ' on' : ''}`} onClick={() => setPane(activeIdx, { tf: t.m })}
            title={`${t.label} for the active chart — or type ${t.m === 1440 ? 'D' : t.m} and press Enter`}>{t.label}</button>
        ))}
        <span className="mc-sep" />
        <button className={`mc-btn${panel === 'layout' ? ' open' : ''}`} onClick={() => setPanel(panel === 'layout' ? null : 'layout')}
          title="Chart layout: 1 to 4 charts">
          <LayoutIcon mode={s.layout} /> Layout
        </button>
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
        <button className={`mc-btn${s.notesOpen ? ' on' : ''}`} onClick={() => update({ notesOpen: !s.notesOpen })}
          title="Day notes: pre-market plan and review for the trading day on the active chart">Notes</button>
        <span className="mc-grow" />
        <button className="mc-btn" disabled={!store.canUndo} onClick={() => { ctl?.cancel(); store.undo(); }} title="Undo (Ctrl+Z)">↶</button>
        <button className="mc-btn" disabled={!store.canRedo} onClick={() => { ctl?.cancel(); store.redo(); }} title="Redo (Ctrl+Y)">↷</button>
        <span className="mc-sep" />
        <button className={`mc-btn${coachOpen ? ' on' : ''}`} onClick={() => setCoachOpen(!coachOpen)}
          title="Coach: checks your orders against your rules, pauses the replay when you break one, and lets you ask Claude about the chart">
          Coach{coachMsgs.length ? ` · ${coachMsgs.length}` : ''}
        </button>
        <button className={`mc-btn${replayOn || replayPick || panel === 'replay' ? ' on' : ''}`} disabled={replayOn}
          onClick={() => { setReplayPick(false); setPanel(panel === 'replay' ? null : 'replay'); }}
          title="Bar replay: hide the future and trade it bar by bar — all charts move together">⏪ Replay</button>
        <button className="mc-btn" disabled={replayOn} onClick={openGoTo} title="Go to a date and time (Alt+G)">Go to…</button>
        {target !== null && !replayOn && <button className="mc-btn mc-accent" onClick={goLatest} title="Back to the most recent bars">Latest »</button>}
        <button className="mc-btn" onClick={() => update({ theme: s.theme === 'dark' ? 'light' : 'dark' })}
          title={s.theme === 'dark' ? 'Switch to light chart' : 'Switch to dark chart'}>{s.theme === 'dark' ? '☀' : '☾'}</button>
        <button className="mc-btn" onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen'}>{full ? '🗗' : '⛶'}</button>
      </div>

      <div className="mc-body">
        <DrawToolbar ctl={ctl} magnet={s.magnet} hidden={s.drawHidden} lockAll={s.drawLocked}
          measureArmed={measureArmed}
          onMagnet={m => update({ magnet: m })} onHidden={v => update({ drawHidden: v })}
          onLockAll={v => update({ drawLocked: v })} onMeasure={setMeasureArmed} />
        <div className="mc-stage">
          <div className={`mc-grid mc-grid-${s.layout}`}>
            {ready && s.panes.slice(0, count).map((p, i) => (
              <div key={i} className={`mc-cell${i === activeIdx ? ' active' : ''}${count > 1 ? '' : ' single'}`}
                onMouseDown={() => setActive(i)}>
                <div className="mc-cell-head">
                  {count > 1 && <span className="mc-cell-num" title={`Chart ${i + 1} (Alt+${i + 1})`}>{i + 1}</span>}
                  <select className="mc-input mc-cell-tf" value={p.tf} title="Timeframe of this chart"
                    onChange={e => setPane(i, { tf: Number(e.target.value) })}>
                    {TFS.map(t => <option key={t.m} value={t.m}>{t.label}</option>)}
                  </select>
                  <div className="mc-seg" title="Journal data (NQ futures: replay, drawings) or TradingView live (Nasdaq-100 CFD — moves with NQ, different price level)">
                    <button className={p.src === 'journal' ? 'on' : ''} onClick={() => setPane(i, { src: 'journal' })}>Journal</button>
                    <button className={p.src === 'tv' ? 'on' : ''} onClick={() => setPane(i, { src: 'tv' })}>TV live</button>
                  </div>
                  {replayOn && p.src === 'journal' && <span className="mc-cell-tag">replay</span>}
                  {replayOn && p.src === 'tv' && <span className="mc-cell-tag mc-bad">not in replay</span>}
                </div>
                <div className="mc-cell-body">
                  {p.src === 'tv'
                    ? <TvPane interval={p.tf} theme={s.theme} timezone={TZ[s.clock] as 'America/New_York' | 'Etc/GMT+7'} />
                    : <ChartPane index={i} tf={p.tf} s={s} active={i === activeIdx} ws={ws} onActivate={setActive} />}
                </div>
              </div>
            ))}
          </div>

          <DrawEditBar ctl={ctl} />
          {focusTrade && focusTrade.chartable && !replayOn && (
            <div className="mc-focus">
              <span>🕯️ {focusTrade.side === 'long' ? 'Long' : focusTrade.side === 'short' ? 'Short' : 'Trade'} {focusTrade.quantity ?? ''} {focusTrade.symbol}</span>
              {focusTrade.pnl !== null && (
                <span className={focusTrade.pnl >= 0 ? 'mc-up' : 'mc-down'}>{fmtUsd(focusTrade.pnl)}</span>
              )}
              <span className="mc-dim">{fmtWall(focusTrade.entry, s.clock)} {s.clock} · {focusTrade.account_name}</span>
              <button className="mc-btn mc-small" title="Scroll back to this trade"
                onClick={() => goTo(focusTrade.exit ? Math.round((focusTrade.entry + focusTrade.exit) / 2) : focusTrade.entry)}>Show</button>
              <button className="mc-btn mc-small" onClick={() => showFocus(null)} title="Remove the trade markers">✕</button>
            </div>
          )}
          {replayPick && <div className="mc-pick-hint">Click the candle to start from (on any chart) — everything after it is hidden. Esc to cancel.</div>}
          {replayOn && (
            <ReplayBar engine={engine} clock={s.clock} accounts={accounts} accountId={replayAcct}
              onAccount={setReplayAcct} onRetry={t => saveTradeRef.current(t)} onExit={exitReplay} coach={coachHooks} />
          )}
          {widen && engine.position && (
            <div className="mc-coach-modal" onMouseDown={ev => ev.stopPropagation()}>
              <div className="mc-coach-stop-title">⛔ You moved your stop further away</div>
              <div className="mc-coach-text">
                {widen.prev} → {engine.position.stop}. Widening a stop to avoid being wrong is a rule break. The replay is paused.
              </div>
              <div className="mc-row mc-row-end">
                <button className="mc-btn mc-primary" onClick={revertWidened}>Put it back</button>
                <button className="mc-btn mc-bad" onClick={keepWidened}>Keep it (log rule break)</button>
              </div>
            </div>
          )}
          {busy && <div className="mc-busy">Loading…</div>}
          {error && <div className="mc-error" onClick={() => setErrorState('')} title="Click to dismiss">{error}</div>}

          {tfKeys && (
            <div className="mc-tfpop">
              <div className="mc-tfpop-title">Change interval{count > 1 ? ` · chart ${activeIdx + 1}` : ''}</div>
              <div className="mc-tfpop-keys">{tfKeys}</div>
              <div className={`mc-tfpop-hint${typed === null ? ' bad' : ''}`}>
                {typed !== null ? `${tfLabel(typed)} — press Enter` : 'Not available'}
              </div>
            </div>
          )}

          {panel === 'layout' && (
            <div className="mc-panel mc-panel-layout">
              <div className="mc-panel-title">Layout</div>
              <div className="mc-layouts">
                {LAYOUTS.map(l => (
                  <button key={l.mode} className={`mc-layout-btn${s.layout === l.mode ? ' on' : ''}`} onClick={() => setLayout(l.mode)} title={l.label}>
                    <LayoutIcon mode={l.mode} big />
                  </button>
                ))}
              </div>
              <label className="mc-check mc-row">
                <input type="checkbox" checked={s.syncCrosshair} onChange={() => update({ syncCrosshair: !s.syncCrosshair })} />
                <span>Sync crosshair across charts</span>
              </label>
              <label className="mc-check mc-row">
                <input type="checkbox" checked={s.live} onChange={() => update({ live: !s.live })} />
                <span>Near-live: fetch new bars every minute (Databento credit)</span>
              </label>
              <div className="mc-hint">Each chart has its own timeframe (box at its top-left). Replay, drawings, Go to and trades opened from the journal apply to every chart. Alt+1…4 picks the active chart.</div>
            </div>
          )}

          {panel === 'ind' && (
            <div className="mc-panel mc-panel-ind">
              <div className="mc-panel-title">Indicators <span className="mc-dim">(all charts)</span></div>
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
              <div className="mc-hint">Previous day = the full 6pm–5pm ET session. Levels follow the day at the right edge of each chart.</div>
            </div>
          )}

          {panel === 'data' && (
            <DataPanel token={token} meta={meta} clock={s.clock} onChanged={dataChanged} onClose={() => setPanel(null)} />
          )}
          {panel === 'replay' && (
            <div className="mc-panel mc-panel-replay">
              <div className="mc-panel-title">Bar replay</div>
              <button className="mc-btn mc-wide-btn" onClick={() => { setPanel(null); setReplayPick(true); }}>Select a candle on a chart</button>
              <button className="mc-btn mc-wide-btn" onClick={randomReplay}>Random date (9:00am ET)</button>
              <div className="mc-hint">All charts replay together. → / ← step one candle of the active chart (or one minute in 1m mode), Space plays. Buy / Sell from the replay bar; closed trades are saved to the journal account you choose there.</div>
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
        {s.notesOpen && <DayNotes token={token} chartDate={chartDate} onClose={() => update({ notesOpen: false })} />}
        {coachOpen && (
          <CoachPanel rules={s.coach} onRules={setCoachRules} msgs={coachMsgs} busy={coachBusy} clock={s.clock}
            onAsk={q => { note('you', q); askClaude('ask', { question: q }); }}
            onReview={() => askClaude('ask', { question: engine.active && engine.position
              ? 'Look at my open position on these charts. Is it still valid by my rules? What would you do with the stop and target?'
              : 'Read these charts for me: day type, trend on each timeframe, the key levels nearby, and whether any of my setups (S1/S2/S3/ORB) is forming. What should I wait for?' })}
            onClear={() => setCoachMsgs([])} onClose={() => setCoachOpen(false)} />
        )}
      </div>

      <div className="mc-bottom">
        {meta?.first && meta?.last ? (
          <button className={`mc-btn mc-small mc-dim${panel === 'data' ? ' open' : ''}`} onClick={() => setPanel(panel === 'data' ? null : 'data')}
            title="Price data: range stored, Databento update, CSV upload">
            Data {fmtWall(meta.first, s.clock).slice(0, 10)} → {fmtWall(meta.last, s.clock)} {s.clock} ▾
          </button>
        ) : null}
        {s.live && live && (
          <span className={`mc-live${live.configured ? '' : ' off'}`}
            title={live.configured ? (live.message || 'Checks Databento for new bars every minute') : 'Add DATABENTO_API_KEY in Render to turn this on'}>
            ● {live.configured ? `Near-live${live.delayMin !== null ? ` · data ${live.delayMin} min behind` : ''}` : 'Near-live off (no Databento key)'}
          </span>
        )}
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

/** Small picture of a layout, for the Layout button and panel. */
function LayoutIcon({ mode, big }: { mode: LayoutMode; big?: boolean }) {
  const w = big ? 34 : 16, h = big ? 24 : 12, g = big ? 2 : 1.5;
  const R = (x: number, y: number, ww: number, hh: number, k: number) =>
    <rect key={k} x={x} y={y} width={ww} height={hh} rx={1} fill="none" stroke="currentColor" strokeWidth={big ? 1.4 : 1.2} />;
  const half = (w - g) / 2, halfH = (h - g) / 2;
  const cells = mode === '1' ? [R(0.5, 0.5, w - 1, h - 1, 0)]
    : mode === '2v' ? [R(0.5, 0.5, half - 0.5, h - 1, 0), R(half + g, 0.5, half - 0.5, h - 1, 1)]
    : mode === '2h' ? [R(0.5, 0.5, w - 1, halfH - 0.5, 0), R(0.5, halfH + g, w - 1, halfH - 0.5, 1)]
    : mode === '3' ? [R(0.5, 0.5, half - 0.5, h - 1, 0), R(half + g, 0.5, half - 0.5, halfH - 0.5, 1), R(half + g, halfH + g, half - 0.5, halfH - 0.5, 2)]
    : [R(0.5, 0.5, half - 0.5, halfH - 0.5, 0), R(half + g, 0.5, half - 0.5, halfH - 0.5, 1), R(0.5, halfH + g, half - 0.5, halfH - 0.5, 2), R(half + g, halfH + g, half - 0.5, halfH - 0.5, 3)];
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ verticalAlign: 'middle' }}>{cells}</svg>;
}
