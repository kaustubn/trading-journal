import React, { useEffect, useState } from 'react';
import { ReplayEngine, OrderInput, Side, ClosedTrade, rOf } from '../chart/replay';
import { Contract, fmtPrice, fmtUsd, signed } from '../chart/drawings';
import { Clock, fmtWall } from '../chart/time';
import { useOptions, values } from '../utils/options';

const SPEEDS = [0.5, 1, 2, 3, 5, 10];
const REASON: Record<ClosedTrade['reason'], string> = { target: 'target', stop: 'stop', manual: 'closed', end: 'replay ended' };

interface Account { id: number; account_name: string; }
interface Props {
  engine: ReplayEngine;
  clock: Clock;
  accounts: Account[];
  accountId: number | null;
  onAccount: (id: number) => void;
  onRetry: (t: ClosedTrade) => void;
  onExit: () => void;
}

// Order ticket defaults are a per-browser convenience
const DEF_KEY = 'mc.replay.order';
type Defaults = Omit<OrderInput, 'side' | 'notes'>;
function loadDefaults(): Defaults {
  const d: Defaults = { qty: 1, contract: 'NQ', stopPts: 20, target: 2, targetUnit: 'R', setup: '' };
  try {
    const s = JSON.parse(localStorage.getItem(DEF_KEY) || 'null');
    if (s && typeof s === 'object') {
      if (Number.isInteger(s.qty) && s.qty >= 1 && s.qty <= 100) d.qty = s.qty;
      if (s.contract === 'NQ' || s.contract === 'MNQ') d.contract = s.contract;
      if (Number.isFinite(s.stopPts) && s.stopPts > 0) d.stopPts = s.stopPts;
      if (Number.isFinite(s.target) && s.target > 0) d.target = s.target;
      if (s.targetUnit === 'R' || s.targetUnit === 'pts') d.targetUnit = s.targetUnit;
      if (typeof s.setup === 'string') d.setup = s.setup;
    }
  } catch { /* storage unavailable: use defaults */ }
  return d;
}

