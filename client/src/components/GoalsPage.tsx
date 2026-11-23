// Goals: "I want to make X by date D — how?" Turns the goal into plans built from your own trades on this account
// (size, target and stop in points, trades per day), shows the win rate each needs and how often it got there in a
// simulation, and tracks saved goals against the account's real P&L. Estimates, not promises: you decide and trade.
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Flag, Trash2 } from 'lucide-react';
import { baseline as emptyBaseline, Baseline, STYLES, styleLevels, estimateWinRate, plan, tradingDays, progress, PlanResult, dayTargets, convert } from '../../../src/shared/goalPlanner';
import { money, currencySymbol, curSymbol } from '../utils/format';
import { EmptyState } from './ui';
import '../styles/Goals.css';

interface Acct { currency: string; costPerTrade: number; type?: string; dailyLossLimit: number | null; maxDrawdown: number | null; startingBalance: number | null; profitTarget: number | null }
interface SavedGoal { id: number; title: string | null; amount: number; start_date: string; end_date: string; plan: any; pnl: number; trades: number }
interface PlanEdit { targetPts: string; stopPts: string; tradesPerDay: string; lots: string }

const today = () => new Date().toLocaleDateString('en-CA');
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const numOr = (s: string, d: number | null): number | null => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) ? n : d; };
const pctTxt = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const pts = (x: number | null | undefined) => (x == null ? '—' : `${+x.toFixed(2)} pts`);
const VERDICT: Record<PlanResult['verdict'], string> = {
  realistic: 'Realistic', stretch: 'Stretch', unrealistic: 'Unlikely', dangerous: 'Too risky', 'no-edge': 'Need data', invalid: '—',
};
const QUICK = [['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 91]] as const;

export default function GoalsPage({ token, account_id }: { token: string; account_id: number | null }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [b, setB] = useState<Baseline | null>(null);
  const [acct, setAcct] = useState<Acct | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [goals, setGoals] = useState<SavedGoal[]>([]);
  const [reload, setReload] = useState(0);
  const [amount, setAmount] = useState('');
  const [end, setEnd] = useState(plusDays(14));
  const [title, setTitle] = useState('');
  const [as, setAs] = useState({ winRate: '', lotPv: '', costPerLot: '', dailyLossLimit: '', maxDrawdown: '', maxLots: '' });
  const [edits, setEdits] = useState<Record<string, PlanEdit>>({});
  const [chosen, setChosen] = useState('');
  const [saving, setSaving] = useState(false);
  const [fx, setFx] = useState<{ cad: Record<string, number>; live: boolean } | null>(null);
  const [cur, setCur] = useState('CAD');           // currency the goal is typed in (Kay withdraws in CAD)
  const [keep, setKeep] = useState('100');         // % of profit you keep (prop firm profit split)
  const [day, setDay] = useState({ green: '', pf: '' });

  useEffect(() => {
    if (!account_id) return;
    setErr(''); setB(null); setEdits({}); setChosen('');
    axios.get(`/api/goals/baseline/${account_id}`, auth).then(r => {
      setB(r.data.baseline); setAcct(r.data.account); setSymbol(r.data.symbol); setFx(r.data.fx ?? null); setDay({ green: '', pf: '' });
      const a: Acct = r.data.account;
      setAs({ winRate: '', lotPv: r.data.baseline.lotPv ? String(+r.data.baseline.lotPv.toFixed(2)) : '',
        costPerLot: a.costPerTrade ? String(a.costPerTrade) : '0',
        dailyLossLimit: a.dailyLossLimit ? String(a.dailyLossLimit) : '', maxDrawdown: a.maxDrawdown ? String(a.maxDrawdown) : '', maxLots: '' });
    }).catch(e => setErr(e?.response?.data?.error || 'Could not load your numbers.'));
  }, [account_id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!account_id) return;
    axios.get('/api/goals', { ...auth, params: { account_id } }).then(r => setGoals(r.data.goals || [])).catch(() => setGoals([]));
  }, [account_id, token, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = b ?? emptyBaseline([]);
  const fallbackStop = symbol && /^M?ES$/.test(symbol) ? 5 : symbol && /^M?NQ$/.test(symbol) ? 15 : 10;
  const days = tradingDays(today(), end);
  const acctCur = acct?.currency || 'INR';
  const entered = numOr(amount, 0) ?? 0;
  // prop accounts pay out a share of the profit; your own accounts (e.g. the INR one) keep all of it
  const isProp = acct?.type === 'simulation' || acct?.profitTarget != null;
  const keepPct = isProp ? Math.min(100, Math.max(1, numOr(keep, 100) ?? 100)) : 100;
  const goal = (() => {                             // what the account itself has to make, in its own currency
    const gross = entered / (keepPct / 100);
    if (cur === acctCur) return gross;
    const v = fx ? convert(gross, cur, acctCur, fx.cad) : NaN;
    return Number.isFinite(v) ? v : 0;
  })();
  const inCur = (v: number, c: string) => money(v, 0, curSymbol(c));
  /** The same amount in the other currencies (" · C$1,115 · ₹93,400"). */
  const others = (v: number) => ['CAD', 'USD', 'INR'].filter(c => c !== acctCur)
    .map(c => (fx ? convert(v, acctCur, c, fx.cad) : NaN)).map((x, i) => (Number.isFinite(x) ? ` · ${inCur(x, ['CAD', 'USD', 'INR'].filter(c => c !== acctCur)[i])}` : '')).join('');
  const greenRate = (() => { const t = numOr(day.green, null); return t != null ? t / 100 : b?.greenDayRate ?? null; })();
  const pfDay = numOr(day.pf, null) ?? b?.dayProfitFactor ?? null;
  const dt = greenRate != null && pfDay != null ? dayTargets(goal, days, greenRate, pfDay) : null;
  const lotPv = numOr(as.lotPv, null);
  const sizeName = base.sizeStep > 1 ? `lot (${base.sizeStep} qty)` : 'contract';

  const rows = useMemo(() => [...STYLES, { key: 'custom', name: 'My own plan', blurb: 'Your own target, stop, trades per day and size.', stopMult: 1, rr: 2, tradesPerDay: 1 }].map(s => {
    const lv = styleLevels(s, base, fallbackStop);
    const e = edits[s.key] ?? { targetPts: String(lv.targetPts), stopPts: String(lv.stopPts), tradesPerDay: String(s.tradesPerDay), lots: '' };
    const T = numOr(e.targetPts, 0)!, S = numOr(e.stopPts, 0)!;
    const typed = numOr(as.winRate, null);
    const w = typed != null ? Math.min(0.99, Math.max(0.01, typed / 100)) : estimateWinRate(base, T, S);
    const r = plan({ goal, days, targetPts: T, stopPts: S, tradesPerDay: numOr(e.tradesPerDay, 0)!, lots: numOr(e.lots, null),
      winRate: w, lotPv: lotPv ?? 0, costPerLot: numOr(as.costPerLot, 0)!, dailyLossLimit: numOr(as.dailyLossLimit, null),
      maxDrawdown: numOr(as.maxDrawdown, null), maxLots: numOr(as.maxLots, null) });
    return { s, e, w, r };
  }), [b, edits, as, goal, days, lotPv, fallbackStop]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEdit = (key: string, cur: PlanEdit, k: keyof PlanEdit, v: string) => setEdits({ ...edits, [key]: { ...cur, [k]: v } });

  const save = async () => {
    const row = rows.find(x => x.s.key === chosen);
    if (!account_id || !(goal > 0) || days < 1) { setErr('Enter a goal amount and a date in the future.'); return; }
    setSaving(true); setErr('');
    const withdraw = { amount: entered, currency: cur, keepPct, accountCurrency: acctCur };
    const p = row ? { style: row.s.key, name: row.s.name, targetPts: +row.e.targetPts, stopPts: +row.e.stopPts, tradesPerDay: +row.e.tradesPerDay,
      lots: row.r.lots, sizeName, winRate: row.w, pReach: row.r.pReach, riskPerTrade: row.r.riskPerTrade, withdraw } : { withdraw };
    try {
      await axios.post('/api/goals', { account_id, title: title || null, amount: Math.round(goal * 100) / 100, start_date: today(), end_date: end, plan: p }, auth);
      setAmount(''); setTitle(''); setChosen(''); setReload(x => x + 1);
    } catch (e: any) { setErr(e?.response?.data?.error || 'Could not save the goal.'); }
    setSaving(false);
  };
  const del = async (g: SavedGoal) => {
    if (!window.confirm(`Delete the goal "${g.title || money(g.amount, 0)}"?`)) return;
    await axios.delete(`/api/goals/${g.id}`, auth).catch(() => alert('Could not delete the goal.'));
    setReload(x => x + 1);
  };

  if (!account_id) return <EmptyState icon={Flag} title="Pick an account">Goals use the trades of the account selected on the left.</EmptyState>;
  const cs = currencySymbol();

  return (
    <div className="gl">
      {goals.length > 0 && (
        <section className="gl-card">
          <h3>Your goals</h3>
          {goals.map(g => {
            const left = tradingDays(today() > g.start_date ? today() : g.start_date, g.end_date);
            const pr = progress(g.amount, g.pnl, left, tradingDays(g.start_date, g.end_date));
            return (
              <div className="gl-goal" key={g.id}>
                <div className="gl-between">
                  <strong>{g.title || (g.plan?.withdraw ? `Withdraw ${inCur(g.plan.withdraw.amount, g.plan.withdraw.currency)}` : `Make ${money(g.amount, 0)}`)}</strong>
                  <span className={`gl-pill ${pr.status}`}>{{ done: 'Reached', missed: 'Missed', ahead: 'On pace', behind: 'Behind pace' }[pr.status]}</span>
                </div>
                <div className="gl-bar"><div style={{ width: `${Math.max(0, Math.min(100, pr.pct * 100))}%` }} /></div>
                <div className="gl-dim">
                  {money(g.pnl, 0)} of {money(g.amount, 0)} ({Math.round(pr.pct * 100)}%) · {g.trades} trades · {g.start_date} → {g.end_date} · {left} trading days left
                  {pr.needPerDay != null && pr.status !== 'done' && <> · need {money(pr.needPerDay, 0)}/day</>}
                </div>
                {g.plan?.withdraw && g.plan.withdraw.currency !== acctCur && <div className="gl-dim">Withdrawal {inCur(g.plan.withdraw.amount, g.plan.withdraw.currency)}{g.plan.withdraw.keepPct < 100 ? ` (you keep ${g.plan.withdraw.keepPct}%)` : ''} = {money(g.amount, 0)} profit in this account at the rate on the day you set it.</div>}
                {g.plan?.name && <div className="gl-dim">Plan: {g.plan.name} — {g.plan.lots} {g.plan.sizeName}{g.plan.lots === 1 ? '' : 's'}, target {pts(g.plan.targetPts)}, stop {pts(g.plan.stopPts)}, {g.plan.tradesPerDay} trade{g.plan.tradesPerDay === 1 ? '' : 's'}/day</div>}
                <button className="gl-icon" onClick={() => del(g)} aria-label="Delete goal" title="Delete"><Trash2 size={14} /></button>
              </div>
            );
          })}
        </section>
      )}

      <section className="gl-card">
        <h3>New goal</h3>
        <div className="gl-form">
          <label>Amount to withdraw<span className="gl-amt">
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 2000" />
            <select value={cur} onChange={e => setCur(e.target.value)} aria-label="Currency">
              {['CAD', 'USD', 'INR'].map(c => <option key={c} value={c}>{c}</option>)}
            </select></span></label>
          {isProp && <label>You keep (% of profit, prop split)<input inputMode="decimal" value={keep} onChange={e => setKeep(e.target.value)} title="Prop firms usually pay out 80–90% of the profit." /></label>}
          <label>By<input type="date" value={end} min={plusDays(1)} onChange={e => setEnd(e.target.value)} /></label>
          <label>Name (optional)<input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} placeholder="e.g. December payout" /></label>
        </div>
        <div className="gl-row">
          {QUICK.map(([l, n]) => <button key={l} className={`gl-chip${end === plusDays(n) ? ' on' : ''}`} onClick={() => setEnd(plusDays(n))}>{l}</button>)}
          {acct?.profitTarget ? <button className="gl-chip" onClick={() => setAmount(String(acct.profitTarget))}>Use prop target ({money(acct.profitTarget, 0)})</button> : null}
          <span className="gl-dim">{days} trading days{goal > 0 && days > 0 ? ` · ${money(goal / days, 0)} a day` : ''}</span>
        </div>
        {entered > 0 && (cur !== acctCur || keepPct < 100) && (
          <p className="gl-dim gl-conv">
            {inCur(entered, cur)} to withdraw{keepPct < 100 ? ` at a ${keepPct}% split` : ''} = <b>{goal > 0 ? money(goal, 0) : '—'}</b> profit needed in this {acctCur} account{goal > 0 ? others(goal) : ''}
            {cur !== acctCur && fx ? <> · 1 {cur} = {curSymbol(acctCur)}{(convert(1, cur, acctCur, fx.cad)).toFixed(acctCur === 'INR' ? 2 : 4)}{fx.live ? ' (today)' : ' (approximate: live rate unavailable)'}</> : null}
          </p>
        )}
      </section>

      <section className="gl-card">
        <h3>Your numbers <span className="gl-dim">last 120 days on this account{symbol ? ` · mostly ${symbol}` : ''}</span></h3>
        {err && <p className="gl-err">{err}</p>}
        {!b ? <p className="gl-dim">Loading…</p> : (
          <>
            <div className="gl-stats">
              <Stat k="Trades" v={String(base.trades)} />
              <Stat k="Win rate" v={pctTxt(base.winRate)} />
              <Stat k="Avg win" v={pts(base.avgWinPts)} />
              <Stat k="Avg loss" v={pts(base.avgLossPts)} />
              <Stat k="Trades a day" v={base.tradesPerDay == null ? '—' : base.tradesPerDay.toFixed(1)} />
              <Stat k="Green days" v={pctTxt(base.greenDayRate)} />
              <Stat k="Profit factor (trades)" v={base.profitFactor == null ? '—' : base.profitFactor.toFixed(2)} />
              <Stat k="Usual size" v={base.typicalLots == null ? '—' : `${base.typicalLots} ${sizeName}${base.typicalLots === 1 ? '' : 's'}`} />
            </div>
            {base.trades < 10 && <p className="gl-warn">Fewer than 10 closed trades here, so your win rate can't be measured yet. Type a win rate below to try plans.</p>}
            <details className="gl-assume">
              <summary>Assumptions (change any)</summary>
              <div className="gl-form">
                <label>Win rate % (blank = estimate from your trades)<input inputMode="decimal" value={as.winRate} onChange={e => setAs({ ...as, winRate: e.target.value })} placeholder="auto" /></label>
                <label>{cs} per point per {sizeName}<input inputMode="decimal" value={as.lotPv} onChange={e => setAs({ ...as, lotPv: e.target.value })} placeholder="NQ 20, MNQ 2, ES 50" /></label>
                <label>Costs per {sizeName} per trade ({cs})<input inputMode="decimal" value={as.costPerLot} onChange={e => setAs({ ...as, costPerLot: e.target.value })} /></label>
                <label>Daily loss limit ({cs}, blank = none)<input inputMode="decimal" value={as.dailyLossLimit} onChange={e => setAs({ ...as, dailyLossLimit: e.target.value })} /></label>
                <label>Max drawdown ({cs}, blank = none)<input inputMode="decimal" value={as.maxDrawdown} onChange={e => setAs({ ...as, maxDrawdown: e.target.value })} /></label>
                <label>Most {sizeName}s you'd trade<input inputMode="numeric" value={as.maxLots} onChange={e => setAs({ ...as, maxLots: e.target.value })} placeholder="no limit" /></label>
              </div>
              <p className="gl-dim">Win rate for each plan = the coin-flip chance for its target and stop plus your edge over a coin flip at your own average win and loss. Bigger targets win less often.</p>
            </details>
          </>
        )}
      </section>

      {b && (
        <section className="gl-card">
          <h3>What your days need to look like <span className="gl-dim">from your green-day rate and profit factor</span></h3>
          <div className="gl-form">
            <label>Green days (% of days)<input inputMode="decimal" value={day.green} placeholder={b.greenDayRate != null ? String(Math.round(b.greenDayRate * 100)) : 'e.g. 55'} onChange={e => setDay({ ...day, green: e.target.value })} /></label>
            <label>Profit factor by day (money won ÷ money lost)<input inputMode="decimal" value={day.pf} placeholder={b.dayProfitFactor != null ? b.dayProfitFactor.toFixed(2) : 'e.g. 1.5'} onChange={e => setDay({ ...day, pf: e.target.value })} /></label>
          </div>
          {!(goal > 0) || days < 1 ? <p className="gl-dim">Enter an amount and a date above.</p>
            : greenRate == null || pfDay == null ? <p className="gl-warn">Not enough trading days on this account to measure these. Type a green-day % and a profit factor.</p>
            : !dt ? <p className="gl-warn">Green days must be between 1% and 99%, and the profit factor more than 0.</p>
            : !dt.ok ? <p className="gl-warn">{dt.why}</p>
            : (
              <>
                <div className="gl-daygrid">
                  <div className="gl-day green">
                    <span>On each green day make at least</span>
                    <strong>{money(dt.perGreenDay, 0)}</strong>
                    <em>about {Math.round(dt.greenDays)} of {days} days{others(dt.perGreenDay)}</em>
                    {b.avgGreenDay != null && <em>your average green day now: {money(b.avgGreenDay, 0)}</em>}
                  </div>
                  <div className="gl-day red">
                    <span>On each red day lose at most</span>
                    <strong>{money(dt.perRedDay, 0)}</strong>
                    <em>about {Math.round(dt.redDays)} of {days} days{others(dt.perRedDay)}</em>
                    {b.avgRedDay != null && <em>your average red day now: -{money(b.avgRedDay, 0)}</em>}
                  </div>
                </div>
                <p className="gl-dim">Total won on green days {money(dt.won, 0)} − total lost on red days {money(dt.lost, 0)} = {money(goal, 0)}. A day profit factor of {pfDay.toFixed(2)} means you make {pfDay.toFixed(2)}× what you lose. Blank boxes use your last 120 days ({Math.round((b.greenDayRate ?? 0) * 100)}% green days{b.dayProfitFactor != null ? `, day profit factor ${b.dayProfitFactor.toFixed(2)}` : ''}).</p>
              </>
            )}
        </section>
      )}

      {b && (
        <section className="gl-card">
          <h3>Ways to get there <span className="gl-dim">pick one, adjust it, save the goal</span></h3>
          {!(goal > 0) || days < 1 ? <p className="gl-dim">Enter an amount and a date above to see the plans.</p> : !lotPv ? <p className="gl-warn">Enter the {cs} per point under Assumptions.</p> : (
            <div className="gl-plans">
              {rows.map(({ s, e, w, r }) => (
                <div key={s.key} className={`gl-plan${chosen === s.key ? ' on' : ''}`} onClick={() => setChosen(s.key)} role="button" tabIndex={0}
                  onKeyDown={ev => { if (ev.key === 'Enter') setChosen(s.key); }} aria-pressed={chosen === s.key}>
                  <div className="gl-between"><strong>{s.name}</strong><span className={`gl-pill ${r.verdict}`}>{VERDICT[r.verdict]}</span></div>
                  <div className="gl-dim">{s.blurb}</div>
                  <div className="gl-inputs" onClick={ev => ev.stopPropagation()}>
                    <label>Target pts<input inputMode="decimal" value={e.targetPts} onChange={x => setEdit(s.key, e, 'targetPts', x.target.value)} /></label>
                    <label>Stop pts<input inputMode="decimal" value={e.stopPts} onChange={x => setEdit(s.key, e, 'stopPts', x.target.value)} /></label>
                    <label>Trades/day<input inputMode="numeric" value={e.tradesPerDay} onChange={x => setEdit(s.key, e, 'tradesPerDay', x.target.value)} /></label>
                    <label>{base.sizeStep > 1 ? 'Lots' : 'Contracts'}<input inputMode="numeric" value={e.lots} placeholder={r.lots ? String(r.lots) : 'auto'} onChange={x => setEdit(s.key, e, 'lots', x.target.value)} /></label>
                  </div>
                  <dl className="gl-out">
                    <div><dt>Size</dt><dd>{r.lots ?? '—'} {sizeName}{r.lots === 1 ? '' : 's'}{r.capped ? ' (capped by limits)' : ''}</dd></div>
                    <div><dt>Risk per trade</dt><dd>{r.riskPerTrade == null ? '—' : money(r.riskPerTrade, 0)}</dd></div>
                    <div><dt>Worst day</dt><dd>{r.worstDay == null ? '—' : `-${money(r.worstDay, 0)}`}</dd></div>
                    <div><dt>Win rate needed</dt><dd>{r.winRateNeeded == null ? '—' : r.winRateNeeded > 1 ? '>100%' : pctTxt(r.winRateNeeded)}</dd></div>
                    <div><dt>Your win rate (est.)</dt><dd>{pctTxt(w)}</dd></div>
                    <div><dt>Reached goal</dt><dd>{pctTxt(r.pReach)}</dd></div>
                    <div><dt>Hit drawdown limit</dt><dd>{as.maxDrawdown ? pctTxt(r.pLimit) : 'no limit set'}</dd></div>
                  </dl>
                  <div className="gl-why">{r.why}</div>
                </div>
              ))}
            </div>
          )}
          <div className="gl-row gl-save">
            <button className="gl-btn primary" disabled={saving || !(goal > 0) || days < 1} onClick={save}>{chosen ? `Save goal with “${rows.find(x => x.s.key === chosen)?.s.name}”` : 'Save goal (no plan picked)'}</button>
            <span className="gl-dim">“Reached goal” = share of 2,000 simulated attempts using your win rate, stopping for the day at the daily loss limit. Estimates from past trades, not a promise. You decide and you trade.</span>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="gl-stat"><span>{k}</span><strong>{v}</strong></div>;
}
