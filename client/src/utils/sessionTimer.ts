// Backtest session timer (browser side). The server decides what counts (src/services/btSessionClock.ts);
// this class measures seconds locally, sends them every 30 s, and survives refreshes, hidden tabs and offline spells.
import axios from 'axios';

export type TimerStatus = 'starting' | 'running' | 'paused' | 'idle' | 'stopped' | 'conflict' | 'error';

export interface ServerSession {
  id: number; started_at: string; ended_at: string | null; status: string;
  active_sec: number; idle_sec: number; pause_sec: number; trades_logged: number; last_seq: number;
  setup_tag: string | null; hist_from: string | null; hist_to: string | null;
}

export interface TimerView {
  status: TimerStatus;
  sessionId: number | null;
  activeSec: number; idleSec: number; pauseSec: number;
  tradesLogged: number;
  startedAt: string | null;
  offline: boolean;
  message: string;
}

export interface TimerContext { setupTag?: string | null; instrument?: string | null; timeframe?: string | null; replayDate?: string | null }

export const IDLE_AFTER_SEC = 5 * 60;      // no activity for 5 min -> idle
export const AUTO_STOP_IDLE_SEC = 60 * 60; // idle for an hour -> the session ends
export const BEAT_EVERY_SEC = 30;
const STORE = 'jc.btTimer';
const TAB = 'jc.btTab';

let activeId: number | null = null;
/** Session id currently timing in this tab (replay trades attach it when saved). */
export const activeBtSessionId = () => activeId;

function tabId(): string {
  try {
    let t = sessionStorage.getItem(TAB);
    if (!t) { t = 'tab-' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)); sessionStorage.setItem(TAB, t); }
    return t.slice(0, 64);
  } catch { return 'tab-' + Math.random().toString(36).slice(2, 14); }
}

interface Pending { active: number; idle: number; pause: number }
interface Stored { sessionId: number; seq: number; pending: Pending }

export class SessionTimer {
  private token: string;
  private page: string;
  private ctx: () => TimerContext;
  private tab = tabId();
  private session: ServerSession | null = null;
  private seq = 0;
  private pending: Pending = { active: 0, idle: 0, pause: 0 };
  private status: TimerStatus = 'starting';
  private manualPause = false;
  private lastActivity = Date.now();
  private idleRun = 0;
  private sinceBeat = 0;
  private offline = false;
  private message = '';
  private sending = false;
  private tick?: number;
  private listeners = new Set<(v: TimerView) => void>();
  private dates: { from: string | null; to: string | null } = { from: null, to: null };

  constructor(opts: { token: string; page: string; context: () => TimerContext }) {
    this.token = opts.token; this.page = opts.page; this.ctx = opts.context;
  }

  private auth() { return { headers: { Authorization: `Bearer ${this.token}` } }; }

  subscribe(fn: (v: TimerView) => void) { this.listeners.add(fn); fn(this.view()); return () => { this.listeners.delete(fn); }; }
  private emit() { const v = this.view(); this.listeners.forEach(f => f(v)); }
  view(): TimerView {
    const s = this.session;
    return {
      status: this.status, sessionId: s?.id ?? null,
      activeSec: (s?.active_sec ?? 0) + this.pending.active, idleSec: (s?.idle_sec ?? 0) + this.pending.idle, pauseSec: (s?.pause_sec ?? 0) + this.pending.pause,
      tradesLogged: s?.trades_logged ?? 0, startedAt: s?.started_at ?? null, offline: this.offline, message: this.message,
    };
  }

  /** Any user action on the replay page (scroll, zoom, step, order, key press). */
  activity = () => {
    this.lastActivity = Date.now();
    this.idleRun = 0;
    if (this.status === 'idle') { this.status = 'running'; this.emit(); }
  };

  async start() {
    this.status = 'starting'; this.emit();
    const c = this.ctx();
    try {
      const r = await axios.post('/api/bt-sessions/start', { tabId: this.tab, page: this.page, setupTag: c.setupTag, instrument: c.instrument, timeframe: c.timeframe }, this.auth());
      this.adopt(r.data.session);
    } catch (e: any) {
      if (e?.response?.status === 409) { this.session = e.response.data.session; this.status = 'conflict'; this.message = 'The timer is running in another tab or device.'; }
      else { this.status = 'error'; this.message = 'Could not start the session timer.'; }
      this.emit();
      return;
    }
    this.startTicking();
  }

  /** Take a session from the server; keep unsent seconds from before a refresh of this same tab. */
  private adopt(s: ServerSession) {
    this.session = s;
    activeId = s.id;
    this.seq = s.last_seq;
    try {
      const st = JSON.parse(sessionStorage.getItem(STORE) || 'null') as Stored | null;
      if (st && st.sessionId === s.id) { this.pending = st.pending; this.seq = Math.max(this.seq, st.seq); }
      else this.pending = { active: 0, idle: 0, pause: 0 };
    } catch { this.pending = { active: 0, idle: 0, pause: 0 }; }
    this.manualPause = false;
    this.status = 'running';
    this.lastActivity = Date.now();
    this.message = '';
    this.emit();
  }