export default function ReplayBar({ engine: e, clock, accounts, accountId, onAccount, onRetry, onExit }: Props) {
  const [ticket, setTicket] = useState<Side | null>(null);
  const [form, setForm] = useState(() => ({ ...loadDefaults(), notes: '' }));
  const [err, setErr] = useState('');
  const [showTrades, setShowTrades] = useState(false);
  const opts = useOptions();
  const setups = values(opts, 'setup');

  useEffect(() => { if (e.position) setTicket(null); }, [e.position]);

  const p = e.position;
  const price = e.price;
  const total = e.trades.reduce((s, t) => s + t.pnl, 0);
  const wins = e.trades.filter(t => t.pnl > 0).length;
  const failed = e.trades.filter(t => t.saved === 'failed');
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!ticket) return;
    const o: OrderInput = { ...form, side: ticket };
    if (!Number.isInteger(o.qty) || o.qty < 1 || o.qty > 100) { setErr('Quantity must be 1–100.'); return; }
    const msg = e.open(o);
    if (msg) { setErr(msg); return; }
    setErr('');
    setTicket(null);
    try { const { notes: _n, ...keep } = form; localStorage.setItem(DEF_KEY, JSON.stringify(keep)); } catch { /* ignore */ }
    setForm(f => ({ ...f, notes: '' }));
  };

  const reward = form.targetUnit === 'R' ? form.stopPts * form.target : form.target;
  const pv = form.contract === 'NQ' ? 20 : 2;

  return (
    <div className="mc-replay" onMouseDown={ev => ev.stopPropagation()}>
      {ticket && (
        <form className="mc-ticket" onSubmit={submit} noValidate>
          <div className="mc-panel-title">{ticket === 'long' ? 'Buy' : 'Sell'} at market{price !== null ? ` · ${fmtPrice(price)}` : ''}</div>
          <div className="mc-row">
            <label className="mc-field">Qty
              <input className="mc-input" type="number" min={1} max={100} step={1} value={Number.isFinite(form.qty) ? form.qty : ''}
                onChange={ev => setForm(f => ({ ...f, qty: Math.round(num(ev.target.value)) }))} />
            </label>
            <div className="mc-seg" title="Contract">
              {(['NQ', 'MNQ'] as Contract[]).map(c => (
                <button type="button" key={c} className={form.contract === c ? 'on' : ''} onClick={() => setForm(f => ({ ...f, contract: c }))}>{c}</button>
              ))}
            </div>
          </div>
          <div className="mc-row">
            <label className="mc-field">Stop (pts)
              <input className="mc-input" type="number" min={0.25} step={0.25} value={Number.isFinite(form.stopPts) ? form.stopPts : ''}
                onChange={ev => setForm(f => ({ ...f, stopPts: num(ev.target.value) }))} />
            </label>
            <label className="mc-field">Target
              <input className="mc-input" type="number" min={0.25} step="any" value={Number.isFinite(form.target) ? form.target : ''}
                onChange={ev => setForm(f => ({ ...f, target: num(ev.target.value) }))} />
            </label>
            <div className="mc-seg" title="Target in R (multiples of the stop) or points">
              {(['R', 'pts'] as const).map(u => (
                <button type="button" key={u} className={form.targetUnit === u ? 'on' : ''} onClick={() => setForm(f => ({ ...f, targetUnit: u }))}>{u}</button>
              ))}
            </div>
          </div>
          {Number.isFinite(reward) && Number.isFinite(form.stopPts) && Number.isFinite(form.qty) && (
            <div className="mc-hint">Risk {fmtUsd(form.stopPts * pv * form.qty)} · reward {fmtUsd(reward * pv * form.qty)} · {(reward / form.stopPts).toFixed(2)}R</div>
          )}
          <div className="mc-row">
            <label className="mc-field mc-grow">Setup
              <select className="mc-input" value={form.setup} onChange={ev => setForm(f => ({ ...f, setup: ev.target.value }))}>
                <option value="">—</option>
                {setups.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <input className="mc-input mc-wide" placeholder="Note (optional)" maxLength={500} value={form.notes}
            onChange={ev => setForm(f => ({ ...f, notes: ev.target.value }))} />
          {err && <div className="mc-hint mc-bad">{err}</div>}
          <div className="mc-row mc-row-end">
            <button type="button" className="mc-btn" onClick={() => { setTicket(null); setErr(''); }}>Cancel</button>
            <button type="submit" className={`mc-btn ${ticket === 'long' ? 'mc-buy' : 'mc-sell'}`}>
              {ticket === 'long' ? 'Buy' : 'Sell'} {form.qty} {form.contract}
            </button>
          </div>
        </form>
      )}

      {showTrades && (
        <div className="mc-ticket mc-trades">
          <div className="mc-panel-title">This session · {e.trades.length} trade{e.trades.length === 1 ? '' : 's'}</div>
          {!e.trades.length && <div className="mc-hint">Closed trades appear here and in the journal.</div>}
          {[...e.trades].reverse().map(t => (
            <div key={t.id} className="mc-trade-row">
              <span className={t.side === 'long' ? 'mc-up' : 'mc-down'}>{t.side === 'long' ? 'Long' : 'Short'}</span>
              <span className="mc-dim">{fmtWall(t.entryTime, clock).slice(5)} · {REASON[t.reason]}</span>
              <span className={t.pnl >= 0 ? 'mc-up' : 'mc-down'}>{signed(t.r, 1)}R {fmtUsd(t.pnl)}</span>
              {t.saved === 'saved' && <span className="mc-dim" title="Saved to the journal">✓</span>}
              {t.saved === 'pending' && <span className="mc-dim">saving…</span>}
              {t.saved === 'failed' && <button className="mc-btn mc-small mc-bad" title={t.error} onClick={() => onRetry(t)}>Retry save</button>}
            </div>
          ))}
        </div>
      )}

      <div className="mc-replay-row">
        <span className="mc-replay-tag">Replay</span>
        <button className="mc-btn" disabled={e.busy || e.playing} onClick={() => e.stepBack()} title="Step back (←)">⏮</button>
        <button className="mc-btn mc-play" disabled={e.ended} onClick={() => (e.playing ? e.pause() : e.play())} title="Play / pause (Space)">
          {e.playing ? '⏸' : '▶'}
        </button>
        <button className="mc-btn" disabled={e.busy || e.playing || e.ended} onClick={() => e.stepForward()} title="Step forward (→)">⏭</button>
        <select className="mc-input mc-speed" value={e.speed} title="Steps per second"
          onChange={ev => { e.speed = Number(ev.target.value); if (e.playing) { e.pause(); e.play(); } else e.pause(); }}>
          {SPEEDS.map(s => <option key={s} value={s}>{s}/s</option>)}
        </select>
        <div className="mc-seg" title="Each step reveals one candle of the chart's timeframe, or one minute">
          {(['bar', '1m'] as const).map(m => (
            <button key={m} className={e.stepMode === m ? 'on' : ''} onClick={() => { e.stepMode = m; e.pause(); }}>{m === 'bar' ? 'Bar' : '1m'}</button>
          ))}
        </div>
        <span className="mc-dim mc-replay-time">{e.cursor ? `${fmtWall(e.cursor + 60000, clock)} ${clock}` : ''}</span>
        <span className="mc-sep" />
        {p ? (
          <>
            <span className={p.side === 'long' ? 'mc-up' : 'mc-down'}>{p.side === 'long' ? 'Long' : 'Short'} {p.qty} {p.contract} @ {fmtPrice(p.entry)}</span>
            <span className={e.openPnl >= 0 ? 'mc-up' : 'mc-down'}>
              {fmtUsd(e.openPnl)}{price !== null ? ` (${signed(rOf(p, price), 2)}R)` : ''}
            </span>
            <button className="mc-btn mc-small" onClick={() => e.closeAtMarket()} title="Close at the current price">Close</button>
          </>
        ) : (
          <>
            <button className="mc-btn mc-buy" disabled={price === null} onClick={() => { setTicket(ticket === 'long' ? null : 'long'); setShowTrades(false); setErr(''); }}>Buy</button>
            <button className="mc-btn mc-sell" disabled={price === null} onClick={() => { setTicket(ticket === 'short' ? null : 'short'); setShowTrades(false); setErr(''); }}>Sell</button>
          </>
        )}
        <span className="mc-sep" />
        <button className={`mc-btn mc-small${showTrades ? ' open' : ''}`} onClick={() => { setShowTrades(!showTrades); setTicket(null); }}
          title="Trades taken in this replay session">
          {e.trades.length} trade{e.trades.length === 1 ? '' : 's'}{e.trades.length ? ` · ${wins}W · ${fmtUsd(total)}` : ''}
          {failed.length ? <span className="mc-bad"> · {failed.length} not saved</span> : null}
        </button>
        <select className="mc-input mc-acct" value={accountId ?? ''} title="Journal account replay trades are saved to"
          onChange={ev => onAccount(Number(ev.target.value))}>
          {accountId === null && <option value="">Save to…</option>}
          {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
        <button className="mc-btn mc-small" onClick={onExit} title={p ? 'Exit replay (closes the open position at the current price)' : 'Exit replay'}>✕</button>
      </div>
      {e.message && <div className="mc-replay-msg">{e.message}</div>}
    </div>
  );
}
