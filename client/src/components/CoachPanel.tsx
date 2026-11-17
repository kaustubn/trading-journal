import React, { useEffect, useRef, useState } from 'react';
import { CoachRules, AiMode, fmtWindows } from '../chart/coach';
import { Clock, fmtWall } from '../chart/time';

export type Verdict = 'GO' | 'CAUTION' | 'STOP' | 'INFO';
export interface CoachMsg {
  id: number;
  at: number;                  // chart time it refers to (replay cursor or now)
  from: 'rule' | 'claude' | 'you' | 'error';
  verdict?: Verdict;
  text: string;
}

interface Props {
  rules: CoachRules;
  onRules: (r: CoachRules) => void;
  msgs: CoachMsg[];
  busy: boolean;
  clock: Clock;
  onAsk: (q: string) => void;
  onReview: () => void;
  onClear: () => void;
  onClose: () => void;
}

const AI_LABEL: Record<AiMode, string> = { off: 'Off', ask: 'When I ask', trades: 'Every trade' };

export default function CoachPanel({ rules, onRules, msgs, busy, clock, onAsk, onReview, onClear, onClose }: Props) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'chat' | 'rules'>('chat');
  const [winText, setWinText] = useState(() => rules.windows.map(w => `${w.from}-${w.to}`).join(', '));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs.length, busy]);

  const set = (patch: Partial<CoachRules>) => onRules({ ...rules, ...patch });
  const num = (k: keyof CoachRules, label: string, hint: string, step = 1) => (
    <label className="mc-field" title={hint}>{label}
      <input className="mc-input" type="number" min={0} step={step} value={rules[k] as number}
        onChange={ev => { const v = Number(ev.target.value); if (Number.isFinite(v) && v >= 0) set({ [k]: v } as Partial<CoachRules>); }} />
    </label>
  );
  const saveWindows = () => {
    const out: { from: string; to: string }[] = [];
    for (const part of winText.split(',').map(x => x.trim()).filter(Boolean)) {
      const m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(part);
      if (!m) continue;
      const f = `${m[1].padStart(2, '0')}:${m[2]}`, t = `${m[3].padStart(2, '0')}:${m[4]}`;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(f) && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) out.push({ from: f, to: t });
    }
    set({ windows: out.slice(0, 4) });
    setWinText(out.slice(0, 4).map(w => `${w.from}-${w.to}`).join(', '));
  };
  const ask = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!q.trim() || busy) return;
    onAsk(q.trim());
    setQ('');
  };

  return (
    <div className="mc-coach" onMouseDown={ev => ev.stopPropagation()}>
      <div className="mc-coach-head">
        <span className="mc-panel-title">Coach</span>
        <div className="mc-seg">
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
          <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Rules</button>
        </div>
        <label className="mc-check" title="Turn all rule checks on or off">
          <input type="checkbox" checked={rules.enabled} onChange={ev => set({ enabled: ev.target.checked })} /> On
        </label>
        <button className="mc-btn mc-small" onClick={onClose} title="Hide the coach">✕</button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="mc-coach-list" ref={listRef}>
            {!msgs.length && (
              <div className="mc-hint">
                I check every order against your rules and pause the replay when you break one.
                {rules.ai !== 'off' && ' Ask Claude about the chart any time'}{rules.ai === 'trades' && ' — Claude also reviews each entry and exit'}.
              </div>
            )}
            {msgs.map(m => (
              <div key={m.id} className={`mc-coach-msg mc-from-${m.from}${m.verdict ? ` mc-v-${m.verdict.toLowerCase()}` : ''}`}>
                <div className="mc-coach-meta">
                  {m.from === 'claude' ? 'Claude' : m.from === 'rule' ? 'Rule check' : m.from === 'you' ? 'You' : 'Error'}
                  {m.verdict && m.verdict !== 'INFO' && <b className="mc-verdict">{m.verdict}</b>}
                  <span className="mc-dim">{fmtWall(m.at, clock).slice(5)}</span>
                </div>
                <div className="mc-coach-text">{m.text}</div>
              </div>
            ))}
            {busy && <div className="mc-coach-msg mc-from-claude"><div className="mc-coach-text mc-dim">Claude is looking at the charts…</div></div>}
          </div>
          {rules.ai !== 'off' ? (
            <form className="mc-coach-ask" onSubmit={ask}>
              <input className="mc-input mc-grow" placeholder="Ask Claude about this chart…" maxLength={1000} value={q}
                onChange={ev => setQ(ev.target.value)} onKeyDown={ev => ev.stopPropagation()} />
              <button className="mc-btn" type="submit" disabled={busy || !q.trim()}>Ask</button>
            </form>
          ) : <div className="mc-hint">Claude is off — rule checks still run. Turn it on in Rules.</div>}
          <div className="mc-row mc-row-end">
            {rules.ai !== 'off' && <button className="mc-btn mc-small" disabled={busy} onClick={onReview} title="Claude reads the charts now and tells you what it sees">Read the chart</button>}
            {msgs.length > 0 && <button className="mc-btn mc-small" onClick={onClear}>Clear</button>}
          </div>
        </>
      ) : (
        <div className="mc-coach-rules" onKeyDown={ev => ev.stopPropagation()}>
          <label className="mc-field mc-wide" title="New York time, e.g. 09:30-11:30, 15:00-16:00 — leave empty for any time">Prime-time windows (ET)
            <input className="mc-input" value={winText} onChange={ev => setWinText(ev.target.value)} onBlur={saveWindows}
              placeholder="09:30-11:30, 15:00-16:00" />
          </label>
          <div className="mc-hint">Now: {fmtWindows(rules.windows)}</div>
          <div className="mc-row">
            {num('minRR', 'Min R:R', 'Reward-to-risk an entry needs', 0.25)}
            {num('maxRiskUsd', 'Max risk $', 'Dollars at risk per trade (0 = no cap)', 50)}
          </div>
          <div className="mc-row">
            {num('maxTradesPerDay', 'Trades/day', 'Maximum entries per trading day (0 = no cap)')}
            {num('maxLossesPerDay', 'Losers/day', 'Stop after this many losing trades (0 = no cap)')}
          </div>
          <div className="mc-row">
            {num('dailyLossUsd', 'Daily stop $', 'Stop trading after losing this much in a day (0 = no cap)', 50)}
            {num('cooldownMin', 'Cooldown min', 'Minutes to wait after a loss (0 = none)')}
          </div>
          <label className="mc-check"><input type="checkbox" checked={rules.requireSetup} onChange={ev => set({ requireSetup: ev.target.checked })} /> Every entry must name a setup</label>
          <label className="mc-check"><input type="checkbox" checked={rules.noWidenStop} onChange={ev => set({ noWidenStop: ev.target.checked })} /> Widening the stop is a rule break</label>
          <label className="mc-check"><input type="checkbox" checked={rules.pauseOnBreak} onChange={ev => set({ pauseOnBreak: ev.target.checked })} /> Pause and ask before a rule-breaking order</label>
          <div className="mc-row">
            <span className="mc-dim">Claude</span>
            <div className="mc-seg" title="Claude costs about 1–3 cents per review (Anthropic API credit)">
              {(['off', 'ask', 'trades'] as AiMode[]).map(m => (
                <button key={m} className={rules.ai === m ? 'on' : ''} onClick={() => set({ ai: m })}>{AI_LABEL[m]}</button>
              ))}
            </div>
          </div>
          <div className="mc-hint">“Every trade”: Claude reviews each entry before it is placed (STOP pauses the replay) and each exit after it closes. About 1–3¢ per review.</div>
        </div>
      )}
    </div>
  );
}
