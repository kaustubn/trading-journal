import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Clock, TZ, wallToUtc, fmtWall, utcLabel, sessionDay, etOffset } from '../chart/time';
import FootprintBar from './FootprintBar';
import { setFootprintCutoff } from '../chart/footprint';
import DayNotes from './DayNotes';
import DataPanel from './DataPanel';
import ChartPane, { Workspace } from './ChartPane';
import TvPane from './TvPane';
import { DrawingStore, copyDrawing, copiedDrawing } from '../chart/drawingController';
import { Drawing, Tool, validDrawing, fmtUsd, fmtPrice, newId } from '../chart/drawings';
import { DrawToolbar, DrawEditBar, FavBar } from './DrawingTools';
import { ReplayEngine, ClosedTrade } from '../chart/replay';
import ReplayBar, { CoachHooks } from './ReplayBar';
import CoachPanel, { CoachMsg, Verdict } from './CoachPanel';
import MentorPanel from './MentorPanel';
import ObjectTree from './ObjectTree';
import { ChartAlert, AlertCond, levelOf, triggered, describe as describeAlert, beep, notify, canAlert } from '../chart/alerts';
import { Floating, IndicatorDialog, ChartSettingsDialog } from './ChartDialogs';
import { Bell, Settings as Gear, CandlestickChart, OctagonAlert, Eye, EyeOff, GraduationCap, Rewind, Sun, Moon, Maximize2, Minimize2, Undo2, Redo2, Save, Trash2, Pencil, Upload } from 'lucide-react';
import { checkOrder, checkAfterClose, CoachRules } from '../chart/coach';
import { buildContext, PaneData } from '../chart/coachContext';
import type { KLineData } from 'klinecharts';
import type { OrderInput } from '../chart/replay';
import {
  TFS, tfLabel, parseTfInput, INDS, IND_KEYS, IndKey, parseParams, Settings, DEFAULTS, mergeSettings,
  Meta, BarsResp, toK, FocusTrade, ChartType, CHART_TYPES, LAYOUTS, LayoutMode, layoutCount, PaneSource, applyTvPreset, applyStdPreset, snapshotOf, applySnapshot,
} from '../chart/config';
import '../styles/MarketChart.css';
import SessionTimerBar from './SessionTimerBar';
import { activeBtSessionId } from '../utils/sessionTimer';

// Drawing shortcuts (TradingView's), matched on the physical key
const DRAW_KEYS: Record<string, Tool> = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyF: 'fib' };

interface LiveStatus { configured: boolean; delayMin: number | null; message?: string; }

const DAY_KINDS: [string, string][] = [
  ['trend', 'Trend days (strong close, full range)'], ['range', 'Range / chop days (close near open)'],
  ['gapup', 'Gap up opens (+0.4% or more)'], ['gapdown', 'Gap down opens (−0.4% or more)'],
  ['bigrange', 'Big range days (1.5× ATR or more)'], ['smallrange', 'Quiet days (0.6× ATR or less)'],
  ['losing', 'My losing days (from my journal)'], ['practice', 'S1 practice set (25 fixed days)'],
];