  private startTicking() {
    window.clearInterval(this.tick);
    this.tick = window.setInterval(() => this.everySecond(), 1000);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onHide);
  }

  private everySecond() {
    if (!this.session || this.status === 'stopped' || this.status === 'conflict' || this.status === 'error' || this.status === 'starting') return;
    if (document.visibilityState === 'hidden') return; // hidden time is not counted (the beacon already saved)
    if (this.manualPause) { this.pending.pause++; this.status = 'paused'; }
    else if ((Date.now() - this.lastActivity) / 1000 > IDLE_AFTER_SEC) { this.pending.idle++; this.idleRun++; this.status = 'idle'; }
    else { this.pending.active++; this.status = 'running'; }
    const d = this.ctx().replayDate;
    if (d) { this.dates.from = !this.dates.from || d < this.dates.from ? d : this.dates.from; this.dates.to = !this.dates.to || d > this.dates.to ? d : this.dates.to; }
    this.save();
    this.emit();
    if (this.idleRun >= AUTO_STOP_IDLE_SEC) { this.message = 'Stopped after an hour without activity.'; void this.stop(); return; }
    if (++this.sinceBeat >= BEAT_EVERY_SEC) { this.sinceBeat = 0; void this.beat(); }
  }

  private save() {
    if (!this.session) return;
    try { sessionStorage.setItem(STORE, JSON.stringify({ sessionId: this.session.id, seq: this.seq, pending: this.pending } as Stored)); } catch { /* storage unavailable */ }
  }

  private payload(seq: number) {
    const c = this.ctx();
    return {
      tabId: this.tab, seq, activeSec: this.pending.active, idleSec: this.pending.idle, pauseSec: this.pending.pause,
      status: this.manualPause ? 'paused' : this.status === 'idle' ? 'idle' : 'running',
      replayFrom: this.dates.from, replayTo: this.dates.to,
      setupTag: c.setupTag || undefined, instrument: c.instrument || undefined, timeframe: c.timeframe || undefined,
    };
  }

  /** Send the seconds measured since the last successful beat. */
  async beat() {
    if (!this.session || this.sending || this.status === 'stopped' || this.status === 'conflict') return;
    this.sending = true;
    const seq = this.seq + 1;
    const body = this.payload(seq);
    const sent = { ...this.pending };
    try {
      const r = await axios.post(`/api/bt-sessions/${this.session.id}/beat`, body, this.auth());
      this.offline = false;
      if (r.data?.session) {
        this.seq = seq;
        this.pending = { active: Math.max(0, this.pending.active - sent.active), idle: Math.max(0, this.pending.idle - sent.idle), pause: Math.max(0, this.pending.pause - sent.pause) };
        this.session = r.data.session;
        this.dates = { from: null, to: null };
        this.save();
      }
    } catch (e: any) {
      const st = e?.response?.status;
      if (st === 409) { this.status = 'conflict'; this.message = 'Another tab took over the timer.'; window.clearInterval(this.tick); }
      else if (st === 410) { this.status = 'stopped'; this.message = 'This session was closed.'; window.clearInterval(this.tick); activeId = null; }
      else this.offline = true; // keep the seconds; they go with the next beat
    } finally {
      this.sending = false;
      this.emit();
    }
  }

  private beacon() {
    if (!this.session || this.status === 'stopped' || this.status === 'conflict') return;
    const total = this.pending.active + this.pending.idle + this.pending.pause;
    if (total <= 0) return;
    const seq = this.seq + 1;
    const body = JSON.stringify({ token: this.token, sessionId: this.session.id, ...this.payload(seq) });
    const ok = navigator.sendBeacon?.('/api/bt-sessions/beacon', new Blob([body], { type: 'application/json' }));
    if (ok) {
      this.seq = seq;
      this.session = { ...this.session, active_sec: this.session.active_sec + this.pending.active, idle_sec: this.session.idle_sec + this.pending.idle, pause_sec: this.session.pause_sec + this.pending.pause, last_seq: seq };
      this.pending = { active: 0, idle: 0, pause: 0 };
      this.save();
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.beacon();
    else { this.lastActivity = Date.now(); this.idleRun = 0; void this.beat(); }
  };
  private onHide = () => this.beacon();

  pause() { this.manualPause = true; this.status = 'paused'; this.emit(); void this.beat(); }
  resume() { this.manualPause = false; this.activity(); this.status = 'running'; this.emit(); void this.beat(); }

  async takeOver() {
    if (!this.session) return;
    try {
      const r = await axios.post(`/api/bt-sessions/${this.session.id}/takeover`, { tabId: this.tab }, this.auth());
      this.adopt(r.data.session);
      this.startTicking();
    } catch { this.message = 'Could not take over the timer.'; this.emit(); }
  }

  async stop() {
    if (!this.session) return;
    window.clearInterval(this.tick);
    const seq = this.seq + 1;
    try {
      const r = await axios.post(`/api/bt-sessions/${this.session.id}/stop`, this.payload(seq), this.auth());
      this.session = r.data.session;
    } catch { /* the server closes it after 30 min without heartbeats */ }
    this.pending = { active: 0, idle: 0, pause: 0 };
    this.status = 'stopped';
    activeId = null;
    try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
    this.emit();
  }

  /** Leaving the page: save what we have and stop ticking (the session stays open for a while). */
  destroy() {
    this.beacon();
    window.clearInterval(this.tick);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onHide);
    if (activeId === this.session?.id) activeId = null;
    this.listeners.clear();
  }
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
