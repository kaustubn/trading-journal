import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import '../styles/PropStatus.css';

interface PropStatusProps {
  token: string;
  accountId: number;
  attempt?: number | null;
}

export default function PropStatus({ token, accountId, attempt }: PropStatusProps) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    starting_balance: '', profit_target: '', max_drawdown: '', daily_loss_limit: '', trailing: true,
    consistency_pct: '', min_trading_days: '',
  });

  const load = async () => {
    setLoading(true);
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
        trailing: form.trailing,
        consistency_pct: parseFloat(form.consistency_pct) || null,
        min_trading_days: parseInt(form.min_trading_days) || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setEditing(false);
      load();
    } catch (e) { console.error(e); }
  };

  if (loading) return null;

  // Not configured → compact call-to-action
  if (!status?.configured && !editing) {
    return (
      <div className="prop-status not-configured">
        <div>
          <strong>🎯 Prop-firm rules</strong>
          <span> — track drawdown & profit target for this account (Lucid, Apex, TopStep, etc.)</span>
        </div>
        <button className="btn-primary" onClick={() => setEditing(true)}>Set up rules</button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="prop-status">
        <div className="prop-header"><h3>🎯 Prop-Firm Rules</h3></div>
        <div className="prop-form">
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
          <div className="pf-field pf-toggle">
            <label>
              <input type="checkbox" checked={form.trailing}
                onChange={e => setForm({ ...form, trailing: e.target.checked })} />
              Trailing drawdown (follows peak)
            </label>
          </div>
        </div>
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
        <h3>🎯 Prop-Firm Standing {s.trailing ? '· trailing' : '· static'}</h3>
        <button className="btn-edit" onClick={() => {
          setForm({
            starting_balance: String(s.startingBalance ?? ''),
            profit_target: String(s.target ?? ''),
            max_drawdown: String(s.maxDrawdown ?? ''),
            daily_loss_limit: String(s.dailyLossLimit ?? ''),
            trailing: s.trailing,
            consistency_pct: String(s.consistency?.rulePct ?? ''),
            min_trading_days: String(s.minDays?.required ?? ''),
          });
          setEditing(true);
        }}>Edit</button>
      </div>

      {(s.drawdownBreached || s.dailyBreached) && (
        <div className="breach-banner">
          🛑 {s.drawdownBreached ? 'MAX DRAWDOWN BREACHED' : ''} {s.dailyBreached ? 'DAILY LOSS LIMIT HIT' : ''}
        </div>
      )}
      {s.targetReached && !s.drawdownBreached && (
        <div className="target-banner">🏆 PROFIT TARGET REACHED</div>
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
                <span>Consistency · best day ≤ {money(cap, 0)} ({c.rulePct}% of {money(c.target, 0)} target)</span>
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
                  <span>✅ On track to pass. Your biggest day {money(best, 0)} is under the {money(cap, 0)} cap — keep any single day below {money(cap, 0)} and you comply. <span className="pf-hint">(Shows {share}% of your {money(c.totalProfit, 0)} so far; this % drops as you grow toward target.)</span></span>
                ) : (
                  <span>⚠ Biggest day {money(best, 0)} is over the {money(cap, 0)} cap. Book more profit on OTHER days so no single day tops {money(cap, 0)}. Don't take losses — that makes it worse.</span>
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
              <span>Consistency · best day ≤ {c.rulePct}% of profit</span>
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
                <span>✅ On track. Best day {money(c.bestDayProfit, 0)} is {share}% of {money(c.totalProfit, 0)}. A single day can be up to {money(c.maxDayAllowedNow, 0)} now.</span>
              ) : (
                <span>⚠ Best day {money(c.bestDayProfit, 0)} = {share}% (limit {c.rulePct}%). Grow total profit to {money(c.minTotalForRule, 0)} — need <b>{money(c.extraProfitNeeded, 0)}</b> more on OTHER days to comply.</span>
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
            {s.minDays.tradedSoFar} / {s.minDays.required} {s.minDays.pass ? '✅' : `· ${s.minDays.remaining} to go`}
          </span>
        </div>
      )}
    </div>
  );
}