export default function MarketChart({ token, focus }: { token: string; focus?: { tradeId: number; replayDay?: string; nonce: number } | null }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);       // saved settings + data range loaded
  const [fatal, setFatal] = useState('');          // page cannot work (e.g. not the owner)
  const [error, setErrorState] = useState('');
  const [busyPanes, setBusyPanes] = useState<Record<number, boolean>>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [panel, setPanel] = useState<null | 'ind' | 'levels' | 'goto' | 'replay' | 'data' | 'layout' | 'tf' | 'alerts'>(null);
  // replay day finder
  const [dfType, setDfType] = useState('trend');
  const [dfDays, setDfDays] = useState<{ day: string; range: number; atr: number; gapPct: number; body: number; dir: 'up' | 'down'; pnl: number | null }[]>([]);
  const [dfBusy, setDfBusy] = useState(false);
  const [dfMsg, setDfMsg] = useState('');
  // alerts: toasts on screen, the new-alert form, and the previous price the checks compare with
  const [toasts, setToasts] = useState<{ id: string; text: string; note: string }[]>([]);
  const [alForm, setAlForm] = useState<{ price: string; cond: AlertCond; note: string; repeat: boolean }>({ price: '', cond: 'cross', note: '', repeat: false });
  const lastPx = useRef<{ p: number; t: number } | null>(null);
  const checkRef = useRef<(price: number, t: number, hi?: number, lo?: number) => void>(() => {});
  const [tfPane, setTfPane] = useState(0);         // chart the custom-interval box applies to
  const [tfText, setTfText] = useState('');
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
  const [fpPick, setFpPick] = useState<string>(''); // footprint session picked by hand (outside replay)
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [mentorOpen, setMentorOpen] = useState(false);
  const [indDlg, setIndDlg] = useState<IndKey | null>(null);
  const [chartDlg, setChartDlg] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [layoutName, setLayoutName] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const indActionRef = useRef<(name: string, feature: string) => void>(() => {});
  const [ftDate, setFtDate] = useState('');
  const [ftTime, setFtTime] = useState('09:25');
  const [ftSpeed, setFtSpeed] = useState(10);
  const [ftMsg, setFtMsg] = useState('');
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
    onReset: () => { const e = wsRef.current?.engine; setFootprintCutoff(e?.active ? e.nowMs : null); panesOf().forEach(p => p.reset()); },
    onMinute: k => { setFootprintCutoff(k.timestamp + 60000); panesOf().forEach(p => p.onMinute(k)); checkRef.current(k.close, k.timestamp + 60000, k.high, k.low); },
    onLive: k => { setFootprintCutoff(wsRef.current?.engine.nowMs ?? null); panesOf().forEach(p => p.onLive(k)); checkRef.current(k.close, wsRef.current?.engine.nowMs ?? k.timestamp); },
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
      indicatorAction: (name, feature) => indActionRef.current(name, feature),
      syncUntil: 0,
      syncSrc: -1,
      panes: new Map(),
    };
  }
  const ws = wsRef.current;
  // test hook (headless checks): only when localStorage mc.debug = 1
  try { if (localStorage.getItem('mc.debug') === '1') (window as any).__mcWs = ws; } catch { /* ignore */ }
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
  const openTfBox = (i: number) => { setTfPane(i); setTfText(''); setPanel('tf'); };
  const applyTf = (pin: boolean) => {
    const m = parseTfInput(tfText);
    if (m === null) return;
    setPane(tfPane, { tf: m });
    if (pin && !TFS.some(t => t.m === m)) {
      update(cur => (cur.customTfs.includes(m) ? cur : { ...cur, customTfs: [...cur.customTfs, m].sort((a, b) => a - b).slice(0, 10) }));
    }
    setPanel(null);
  };
  const unpinTf = (m: number) => update(cur => ({ ...cur, customTfs: cur.customTfs.filter(x => x !== m) }));
  const tfChoices = (cur: number) => {
    const list = [...TFS.map(t => t.m), ...s.customTfs];
    if (!list.includes(cur)) list.push(cur);
    return [...new Set(list)].sort((a, b) => a - b);
  };
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
          if (!ws.target) {
            void Promise.all(panesOf().map(p => p.appendLatest())).then(() => {
              const d = panesOf()[0]?.chart.getDataList();
              const k = d?.[d.length - 1];
              if (k && !engine.active) checkRef.current(k.close, k.timestamp + 60000, k.high, k.low);
            });
          }
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
    lastPx.current = null; // a jump in time is not a price crossing
    panesOf().forEach(p => { p.ctl.cancel(); p.ctl.clearMeasure(); p.setHotkeys(false); });
    setMeasureArmed(false);
    if (!accounts.length) loadAccounts();
    await engine.start(t); // resets every window around the replay cursor
    lastPx.current = engine.price !== null ? { p: engine.price, t: engine.nowMs } : null; // alerts compare from here
    if (!engine.active) panesOf().forEach(p => p.setHotkeys(true));
  };
  startReplayRef.current = startReplay;
  const findDays = async () => {
    setDfBusy(true); setDfMsg('');
    try {
      if (dfType === 'practice') {
        const p = await axios.get('/api/replay/practice', auth());
        const ds = (p.data.days || []).map((d: any) => ({ day: d.day, range: d.range, atr: d.atr, gapPct: 0, body: 0, dir: d.dir, pnl: null, n: d.n, trades: d.trades }));
        setDfDays(ds);
        setDfMsg(`${ds.filter((d: any) => d.trades > 0).length} of ${ds.length} practice days traded. Scores: S1 Practice page.`);
        return;
      }
      const r = await axios.get('/api/bars/days', { ...auth(), params: { symbol: 'NQ', type: dfType } });
      setDfDays(r.data.days || []);
      setDfMsg(`${(r.data.days || []).length} days found${(r.data.days || []).length > 120 ? ' (newest 120 shown)' : ''}.`);
    } catch { setDfDays([]); setDfMsg('Could not load the days.'); }
    finally { setDfBusy(false); }
  };

  // ----- alerts -----
  checkRef.current = (price: number, t: number, hi?: number, lo?: number) => {
    const prev = lastPx.current;
    lastPx.current = { p: price, t };
    if (!prev || t < prev.t) return;
    const fired: ChartAlert[] = [];
    for (const a of sRef.current.alerts) {
      if (!a.active) continue;
      if (a.repeat && a.fired && t - a.fired < 60000) continue; // a repeating alert rests a minute
      const d = a.kind === 'drawing' ? store.drawings.find(x => x.id === a.drawingId) : undefined;
      if (a.kind === 'drawing' && !d) continue;
      const lvl = a.kind === 'price' ? { price: a.price! } : levelOf(d!, t);
      if (triggered(a.cond, lvl, prev.p, price, prev.t, t, hi, lo)) fired.push(a);
    }
    if (!fired.length) return;
    const ids = new Set(fired.map(a => a.id));
    update(cur => ({ ...cur, alerts: cur.alerts.map(a => (ids.has(a.id) ? { ...a, fired: t, active: a.repeat } : a)) }));
    beep();
    const items = fired.map(a => ({ id: newId(), text: `${describeAlert(a, store.drawings.find(x => x.id === a.drawingId), fmtPrice)} · now ${fmtPrice(price)}`, note: a.note }));
    setToasts(cur => [...cur, ...items].slice(-5));
    items.forEach(x => {
      notify('NQ alert', x.text + (x.note ? ` — ${x.note}` : ''));
      window.setTimeout(() => setToasts(cur => cur.filter(y => y.id !== x.id)), 15000);
    });
  };
  const askNotify = () => { try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* ignore */ } };
  const addAlert = (a: Omit<ChartAlert, 'id' | 'created' | 'active'>) => {
    askNotify();
    update(cur => ({ ...cur, alerts: [...cur.alerts, { ...a, id: newId(), created: Date.now(), active: true }].slice(-200) }));
  };
  const currentPrice = (): number | null => {
    if (engine.active && engine.price !== null) return engine.price;
    const d = ws.panes.get(activeIdx)?.chart.getDataList();
    return d && d.length ? d[d.length - 1].close : null;
  };
  indActionRef.current = (name: string, feature: string) => {
    const k = IND_KEYS.find(x => INDS[x].name === name);
    if (!k) return;
    if (feature === 'eye') update(cur => ({ ...cur, indicators: { ...cur.indicators, [k]: { ...cur.indicators[k], hidden: !cur.indicators[k].hidden } } }));
    else if (feature === 'gear') setIndDlg(k);
    else if (feature === 'close') update(cur => ({ ...cur, indicators: { ...cur.indicators, [k]: { ...cur.indicators[k], on: false } } }));
  };
  /** 9:25 ET (just before the New York open) written on the chart's clock, for that day. */
  const nyOpenOn = (day: string) => fmtWall(wallToUtc(day, '09:25', 'ET'), s.clock).slice(11, 16);
  /** Forward test: go back to a day and trade it as it happens, second by second. */
  const startForward = async () => {
    setFtMsg('');
    if (!ftDate) { setFtMsg('Pick a day first.'); return; }
    const wd = new Date(`${ftDate}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) { setFtMsg('That is a weekend: pick a weekday.'); return; }
    const t = wallToUtc(ftDate, ftTime || nyOpenOn(ftDate), s.clock);
    setPanel(null);
    await startReplay(t);
    if (!engine.active) { setPanel('replay'); setFtMsg('No chart data at that day / time (holiday or outside the data range). Try another day.'); return; }
    engine.liveSpeed = ftSpeed;
    engine.setLive(true);
    engine.play();
  };
  const exitReplay = () => {
    engine.exit();
    setFootprintCutoff(null);
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
  const shots = useRef(new Map<string, string>());
  /** Picture of the active chart (with the trade's markers) for the trade's review. */
  const snapshot = (): string | undefined => {
    try {
      const p = ws.panes.get(sRef.current.active) ?? panesOf()[0];
      const url = p?.chart.getConvertPictureUrl(true, 'jpeg', sRef.current.chart.bg);
      return typeof url === 'string' && url.length < 3_000_000 ? url : undefined;
    } catch { return undefined; }
  };
  saveTradeRef.current = (t: ClosedTrade) => {
    const account = replayAcctRef.current;
    if (!account) { engine.markSaved(t.id, 'failed', 'Choose the journal account to save replay trades to.'); return; }
    engine.markSaved(t.id, 'pending');
    // let the exit marker paint before taking the picture
    if (!shots.current.has(t.id)) { window.setTimeout(() => { const u = snapshot(); if (u) shots.current.set(t.id, u); else shots.current.set(t.id, ''); saveTradeRef.current(t); }, 150); return; }
    axios.post('/api/replay/trades', {
      account_id: account, client_id: t.id, symbol: t.contract, side: t.side, quantity: t.qty,
      entry_price: t.entry, exit_price: t.exit, stop_loss: t.stop, target: t.target,
      entry_time: new Date(t.entryTime).toISOString(), exit_time: new Date(t.exitTime).toISOString(),
      exit_reason: t.reason, timeframe: tfLabel(t.tf), setup_tag: t.setup || undefined, notes: t.notes || undefined,
      rule_breaks: t.ruleBreaks.length ? t.ruleBreaks : undefined,
      pnl: t.pnl,
      screenshot: shots.current.get(t.id) || undefined,
      bt_session_id: activeBtSessionId() ?? undefined,
    }, auth())
      .then(r => engine.markSaved(t.id, 'saved', undefined, { dbId: r.data?.trade?.id, tags: r.data?.trade?.tags ?? [] }))
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
    if (focus.replayDay) { void startReplayRef.current?.(wallToUtc(focus.replayDay, '09:25', 'ET')); return; }
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
        // copy / paste a drawing (works across windows and symbols); only when no text is selected on the page
        if (k === 'c' && c?.selectedDrawing && !window.getSelection()?.toString()) { e.preventDefault(); copyDrawing(c.selectedDrawing); return; }
        if (k === 'v' && c && copiedDrawing()) { e.preventDefault(); c.paste(copiedDrawing()!); return; }
        if (k === 'd' && c?.selected) { e.preventDefault(); c.clone(c.selected); return; }
        return;
      }
      if (panelRef.current) { if (e.key === 'Escape') setPanel(null); return; }
      const cur = tfKeysRef.current;
      if (!cur && c) {
        if (e.key === 'Escape' && (c.active || c.hasMeasure || measureArmedRef.current || c.selected)) {
          c.release(); c.clearMeasure(); setMeasureArmed(false); c.select(null);
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
  // Footprint session: follows the replay; otherwise the one picked, else the active chart's date
  const etDay = (ms: number) => new Date(ms + etOffset(ms)).toISOString().slice(0, 10);
  const fpDay = replayOn && engine.cursor ? etDay(engine.cursor) : fpPick || chartDates[activeIdx] || (meta?.last ? etDay(meta.last) : '');
  const activeInds = IND_KEYS.filter(k => s.indicators[k].on).length;
  const activeTf = s.panes[activeIdx].tf;
  const busy = Object.values(busyPanes).some(Boolean);
  const chartDate = chartDates[activeIdx] ?? null;

  return (
    <div ref={rootRef} className={`mc-root mc-${s.theme} mc-look-${s.look}${full ? ' mc-full' : ''}`}>
      <div className="mc-top">
        <span className="mc-sym">NQ</span>
        <span className="mc-sym-sub">E-mini Nasdaq-100 · CME</span>
        <span className="mc-sep" />
        {TFS.map(t => (
          <button key={t.m} className={`mc-btn mc-tf${activeTf === t.m ? ' on' : ''}`} onClick={() => setPane(activeIdx, { tf: t.m })}
            title={`${t.label} for the active chart — or type ${t.m === 1440 ? 'D' : t.m} and press Enter`}>{t.label}</button>
        ))}
        {[...s.customTfs, ...(TFS.some(t => t.m === activeTf) || s.customTfs.includes(activeTf) ? [] : [activeTf])].map(m => (
          <button key={`c${m}`} className={`mc-btn mc-tf${activeTf === m ? ' on' : ''}`} onClick={() => setPane(activeIdx, { tf: m })}
            onContextMenu={e => { e.preventDefault(); if (s.customTfs.includes(m)) unpinTf(m); }}
            title={s.customTfs.includes(m) ? `${tfLabel(m)} — your button (right-click to remove)` : `${tfLabel(m)} (custom) — add it as a button with +`}>{tfLabel(m)}</button>
        ))}
        <button className={`mc-btn mc-tf${panel === 'tf' ? ' open' : ''}`} onClick={() => (panel === 'tf' ? setPanel(null) : openTfBox(activeIdx))}
          title="Any interval: 2m, 7m, 45m, 90m, 2h, 6h… (or type the number on the chart and press Enter)">+</button>
        <span className="mc-sep" />
        <select className="mc-input mc-ctype" value={s.chart.ctype} title="Chart type (all charts)"
          onChange={e => update(cur => ({ ...cur, chart: { ...cur.chart, ctype: e.target.value as ChartType } }))}>
          {CHART_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
        </select>
        <button className={`mc-btn${panel === 'layout' ? ' open' : ''}`} onClick={() => setPanel(panel === 'layout' ? null : 'layout')}
          title="Chart layout: 1 to 4 charts">
          <LayoutIcon mode={s.layout} /> Layout
        </button>
        <button className={`mc-btn${panel === 'ind' ? ' open' : ''}`} onClick={() => setPanel(panel === 'ind' ? null : 'ind')}>
          Indicators{activeInds ? <span className="mc-count">{activeInds}</span> : null}
        </button>
        <button className={`mc-btn${s.sessions ? ' on' : ''}`} onClick={() => update({ sessions: !s.sessions })}
          title="Shade Asia (6pm–2am), London (2–9:30am) and New York (9:30am–4pm ET). Shown on 1h and below.">Sessions</button>
        <div className="mc-seg mc-session-seg" title="Which hours the candles show">
          <button className={!s.rth ? 'on' : ''} onClick={() => s.rth && update({ rth: false })}
            title="Full 23-hour session, 6pm–5pm ET (ETH): overnight + day">24h</button>
          <button className={s.rth ? 'on' : ''} onClick={() => !s.rth && update({ rth: true })}
            title="New York day session only, 9:30am–4pm ET (RTH)">Day 9:30–4</button>
        </div>
        <button className={`mc-btn${panel === 'levels' ? ' open' : ''}`} onClick={() => setPanel(panel === 'levels' ? null : 'levels')}>Levels</button>
        <button className={`mc-btn${panel === 'alerts' ? ' open' : ''}`} title="Alerts on a price or a drawn line (live, replay and forward test)"
          onClick={() => {
            if (panel !== 'alerts' && !alForm.price) { const p = currentPrice(); if (p !== null) setAlForm(f => ({ ...f, price: String(p) })); }
            setPanel(panel === 'alerts' ? null : 'alerts');
          }}>
          <Bell size={14} /> Alerts{s.alerts.filter(a => a.active).length ? <span className="mc-count">{s.alerts.filter(a => a.active).length}</span> : null}
        </button>
        <button className={`mc-btn${s.notesOpen ? ' on' : ''}`} onClick={() => update({ notesOpen: !s.notesOpen })}
          title="Day notes: pre-market plan and review for the trading day on the active chart">Notes</button>
        <span className="mc-grow" />
        <button className="mc-btn" disabled={!store.canUndo} onClick={() => { ctl?.cancel(); store.undo(); }} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button className="mc-btn" disabled={!store.canRedo} onClick={() => { ctl?.cancel(); store.redo(); }} title="Redo (Ctrl+Y)"><Redo2 size={15} /></button>
        <span className="mc-sep" />
        <button className={`mc-btn${mentorOpen ? ' on' : ''}`} onClick={() => { setMentorOpen(!mentorOpen); if (!mentorOpen) setCoachOpen(false); }}
          title="Mentor: learn a mentor's book or course bar by bar, practise real setups, Pattern Sprint game"><GraduationCap size={15} /> Mentor</button>
        <button className={`mc-btn${coachOpen ? ' on' : ''}`} onClick={() => { setCoachOpen(!coachOpen); if (!coachOpen) setMentorOpen(false); }}
          title="Coach: checks your orders against your rules, pauses the replay when you break one, and lets you ask Claude about the chart">
          Coach{coachMsgs.length ? ` · ${coachMsgs.length}` : ''}
        </button>
        <button className={`mc-btn${replayOn || replayPick || panel === 'replay' ? ' on' : ''}`} disabled={replayOn}
          onClick={() => {
            setReplayPick(false); setFtMsg('');
            if (panel !== 'replay' && !ftDate && meta?.last) {
              // default: the last weekday with data, starting just before the New York open
              let ms = meta.last;
              for (let i = 0; i < 7; i++) { const d = fmtWall(ms, 'ET').slice(0, 10), w = new Date(`${d}T12:00:00Z`).getUTCDay(); if (w > 0 && w < 6) break; ms -= 86400000; }
              const day = fmtWall(ms, s.clock).slice(0, 10);
              setFtDate(day); setFtTime(nyOpenOn(day));
            }
            setPanel(panel === 'replay' ? null : 'replay');
          }}
          title="Bar replay: hide the future and trade it bar by bar — all charts move together"><Rewind size={15} /> Replay</button>
        <button className="mc-btn" disabled={replayOn} onClick={openGoTo} title="Go to a date and time (Alt+G)">Go to…</button>
        {target !== null && !replayOn && <button className="mc-btn mc-accent" onClick={goLatest} title="Back to the most recent bars">Latest »</button>}
        <button className="mc-btn" onClick={() => update({ theme: s.theme === 'dark' ? 'light' : 'dark' })}
          title={s.theme === 'dark' ? 'Switch to light chart' : 'Switch to dark chart'}>{s.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className={`mc-btn${chartDlg ? ' on' : ''}`} onClick={() => setChartDlg(!chartDlg)} title="Chart settings: candles, background, grid, crosshair, scales, status line"><Gear size={15} /></button>
        <button className="mc-btn" onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>

      <div className="mc-body">
        {s.drawBar ? <DrawToolbar ctl={ctl} magnet={s.magnet} hidden={s.drawHidden} lockAll={s.drawLocked}
          fav={s.favTools} onFav={t => update(cur => ({ ...cur, favTools: cur.favTools.includes(t) ? cur.favTools.filter(x => x !== t) : [...cur.favTools, t] }))}
          favBar={s.favBar} onFavBar={v => update({ favBar: v })} onCollapse={() => update({ drawBar: false })}
          treeOpen={treeOpen} onTree={() => setTreeOpen(!treeOpen)}
          measureArmed={measureArmed}
          onMagnet={m => update({ magnet: m })} onHidden={v => update({ drawHidden: v })}
          onLockAll={v => update({ drawLocked: v })} onMeasure={setMeasureArmed}
          stay={s.stayDrawing} onStay={v => update({ stayDrawing: v })} />
          : <button className="mc-draw-show" title="Show the drawing toolbar" onClick={() => update({ drawBar: true })}>›</button>}
        {s.favBar && !panel && <FavBar ctl={ctl} tools={s.favTools} onClose={() => update({ favBar: false })} />}{/* hidden while a side panel is open, so it never covers it */}
        {s.indicators.FP?.on && (
          <FootprintBar auth={auth} replay={engine.active} day={fpDay} onDay={d => setFpPick(d)} onLoaded={() => panesOf().forEach(p => p.chart.overrideIndicator({ name: 'JC_FP' }))} />
        )}
        <div className="mc-stage">
          <div className={`mc-grid mc-grid-${s.layout}`}>
            {ready && s.panes.slice(0, count).map((p, i) => (
              <div key={i} className={`mc-cell${i === activeIdx ? ' active' : ''}${count > 1 ? '' : ' single'}`} style={{ background: s.chart.bg }}
                onMouseDown={() => setActive(i)}>
                <div className="mc-cell-head">
                  {count > 1 && <span className="mc-cell-num" title={`Chart ${i + 1} (Alt+${i + 1})`}>{i + 1}</span>}
                  <select className="mc-input mc-cell-tf" value={p.tf} title="Timeframe of this chart"
                    onChange={e => { const v = Number(e.target.value); if (v > 0) setPane(i, { tf: v }); else { setActive(i); openTfBox(i); } }}>
                    {tfChoices(p.tf).map(m => <option key={m} value={m}>{tfLabel(m)}</option>)}
                    <option value={0}>Custom…</option>
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
                    ? <TvPane interval={p.tf} theme={s.theme} timezone={s.clock === 'BC' ? 'America/Phoenix' : 'America/New_York'} />
                    : <ChartPane index={i} tf={p.tf} s={s} active={i === activeIdx} ws={ws} onActivate={setActive} />}
                </div>
              </div>
            ))}
          </div>

          <DrawEditBar ctl={ctl} tplOf={tool => s.toolTpl[tool]}
            onAlert={d => { setAlForm(f => ({ ...f, cond: d.tool === 'rect' ? 'cross' : f.cond })); addAlert({ kind: 'drawing', drawingId: d.id, cond: 'cross', note: d.text ?? '', repeat: false }); setPanel('alerts'); }}
            hasAlert={id => s.alerts.some(a => a.active && a.drawingId === id)}
            onTemplate={(tool, name) => update(cur => ({ ...cur, toolTpl: { ...cur.toolTpl, [tool]: name } }))} />
          {focusTrade && focusTrade.chartable && !replayOn && (
            <div className="mc-focus">
              <span><CandlestickChart size={14} /> {focusTrade.side === 'long' ? 'Long' : focusTrade.side === 'short' ? 'Short' : 'Trade'} {focusTrade.quantity ?? ''} {focusTrade.symbol}</span>
              {focusTrade.pnl !== null && (
                <span className={focusTrade.pnl >= 0 ? 'mc-up' : 'mc-down'}>{fmtUsd(focusTrade.pnl)}</span>
              )}
              <span className="mc-dim">{fmtWall(focusTrade.entry, s.clock)} {s.clock} · {focusTrade.account_name}</span>
              <button className="mc-btn mc-small" title="Scroll back to this trade"
                onClick={() => goTo(focusTrade.exit ? Math.round((focusTrade.entry + focusTrade.exit) / 2) : focusTrade.entry)}>Show</button>
              <button className="mc-btn mc-small" onClick={() => showFocus(null)} title="Remove the trade markers">✕</button>
            </div>
          )}
          {ctl?.manualTool === 'path' && (
            <div className="mc-pick-hint mc-path-hint">
              Path: {ctl.pathPoints} point{ctl.pathPoints === 1 ? '' : 's'} — click to add, double-click / Enter / right-click to finish
              <button className="mc-btn mc-small mc-primary" disabled={ctl.pathPoints < 2} onMouseDown={e => e.stopPropagation()} onClick={() => { ctl.release(); redraw(); }}>Finish</button>
              <button className="mc-btn mc-small" onMouseDown={e => e.stopPropagation()} onClick={() => { ctl.cancel(); redraw(); }}>Cancel</button>
            </div>
          )}
          {replayPick && <div className="mc-pick-hint">Click the candle to start from (on any chart) — everything after it is hidden. Esc to cancel.</div>}
          {replayOn && (
            <SessionTimerBar token={token} setups={Array.from(new Set(engine.trades.map(t => t.setup).filter(Boolean))) as string[]}
              context={() => ({
                replayDate: engine.cursor ? new Date(engine.cursor).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null,
                instrument: 'NQ', timeframe: tfLabel(ws.panes.get(activeIdx)?.tf() ?? 1),
              })} />
          )}
          {replayOn && (
            <ReplayBar engine={engine} clock={s.clock} accounts={accounts} accountId={replayAcct}
              onAccount={setReplayAcct} onRetry={t => saveTradeRef.current(t)} onExit={exitReplay} coach={coachHooks}
              onJump={startReplay}
              atr={(() => {
                const p = ws.panes.get(activeIdx); const d = p?.chart.getDataList();
                if (!p || !d || d.length < 16) return null;
                let sum = 0;
                for (let i = d.length - 15; i < d.length - 1; i++) sum += Math.max(d[i].high - d[i].low, Math.abs(d[i].high - d[i - 1].close), Math.abs(d[i].low - d[i - 1].close));
                return { value: sum / 14, tf: tfLabel(p.tf()) };
              })()}
              onTags={async (t, tags) => {
                if (!t.dbId) return 'Not saved to the journal yet.';
                try { await axios.put(`/api/trades/${t.dbId}`, { tags }, auth()); engine.markSaved(t.id, t.saved, t.error, { tags }); return null; }
                catch { return 'Could not save the tag.'; }
              }} />
          )}
          {widen && engine.position && (
            <div className="mc-coach-modal" onMouseDown={ev => ev.stopPropagation()}>
              <div className="mc-coach-stop-title"><OctagonAlert size={15} /> You moved your stop further away</div>
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
          {toasts.length > 0 && (
            <div className="mc-toasts">
              {toasts.map(x => (
                <div key={x.id} className="mc-toast" onClick={() => setToasts(cur => cur.filter(y => y.id !== x.id))} title="Click to dismiss">
                  <Bell size={14} /> <div><b>{x.text}</b>{x.note && <div className="mc-dim">{x.note}</div>}</div>
                </div>
              ))}
            </div>
          )}

          {tfKeys && (
            <div className="mc-tfpop">
              <div className="mc-tfpop-title">Change interval{count > 1 ? ` · chart ${activeIdx + 1}` : ''}</div>
              <div className="mc-tfpop-keys">{tfKeys}</div>
              <div className={`mc-tfpop-hint${typed === null ? ' bad' : ''}`}>
                {typed !== null ? `${tfLabel(typed)} — press Enter` : '1–1439 minutes, 1h–23h, or D'}
              </div>
            </div>
          )}

          {panel === 'tf' && (() => {
            const m = parseTfInput(tfText);
            return (
              <form className="mc-panel mc-panel-tf" onSubmit={e => { e.preventDefault(); applyTf(false); }} onMouseDown={e => e.stopPropagation()}>
                <div className="mc-panel-title">Custom interval{count > 1 ? ` · chart ${tfPane + 1}` : ''}</div>
                <input className="mc-input mc-wide" autoFocus placeholder="e.g. 2m, 45, 90m, 2h, 6h, D" value={tfText}
                  onChange={e => setTfText(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setPanel(null); }} />
                <div className={`mc-hint${tfText && m === null ? ' mc-bad' : ''}`}>
                  {!tfText ? 'Minutes (1–1439), hours (1h–23h) or D. Bars count from the 6pm ET session open, like TradingView.'
                    : m === null ? 'Not a valid interval.' : `${tfLabel(m)} candles`}
                </div>
                <div className="mc-row mc-row-end">
                  <button type="button" className="mc-btn" onClick={() => setPanel(null)}>Cancel</button>
                  <button type="button" className="mc-btn" disabled={m === null || TFS.some(t => t.m === m)} onClick={() => applyTf(true)}
                    title="Show it and keep it as a button in the top bar">Show + add button</button>
                  <button type="submit" className="mc-btn mc-primary" disabled={m === null}>Show</button>
                </div>
              </form>
            );
          })()}
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
                <input type="checkbox" checked={s.syncTime} onChange={() => update({ syncTime: !s.syncTime })} />
                <span>Sync time across charts (scroll one, the others follow)</span>
              </label>
              <label className="mc-check mc-row">
                <input type="checkbox" checked={s.live} onChange={() => update({ live: !s.live })} />
                <span>Near-live: fetch new bars every minute (Databento credit)</span>
              </label>
              <div className="mc-hint">Each chart has its own timeframe (box at its top-left). Replay, drawings, Go to and trades opened from the journal apply to every chart. Alt+1…4 picks the active chart.</div>
              <div className="mc-panel-title mc-sub-title">Chart style <span className="mc-dim">(all layouts)</span></div>
              <div className="mc-styles">
                <button className={`mc-style-btn${s.look === 'tv' ? ' on' : ''}`} onClick={() => update(applyTvPreset)}
                  title="Your TradingView chart: colours and chart settings, NQ System v3 + Volume, your drawing templates. Your TradingView levels and drawings are on the chart in every style.">
                  <span className="mc-style-swatch mc-swatch-tv" /><b>TV</b>
                  <span className="mc-dim">levels · chart settings · tools · indicators · colours from your TradingView</span>
                </button>
                <button className={`mc-style-btn${s.look === 'journal' ? ' on' : ''}`}
                  onClick={() => update(applyStdPreset)}
                  title="TradingView's standard dark chart with green/red candles">
                  <span className="mc-style-swatch mc-swatch-journal" /><b>Standard</b>
                  <span className="mc-dim">green / red candles, grid, default tool colours</span>
                </button>
              </div>
              <div className="mc-panel-title mc-sub-title">My layouts</div>
              {!s.saved.length && <div className="mc-hint">Save the current windows, timeframes, chart settings, indicators and tool templates as a layout, then switch between them here.</div>}
              {s.saved.map((l, i) => (
                <div key={i} className="mc-row mc-saved-row">
                  {renaming === i ? (
                    <input className="mc-input mc-grow" autoFocus defaultValue={l.name} maxLength={40}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                      onBlur={e => { const v = e.target.value.trim(); setRenaming(null); if (v) update(cur => ({ ...cur, saved: cur.saved.map((x, j) => (j === i ? { ...x, name: v } : x)) })); }} />
                  ) : (
                    <button className="mc-btn mc-grow mc-saved-load" onClick={() => update(cur => applySnapshot(cur, l.data))} title="Load this layout">{l.name}</button>
                  )}
                  <button className="mc-btn mc-small" title="Overwrite with the current chart" onClick={() => update(cur => ({ ...cur, saved: cur.saved.map((x, j) => (j === i ? { ...x, data: snapshotOf(cur) } : x)) }))}><Upload size={13} /></button>
                  <button className="mc-btn mc-small" title="Rename" onClick={() => setRenaming(i)}><Pencil size={13} /></button>
                  <button className="mc-btn mc-small" title="Delete this layout" onClick={() => update(cur => ({ ...cur, saved: cur.saved.filter((_, j) => j !== i) }))}><Trash2 size={13} /></button>
                </div>
              ))}
              <form className="mc-row" onSubmit={e => { e.preventDefault(); const n = layoutName.trim(); if (!n) return; update(cur => ({ ...cur, saved: [...cur.saved.filter(x => x.name !== n), { name: n, data: snapshotOf(cur) }].slice(-20) })); setLayoutName(''); }}>
                <input className="mc-input mc-grow" placeholder="New layout name" maxLength={40} value={layoutName} onChange={e => setLayoutName(e.target.value)} onKeyDown={e => e.stopPropagation()} />
                <button type="submit" className="mc-btn mc-primary" disabled={!layoutName.trim()}><Save size={14} /> Save</button>
              </form>
            </div>
          )}

          {panel === 'ind' && (
            <div className="mc-panel mc-panel-ind">
              <div className="mc-panel-title">Indicators <span className="mc-dim">(all charts)</span></div>
              {IND_KEYS.map(k => {
                const def = INDS[k], cfg = s.indicators[k];
                return (
                  <div key={k} className="mc-ind-row">
                    <label className="mc-check mc-ind-name">
                      <input type="checkbox" checked={cfg.on} onChange={() => toggleInd(k)} />
                      <span>{def.label}{def.max > 0 && cfg.params.length ? <span className="mc-dim"> {cfg.params.join(', ')}</span> : null}</span>
                    </label>
                    <span className="mc-ind-actions">
                      {cfg.on && (
                        <button className="mc-btn mc-small" title={cfg.hidden ? 'Show' : 'Hide'}
                          onClick={() => update(cur => ({ ...cur, indicators: { ...cur.indicators, [k]: { ...cur.indicators[k], hidden: !cur.indicators[k].hidden } } }))}>
                          {cfg.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                      <button className="mc-btn mc-small" title="Settings: inputs and colours" onClick={() => { setIndDlg(k); setPanel(null); }}><Gear size={14} /></button>
                    </span>
                    <div className="mc-ind-hint">{def.hint}</div>
                  </div>
                );
              })}
            </div>
          )}

          {panel === 'alerts' && (
            <div className="mc-panel mc-panel-alerts">
              <div className="mc-panel-title">Alerts</div>
              <div className="mc-row">
                <select className="mc-input" value={alForm.cond} onChange={e => setAlForm(f => ({ ...f, cond: e.target.value as AlertCond }))}>
                  <option value="cross">Price crosses</option><option value="above">Price goes above</option><option value="below">Price goes below</option>
                </select>
                <input className="mc-input mc-al-price" type="number" step={0.25} value={alForm.price} placeholder="Price"
                  onChange={e => setAlForm(f => ({ ...f, price: e.target.value }))} onKeyDown={e => e.stopPropagation()} />
              </div>
              <input className="mc-input mc-wide" placeholder="Note (optional), e.g. PDH retest, check S1" maxLength={120} value={alForm.note}
                onChange={e => setAlForm(f => ({ ...f, note: e.target.value }))} onKeyDown={e => e.stopPropagation()} />
              <label className="mc-check mc-row"><input type="checkbox" checked={alForm.repeat} onChange={e => setAlForm(f => ({ ...f, repeat: e.target.checked }))} /> Repeat (stay on after it fires)</label>
              <div className="mc-row mc-row-end">
                {ctl?.selectedDrawing && canAlert(ctl.selectedDrawing) && (
                  <button className="mc-btn" onClick={() => { addAlert({ kind: 'drawing', drawingId: ctl.selectedDrawing!.id, cond: alForm.cond, note: alForm.note.trim(), repeat: alForm.repeat }); setAlForm(f => ({ ...f, note: '' })); }}>
                    On selected drawing</button>
                )}
                <button className="mc-btn mc-primary" disabled={!(Number(alForm.price) > 0)}
                  onClick={() => { addAlert({ kind: 'price', price: Math.round(Number(alForm.price) * 4) / 4, cond: alForm.cond, note: alForm.note.trim(), repeat: alForm.repeat }); setAlForm(f => ({ ...f, note: '' })); }}>
                  Add price alert</button>
              </div>
              <div className="mc-hint">Checked on every new price: live chart, replay and forward test. Select a line, trend line, zone or vertical line and press the bell on its edit bar to alert on it. Allow notifications to get alerts when the tab is in the background.</div>
              <div className="mc-al-list">
                {!s.alerts.length && <div className="mc-hint">No alerts yet.</div>}
                {[...s.alerts].reverse().map(a => (
                  <div key={a.id} className={`mc-al-row${a.active ? '' : ' off'}`}>
                    <div className="mc-grow">
                      <div>{describeAlert(a, store.drawings.find(x => x.id === a.drawingId), fmtPrice)}{a.repeat ? ' · repeats' : ''}</div>
                      <div className="mc-dim">{a.note}{a.note && a.fired ? ' · ' : ''}{a.fired ? `fired ${fmtWall(a.fired, s.clock)} ${s.clock}` : ''}</div>
                    </div>
                    <button className="mc-btn mc-small" title={a.active ? 'Pause' : 'Turn on'}
                      onClick={() => update(cur => ({ ...cur, alerts: cur.alerts.map(x => (x.id === a.id ? { ...x, active: !x.active } : x)) }))}>{a.active ? 'On' : 'Off'}</button>
                    <button className="mc-btn mc-small mc-danger-btn" title="Delete alert"
                      onClick={() => update(cur => ({ ...cur, alerts: cur.alerts.filter(x => x.id !== a.id) }))}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
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
              <div className="mc-panel-title mc-sub-title">Day finder</div>
              <div className="mc-hint">Practise the kind of day you struggle with. Replay starts at 9:25 ET.</div>
              <div className="mc-row">
                <select className="mc-input mc-grow" value={dfType} onChange={e => setDfType(e.target.value)}>
                  {DAY_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button className="mc-btn" disabled={dfBusy} onClick={findDays}>{dfBusy ? '…' : 'Find'}</button>
                <button className="mc-btn" disabled={!dfDays.length} title="Replay a random day from the list"
                  onClick={() => { const d = dfDays[Math.floor(Math.random() * dfDays.length)]; if (d) void startReplay(wallToUtc(d.day, '09:25', 'ET')); }}>Random</button>
              </div>
              {dfMsg && <div className="mc-hint">{dfMsg}</div>}
              {dfDays.length > 0 && (
                <div className="mc-df-list">
                  {dfDays.slice(0, 120).map(d => (
                    <button key={d.day} className="mc-df-row" onClick={() => void startReplay(wallToUtc(d.day, '09:25', 'ET'))} title="Replay this day from 9:25 ET">
                      <span>{new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>
                      <span className={d.dir === 'up' ? 'mc-up' : 'mc-down'}>{d.dir === 'up' ? '▲' : '▼'} {Math.round(d.range)} pt</span>
                      <span className="mc-dim">{dfType === 'practice' ? `#${(d as any).n} · ${(d as any).trades ? '✓ traded' : 'to do'}` : d.pnl !== null ? fmtUsd(d.pnl) : dfType.startsWith('gap') ? `gap ${d.gapPct > 0 ? '+' : ''}${d.gapPct}%` : `${(d.range / d.atr).toFixed(1)}× ATR`}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mc-hint">All charts replay together. → / ← step one candle of the active chart (or one minute in 1m mode), Space plays. Buy / Sell from the replay bar; closed trades are saved to the journal account you choose there.</div>
              <div className="mc-panel-title mc-sub-title">● Forward test a day</div>
              <div className="mc-hint">Go back to a day and trade it as if it were live: candles move second by second, you can use market, limit and stop orders, and pause any time.</div>
              <div className="mc-row">
                <input className="mc-input" type="date" value={ftDate} onChange={e => { setFtMsg(''); setFtDate(e.target.value); if (e.target.value) setFtTime(nyOpenOn(e.target.value)); }}
                  min={meta?.first ? fmtWall(meta.first, s.clock).slice(0, 10) : undefined}
                  max={meta?.last ? fmtWall(meta.last, s.clock).slice(0, 10) : undefined} />
                <input className="mc-input" type="time" value={ftTime} onChange={e => setFtTime(e.target.value)} title={`Start time (${s.clock})`} />
              </div>
              <div className="mc-row">
                <select className="mc-input mc-grow" value={ftSpeed} onChange={e => setFtSpeed(Number(e.target.value))} title="Speed: market time per real second">
                  {[1, 2, 5, 10, 20, 30, 60].map(v => <option key={v} value={v}>{v === 1 ? '1× real time (1 s = 1 s)' : v === 60 ? '60× (1 minute per second)' : `${v}× (1 minute in ${Math.round(60 / v)} s)`}</option>)}
                </select>
                <button className="mc-btn mc-primary" onClick={startForward}>Start</button>
              </div>
              <div className="mc-hint">Start time is on the chart clock ({s.clock}); it is set to 9:25 ET, just before the New York open.</div>
              {ftMsg && <div className="mc-hint" style={{ color: 'var(--red, #f23645)', fontWeight: 600 }}>{ftMsg}</div>}
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
        {indDlg && (
          <IndicatorDialog k={indDlg} cfg={s.indicators[indDlg]} look={s.look} onClose={() => setIndDlg(null)}
            onChange={c => update(cur => ({ ...cur, indicators: { ...cur.indicators, [indDlg]: c } }))} />
        )}
        {treeOpen && (
          <ObjectTree store={store} clock={s.clock} onClose={() => setTreeOpen(false)}
            onJump={d => {
              if (d.hidden) store.update(d.id, { hidden: false });
              const p = ws.panes.get(activeIdx);
              p?.showTime(d.points[0].t);
              window.setTimeout(() => { p?.ctl.select(d.id); }, 120);
            }} />
        )}
        {chartDlg && <ChartSettingsDialog cfg={s.chart} onChange={c => update(cur => ({ ...cur, chart: c }))} onClose={() => setChartDlg(false)} />}
        {mentorOpen && (
          <MentorPanel ws={ws} activeIdx={activeIdx} clock={s.clock}
            setPaneTf={(i, tf) => setPane(i, { tf })}
            startReplay={startReplay}
            phasesOn={s.indicators.PHASES.on}
            onPhases={on => update(cur => ({ ...cur, indicators: { ...cur.indicators, PHASES: { ...cur.indicators.PHASES, on } } }))}
            onClose={() => setMentorOpen(false)} />
        )}
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
