// Practice-session timer shown while Market Chart replay is running (Backtest Session Tracker).
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square, Timer, RefreshCw, GripVertical, ChevronRight } from 'lucide-react';
import { useFloat } from '../utils/useFloat';
import { SessionTimer, TimerView, TimerContext, fmtDuration } from '../utils/sessionTimer';
import '../styles/PracticeLog.css';

interface Props {
  token: string;
  page?: string;
  /** Read on every second: replay date (YYYY-MM-DD, New York), instrument, timeframe. */
  context: () => Omit<TimerContext, 'setupTag'>;
  setups?: string[];
}

export default function SessionTimerBar({ token, page = 'marketchart', context, setups = [] }: Props) {
  const [view, setView] = useState<TimerView | null>(null);
  const [setup, setSetup] = useState<string>(() => { try { return localStorage.getItem('jc.btSetup') || ''; } catch { return ''; } });
  const setupRef = useRef(setup);
  const ctxRef = useRef(context);
  ctxRef.current = context;
  const timer = useRef<SessionTimer | null>(null);
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('jc.timerMini') === '1'; } catch { return false; } });
  const toggleMini = () => setMini(m => { try { localStorage.setItem('jc.timerMini', m ? '0' : '1'); } catch { /* ignore */ } return !m; });
  const fl = useFloat('jc.timerPos', toggleMini);

  useEffect(() => {
    const t = new SessionTimer({ token, page, context: () => ({ ...ctxRef.current(), setupTag: setupRef.current || null }) });
    timer.current = t;
    const off = t.subscribe(setView);
    void t.start();
    const act = () => t.activity();
    const evs: (keyof DocumentEventMap)[] = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
    evs.forEach(e => document.addEventListener(e, act, { passive: true }));
    return () => { evs.forEach(e => document.removeEventListener(e, act)); off(); t.destroy(); timer.current = null; };
  }, [token, page]);

  const changeSetup = (v: string) => {
    setSetup(v); setupRef.current = v;
    try { localStorage.setItem('jc.btSetup', v); } catch { /* ignore */ }
  };

  if (!view) return null;
  const t = timer.current;
  const label: Record<string, string> = {
    starting: 'Starting…', running: 'Practising', paused: 'Paused', idle: 'Idle (no activity for 5 min)',
    stopped: 'Session ended', conflict: 'Running in another tab', error: 'Timer unavailable',
  };
  return (
    <div ref={fl.boxRef} className={`btt btt-float btt-${view.status}${mini ? ' btt-mini' : ''}`} role="status" aria-live="polite" onMouseDown={e => e.stopPropagation()}
      style={{ transform: `translate(calc(-50% + ${fl.pos.x}px), ${fl.pos.y}px)` }}>
      <span className="btt-grip" onPointerDown={fl.startDrag} onDoubleClick={fl.reset}
        title={mini ? 'Click: open the timer · drag: move · double-click: back to the middle' : 'Click: fold the timer small · drag: move · double-click: back to the middle'}><GripVertical className="ic-sm" /></span>
      {mini ? (
        <>
          <span className="btt-dot" aria-hidden="true" />
          <span className="btt-time" title={label[view.status]}>{fmtDuration(view.activeSec)}</span>
          {view.status === 'paused' ? <button className="btt-mini-btn" onClick={() => t?.resume()} title="Resume"><Play className="ic-sm" /></button>
            : (view.status === 'running' || view.status === 'idle') ? <button className="btt-mini-btn" onClick={() => t?.pause()} title="Pause"><Pause className="ic-sm" /></button> : null}
          <button className="btt-mini-btn" onClick={toggleMini} title="Open the timer"><ChevronRight className="ic-sm" /></button>
        </>
      ) : (<>
      <Timer className="ic-sm" />
      <span className="btt-dot" aria-hidden="true" />
      <span className="btt-label">{label[view.status]}</span>
      <span className="btt-time" title="Active practice time this session">{fmtDuration(view.activeSec)}</span>
      <span className="btt-dim" title="Idle and paused time are not counted as practice">idle {fmtDuration(view.idleSec)} · paused {fmtDuration(view.pauseSec)} · {view.tradesLogged} trade{view.tradesLogged === 1 ? '' : 's'}</span>
      {view.offline && <span className="btt-warn" title="Saved locally; sent when the connection is back">offline</span>}
      <label className="btt-setup">Setup
        <input list="btt-setups" value={setup} onChange={e => changeSetup(e.target.value)} placeholder="e.g. VA80" maxLength={100} />
        <datalist id="btt-setups">{setups.map(s => <option key={s} value={s} />)}</datalist>
      </label>
      <span className="btt-actions">
        {(view.status === 'running' || view.status === 'idle') && <button onClick={() => t?.pause()}><Pause className="ic-sm" /> Pause</button>}
        {view.status === 'paused' && <button onClick={() => t?.resume()}><Play className="ic-sm" /> Resume</button>}
        {(view.status === 'running' || view.status === 'idle' || view.status === 'paused') && <button onClick={() => t?.stop()}><Square className="ic-sm" /> Stop</button>}
        {view.status === 'conflict' && <button onClick={() => t?.takeOver()}><RefreshCw className="ic-sm" /> Take over here</button>}
        {(view.status === 'stopped' || view.status === 'error') && <button onClick={() => t?.start()}><Play className="ic-sm" /> Start a new session</button>}
      </span>
      {view.message && <span className="btt-msg">{view.message}</span>}
      </>)}
    </div>
  );
}
