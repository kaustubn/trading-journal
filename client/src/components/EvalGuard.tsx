import { useState } from 'react';
import axios from 'axios';
import { Gauge, Trash2 } from 'lucide-react';
import { money, signedMoney } from '../utils/format';
import type { EvalStatus, GuardStatus } from '../../../src/shared/evalGuard';

// Eval Guard: the broker's end-of-day closing balance is the truth. The trader types it once a day;
// the panel says whether to keep trading, slow down, or stop for today. Read-only — never places orders.

interface GuardData {
  today: string;
  closes: { day: string; balance: number }[];
  status: EvalStatus | null;
}

const LABEL: Record<GuardStatus, string> = {
  PUSH: 'PUSH', CAUTION: 'CAUTION', DONE_TODAY: 'DONE TODAY', PASSED: 'TARGET MET', BREACHED: 'BREACHED',
};
const MEANING: Record<GuardStatus, string> = {
  PUSH: 'Rules are fine. Trade your plan.',
  CAUTION: 'Allowed, but slow down.',
  DONE_TODAY: 'Stop trading for today.',
  PASSED: 'Stop and confirm the pass in your firm dashboard.',
  BREACHED: 'The max-loss floor was hit. Check the firm dashboard.',
};

export default function EvalGuard({ token, accountId, data, onChange }: {
  token: string; accountId: number; data: GuardData; onChange: () => void;
}) {
  const [day, setDay] = useState(data.today);
  const [balance, setBalance] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const s = data.status;
  const headers = { Authorization: `Bearer ${token}` };

  const save = async () => {
    setError('');
    const value = Number(balance);
    if (!day || !Number.isFinite(value) || value <= 0) { setError('Enter the date and the closing balance from your broker.'); return; }
    setBusy(true);
    try {
      await axios.put(`/api/accounts/${accountId}/eval-closes`, { day, balance: value }, { headers });
      setBalance('');
      onChange();
    } catch (e: any) { setError(e?.response?.data?.error || 'Could not save the closing balance.'); }
    finally { setBusy(false); }
  };
  const remove = async (d: string) => {
    if (!window.confirm(`Remove the closing balance for ${d}?`)) return;
    try { await axios.delete(`/api/accounts/${accountId}/eval-closes/${d}`, { headers }); onChange(); }
    catch { setError('Could not remove that close.'); }
  };

  if (!s) {
    return (
      <div className="eval-guard">
        <div className="eg-head"><Gauge className="ic-sm" /> Eval Guard</div>
        <p className="pf-hint">Set a starting balance and max drawdown above to use the guard.</p>
      </div>
    );
  }

  const flagged = s.checks.filter(c => c.flagged);
  const closeByDay = new Map(data.closes.map(c => [c.day, c.balance]));
  return (
    <div className={`eval-guard eg-${s.status.toLowerCase()}`}>
      <div className="eg-head">
        <span><Gauge className="ic-sm" /> Eval Guard <span className="pf-hint">from your broker closing balances</span></span>
        <span className={`eg-badge eg-${s.status.toLowerCase()}`} title={MEANING[s.status]}>{LABEL[s.status]}</span>
      </div>
      <div className="eg-meaning">{MEANING[s.status]}</div>
      {s.reasons.length > 0 && <ul className="eg-reasons">{s.reasons.map(r => <li key={r}>{r}</li>)}</ul>}

      <div className="prop-grid eg-grid">
        <div className="pf-stat">
          <div className="pf-label">Buffer to floor</div>
          <div className={`pf-value ${s.buffer <= 0 ? 'negative' : ''}`}>{money(s.buffer, 0)}</div>
          <div className="pf-sub">floor {money(s.floor, 0)}{s.floorLocked ? ' · locked' : ''}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-label">To target</div>
          <div className="pf-value">{s.toTarget <= 0 ? 'Met' : money(s.toTarget, 0)}</div>
          <div className="pf-sub">need {money(s.requiredTotal, 0)} total · have {signedMoney(s.profit, 0)}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-label">Today</div>
          <div className={`pf-value ${(s.todayPnl ?? 0) < 0 ? 'negative' : (s.todayPnl ?? 0) > 0 ? 'positive' : ''}`}>
            {s.todayPnl === null ? '—' : money(s.todayPnl, 0)}</div>
          <div className="pf-sub">{s.todayCap === null ? 'no consistency rule'
            : `room ${money(Math.max(0, s.todayRoom ?? s.todayCap), 0)} before target rises`}{s.todayFromClose ? ' · from close' : s.todayPnl !== null ? ' · journal' : ''}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-label">Days traded</div>
          <div className="pf-value">{s.daysTraded}</div>
          <div className="pf-sub">{s.greenStreak > 0 ? `${s.greenStreak} green in a row` : 'largest day ' + money(s.largestDay, 0)}</div>
        </div>
      </div>

      <div className="eg-entry">
        <label>Closing balance from your broker</label>
        <input type="date" value={day} max={data.today} onChange={e => setDay(e.target.value)} />
        <input type="number" inputMode="decimal" step="0.01" placeholder="e.g. 25340.50" value={balance}
          onChange={e => setBalance(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        <button className="btn-primary" disabled={busy} onClick={save}>{closeByDay.has(day) ? 'Update' : 'Save'}</button>
      </div>
      {error && <div className="eg-error">{error}</div>}

      {flagged.length > 0 && (
        <div className="eg-flags">
          {flagged.slice(0, 5).map(c => (
            <div key={c.day}>⚠ {c.day}: {c.closePnl === null
              ? `journal shows ${money(c.journalPnl, 2)} but no closing balance is typed`
              : `broker ${money(c.closePnl, 2)} vs journal ${money(c.journalPnl, 2)} (gap ${money(c.gap, 2)})`}</div>
          ))}
        </div>
      )}

      {data.closes.length > 0 && (
        <details className="eg-history">
          <summary>Closing balances ({data.closes.length})</summary>
          {[...data.closes].reverse().map(c => {
            const check = s.checks.find(x => x.day === c.day);
            return (
              <div key={c.day} className="eg-row">
                <span>{c.day}</span><span>{money(c.balance, 2)}</span>
                <span className={(check?.closePnl ?? 0) >= 0 ? 'positive' : 'negative'}>{check?.closePnl != null ? signedMoney(check.closePnl, 2) : ''}</span>
                <button className="eg-del" title="Remove" onClick={() => remove(c.day)}><Trash2 className="ic-sm" /></button>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
