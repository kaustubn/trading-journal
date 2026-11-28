import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldCheck, OctagonX, Trophy, CheckCircle2, AlertTriangle } from 'lucide-react';
import { num, money } from '../utils/format';
import '../styles/PropStatus.css';
import { PROP_PRESETS, DdType } from '../../../src/shared/propRules';
import EvalGuard from './EvalGuard';

const DD_LABEL: Record<DdType, string> = { eod: 'end-of-day trailing', intraday: 'intraday trailing', static: 'static' };

interface PropStatusProps {
  token: string;
  accountId: number;
  attempt?: number | null;
}

export default function PropStatus({ token, accountId, attempt }: PropStatusProps) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({
    starting_balance: '', profit_target: '', max_drawdown: '', daily_loss_limit: '', trailing: true,
    consistency_pct: '', min_trading_days: '', dd_type: 'eod' as DdType, lock_at_start: false, preset: '',
    lock_trigger: '', lock_floor: '', daily_stop: '',
  });
  const applyPreset = (id: string) => {
    const p = PROP_PRESETS.find(x => x.id === id);
    if (!p) { setForm(f => ({ ...f, preset: '' })); return; }
    const v = (x: number | null) => (x == null ? '' : String(x));
    setForm(f => ({ ...f, preset: p.id, starting_balance: String(p.size), profit_target: v(p.target), max_drawdown: v(p.maxDrawdown),
      daily_loss_limit: v(p.dailyLoss), consistency_pct: v(p.consistencyPct), min_trading_days: v(p.minDays), dd_type: p.ddType,
      lock_at_start: p.lockAtStart, trailing: p.ddType !== 'static',
      lock_trigger: v(p.lockTrigger ?? null), lock_floor: v(p.lockFloor ?? null) }));
  };
  const preset = PROP_PRESETS.find(x => x.id === form.preset);

  // quiet = refresh in place (no loading flash), e.g. after typing a closing balance
  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await axios.get(`/api/accounts/${accountId}/prop-status`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { attempt: attempt || undefined },
      });
      setStatus(res.data.data);
    } catch { setStatus(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [accountId, attempt]);

  const save = async () => {
    try {
      await axios.put(`/api/accounts/${accountId}/prop-rules`, {
        starting_balance: parseFloat(form.starting_balance) || null,
        profit_target: parseFloat(form.profit_target) || null,
        max_drawdown: parseFloat(form.max_drawdown) || null,
        daily_loss_limit: parseFloat(form.daily_loss_limit) || null,
        trailing: form.dd_type !== 'static',
        dd_type: form.dd_type,
        lock_at_start: form.lock_at_start,
        preset: form.preset || null,
        consistency_pct: parseFloat(form.consistency_pct) || null,
        min_trading_days: parseInt(form.min_trading_days) || null,
        lock_trigger: parseFloat(form.lock_trigger) || null,
        lock_floor: parseFloat(form.lock_floor) || null,
        daily_stop: parseFloat(form.daily_stop) || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setEditing(false);
      setSaveError('');
      load();
    } catch (e: any) { setSaveError(e?.response?.data?.error || 'Could not save the rules.'); }
  };

  if (loading) return null;

  // Not configured → compact call-to-action
  if (!status?.configured && !editing) {
    return (
      <div className="prop-status not-configured">
        <div>
          <strong><ShieldCheck className="ic-sm" /> Prop-firm rules</strong>
          <span> — track drawdown & profit target for this account (Lucid, Apex, TopStep, etc.)</span>
        </div>
        <button className="btn-primary" onClick={() => setEditing(true)}>Set up rules</button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="prop-status">
        <div className="prop-header"><h3><ShieldCheck className="ic-sm" /> Prop-firm rules</h3></div>
        <div className="prop-form">
          <div className="pf-field pf-wide"><label>Firm preset <span className="pf-hint">fills the fields; check them against your firm's current rules</span></label>
            <select value={form.preset} onChange={e => applyPreset(e.target.value)}>
              <option value="">Custom rules</option>
              {PROP_PRESETS.map(p => <option key={p.id} value={p.id}>{p.firm} — {p.plan}</option>)}
            </select>
            {preset && <span className="pf-hint">{preset.note} Rules checked {preset.checked} ({preset.source}).</span>}
          </div>
          <div className="pf-field"><label>Starting Balance</label>
            <input type="number" value={form.starting_balance} placeholder="24000"
              onChange={e => setForm({ ...form, starting_balance: e.target.value })} /></div>
          <div className="pf-field"><label>Profit Target ($)</label>
            <input type="number" value={form.profit_target} placeholder="1250"
              onChange={e => setForm({ ...form, profit_target: e.target.value })} /></div>
          <div className="pf-field"><label>Max Drawdown ($)</label>
            <input type="number" value={form.max_drawdown} placeholder="1500"
              onChange={e => setForm({ ...form, max_drawdown: e.target.value })} /></div>
          <div className="pf-field"><label>Daily Loss Limit ($)</label>
            <input type="number" value={form.daily_loss_limit} placeholder="600"
              onChange={e => setForm({ ...form, daily_loss_limit: e.target.value })} /></div>
          <div className="pf-field"><label>Consistency Rule (%) <span className="pf-hint">best day ≤ X% of profit</span></label>
            <input type="number" value={form.consistency_pct} placeholder="30"
              onChange={e => setForm({ ...form, consistency_pct: e.target.value })} /></div>
          <div className="pf-field"><label>Min Trading Days</label>
            <input type="number" value={form.min_trading_days} placeholder="5"
              onChange={e => setForm({ ...form, min_trading_days: e.target.value })} /></div>
          <div className="pf-field"><label>Drawdown type</label>
            <select value={form.dd_type} onChange={e => setForm({ ...form, dd_type: e.target.value as DdType })}>
              <option value="eod">End-of-day trailing</option>
              <option value="intraday">Intraday trailing</option>
              <option value="static">Static (never moves)</option>
            </select>
          </div>
          <div className="pf-field pf-toggle">
            <label>
              <input type="checkbox" checked={form.lock_at_start} disabled={form.dd_type === 'static'}
                onChange={e => setForm({ ...form, lock_at_start: e.target.checked })} />
              Floor stops at the starting balance
            </label>
          </div>
          <div className="pf-field"><label>Lock trigger ($) <span className="pf-hint">a close at this balance locks the floor</span></label>
            <input type="number" value={form.lock_trigger} placeholder="26100" disabled={form.dd_type !== 'eod'}
              onChange={e => setForm({ ...form, lock_trigger: e.target.value })} /></div>
          <div className="pf-field"><label>Lock floor ($) <span className="pf-hint">where the floor stops</span></label>
            <input type="number" value={form.lock_floor} placeholder="25100" disabled={form.dd_type !== 'eod'}
              onChange={e => setForm({ ...form, lock_floor: e.target.value })} /></div>
          <div className="pf-field"><label>Personal daily stop ($) <span className="pf-hint">your own limit, tighter than the firm's</span></label>
            <input type="number" value={form.daily_stop} placeholder="200"
              onChange={e => setForm({ ...form, daily_stop: e.target.value })} /></div>
        </div>
        {saveError && <div className="eg-error">{saveError}</div>}
        <div className="prop-actions">
          <button className="cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save Rules</button>
        </div>
      </div>
    );
  }

  const s = status;
  const targetPct = Math.max(0, Math.min(100, num(s.targetProgress)));
  const ddTotal = num(s.maxDrawdown);
  const ddUsed = ddTotal > 0 ? Math.max(0, Math.min(100, (1 - num(s.drawdownHeadroom) / ddTotal) * 100)) : 0;

  return (
    <div className={`prop-status ${s.drawdownBreached || s.dailyBreached ? 'breached' : ''}`}>
      <div className="prop-header">
        <h3><ShieldCheck className="ic-sm" /> Prop-firm standing <span className="pf-kind">{DD_LABEL[(s.ddType as DdType) || 'intraday']}{s.floorLocked ? ' · floor locked at start' : ''}</span></h3>
        <button className="btn-edit" onClick={() => {
          setForm({
            starting_balance: String(s.startingBalance ?? ''),
            profit_target: String(s.target ?? ''),
            max_drawdown: String(s.maxDrawdown ?? ''),
            daily_loss_limit: String(s.dailyLossLimit ?? ''),
            trailing: s.trailing,
            consistency_pct: String(s.consistency?.rulePct ?? ''),
            min_trading_days: String(s.minDays?.required ?? ''),
            dd_type: (s.ddType as DdType) || 'intraday',
            lock_at_start: !!s.lockAtStart,
            preset: s.preset || '',
            lock_trigger: String(s.lockTrigger ?? ''),
            lock_floor: String(s.lockFloor ?? ''),
            daily_stop: String(s.dailyStop ?? ''),
          });
          setEditing(true);
        }}>Edit</button>
      </div>

      {(s.drawdownBreached || s.dailyBreached) && (
        <div className="breach-banner">
          <OctagonX className="ic-sm" /> {s.drawdownBreached ? 'MAX DRAWDOWN BREACHED' : ''} {s.dailyBreached ? 'DAILY LOSS LIMIT HIT' : ''}
        </div>
      )}
      {!s.drawdownBreached && (s.bufferLevel === 'danger' || s.bufferLevel === 'watch') && (
        <div className={`buffer-warn ${s.bufferLevel}`}>
          <AlertTriangle className="ic-sm" /> {money(s.drawdownHeadroom, 0)} left before the drawdown floor ({money(s.drawdownFloor, 0)}).
          {s.avgLoss != null && s.avgLoss < 0 && <> Your average losing trade is {money(Math.abs(s.avgLoss), 0)} — about {Math.max(0, Math.floor(num(s.drawdownHeadroom) / Math.abs(s.avgLoss)))} more average losses before the account is gone.</>}
          {s.ddType === 'intraday' && <> Intraday floors also follow open profit, which the journal can't see — your real floor may be higher.</>}
        </div>
      )}
      {s.targetReached && !s.drawdownBreached && (
        <div className="target-banner"><Trophy className="ic-sm" /> Profit target reached</div>
      )}

      <div className="prop-grid">
        <div className="pf-stat">
          <div className="pf-label">Equity</div>
          <div className="pf-value">{money(s.equity, 0)}</div>
          <div className="pf-sub">start {money(s.startingBalance, 0)}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-label">Net P&L</div>
          <div className={`pf-value ${num(s.netPnl) >= 0 ? 'positive' : 'negative'}`}>{money(s.netPnl, 0)}</div>
          <div className="pf-sub">today {money(s.todayPnl, 0)}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-label">Drawdown Headroom</div>
          <div className={`pf-value ${num(s.drawdownHeadroom) <= 0 ? 'negative' : ''}`}>
            {s.maxDrawdown !== null ? money(s.drawdownHeadroom, 0) : '—'}
          </div>
          <div className="pf-sub">floor {s.drawdownFloor !== null ? money(s.drawdownFloor, 0) : '—'}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-label">Daily Room Left</div>
          <div className={`pf-value ${num(s.dailyHeadroom) <= 0 ? 'negative' : ''}`}>
            {s.dailyLossLimit !== null ? money(s.dailyHeadroom, 0) : '—'}
          </div>
          <div className="pf-sub">limit {s.dailyLossLimit !== null ? money(s.dailyLossLimit, 0) : '—'}</div>
        </div>
      </div>

      {s.target !== null && (
        <div className="pf-bar-wrap">
          <div className="pf-bar-label"><span>Profit target</span><span>{targetPct.toFixed(0)}% · {money(s.distanceToTarget, 0)} to go</span></div>
          <div className="pf-bar"><div className="pf-bar-fill target" style={{ width: `${targetPct}%` }} /></div>
        </div>
      )}
      {s.maxDrawdown !== null && (
        <div className="pf-bar-wrap">
          <div className="pf-bar-label"><span>Drawdown used</span><span>{ddUsed.toFixed(0)}% of {money(s.maxDrawdown, 0)}</span></div>
          <div className="pf-bar"><div className={`pf-bar-fill dd ${ddUsed > 80 ? 'danger' : ''}`} style={{ width: `${ddUsed}%` }} /></div>
        </div>
      )}

      {/* Consistency rule — framed around the cap that actually gates passing */}
      {s.consistency && (() => {
        const c = s.consistency;
        const share = c.bestDayShare;
        const best = num(c.bestDayProfit);
        const hasTarget = c.maxDayAtTarget != null && num(c.maxDayAtTarget) > 0;

        if (hasTarget) {
          const cap = num(c.maxDayAtTarget);
          const pass = c.targetCapPass !== false;
          const fill = Math.max(0, Math.min(100, (best / cap) * 100));
          return (
            <div className={`pf-consistency ${best <= 0 ? '' : pass ? 'ok' : 'bad'}`}>
              <div className="pf-bar-label">
                <span>Consistency · best day ≤ {money(cap, 0)} ({c.rulePct}% of {money(c.target, 0)} target) <span className="pf-hint">From journal trades</span></span>
                <span>best {money(best, 0)}</span>
              </div>
              <div className="pf-bar">
                <div className={`pf-bar-fill cons ${pass ? '' : 'danger'}`} style={{ width: `${fill}%` }} />
                <div className="pf-bar-limit" style={{ left: '100%' }} />
              </div>
              <div className="pf-cons-detail">
                {best <= 0 ? (
                  <span>No winning day yet — this rule applies once you're in profit.</span>
                ) : pass ? (
                  <span><CheckCircle2 className="ic-sm pf-ok-ic" /> On track to pass. Your biggest day {money(best, 0)} is under the {money(cap, 0)} cap — keep any single day below {money(cap, 0)} and you comply. <span className="pf-hint">(Shows {share}% of your {money(c.totalProfit, 0)} so far; this % drops as you grow toward target.)</span></span>
                ) : (
                  <span><AlertTriangle className="ic-sm pf-warn-ic" /> Biggest day {money(best, 0)} is over the {money(cap, 0)} cap. Book more profit on OTHER days so no single day tops {money(cap, 0)}. Don't take losses — that makes it worse.</span>
                )}
              </div>
            </div>
          );
        }

        // No profit target set → fall back to the running-total version
        const over = c.pass === false;
        const fillPct = share !== null ? Math.max(0, Math.min(100, (share / c.rulePct) * 100)) : 0;
        return (
          <div className={`pf-consistency ${over ? 'bad' : c.pass ? 'ok' : ''}`}>
            <div className="pf-bar-label">
              <span>Consistency · best day ≤ {c.rulePct}% of profit <span className="pf-hint">From journal trades</span></span>
              <span>{share !== null ? `${share}% now` : 'no profit yet'}</span>
            </div>
            <div className="pf-bar">
              <div className={`pf-bar-fill cons ${over ? 'danger' : ''}`} style={{ width: `${fillPct}%` }} />
              <div className="pf-bar-limit" style={{ left: '100%' }} />
            </div>
            <div className="pf-cons-detail">
              {c.bestDayShare === null ? (
                <span>Best day {money(c.bestDayProfit, 0)} — need net profit before this rule applies.</span>
              ) : c.pass ? (
                <span><CheckCircle2 className="ic-sm pf-ok-ic" /> On track. Best day {money(c.bestDayProfit, 0)} is {share}% of {money(c.totalProfit, 0)}. A single day can be up to {money(c.maxDayAllowedNow, 0)} now.</span>
              ) : (
                <span><AlertTriangle className="ic-sm pf-warn-ic" /> Best day {money(c.bestDayProfit, 0)} = {share}% (limit {c.rulePct}%). Grow total profit to {money(c.minTotalForRule, 0)} — need <b>{money(c.extraProfitNeeded, 0)}</b> more on OTHER days to comply.</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Minimum trading days */}
      {s.minDays && (
        <div className={`pf-mindays ${s.minDays.pass ? 'ok' : ''}`}>
          <span className="pf-mindays-label">Min trading days</span>
          <span className="pf-mindays-val">
            {s.minDays.tradedSoFar} / {s.minDays.required} {s.minDays.pass ? <CheckCircle2 className="ic-sm pf-ok-ic" /> : `· ${s.minDays.remaining} to go`}
          </span>
        </div>
      )}

      {s.evalGuard && <EvalGuard token={token} accountId={accountId} data={s.evalGuard} onChange={() => load(true)} />}
    </div>
  );
}
