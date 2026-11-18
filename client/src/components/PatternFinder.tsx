// Time & day pattern finder: tests one fixed trade (1 contract, target $ / stop $) entered at every
// time of day and weekday over the chart's NQ history, split into TRAIN (older 60%) and TEST (newest
// 40%). Also shows what the market usually does then (move, direction, volume, time of high / low).
import { useMemo, useState } from 'react';
import axios from 'axios';
import { Play, Search, AlertTriangle } from 'lucide-react';
import { openReplayDay } from '../utils/chartLink';
import '../styles/BacktestLab.css';
import '../styles/S1Practice.css';
import '../styles/PatternFinder.css';

interface Stats { n: number; wins: number; losses: number; timeouts: number; netUsd: number; avgUsd: number; winRate: number; pf: number | null; }
interface Cell { slot: string; wd: number; train: Stats; test: Stats; all: Stats; move30: number; up30: number; relVol: number; }
interface DayStat { wd: number; days: number; avgRange: number; upPct: number; highHour: number[]; lowHour: number[]; }
interface Result {
  params: { contract: string; targetUsd: number; stopUsd: number; targetPts: number; stopPts: number; costUsd: number; breakEvenWinRate: number; dir: string; slotMin: number; maxHoldMin: number };
  days: number; trainDays: number; testDays: number; splitDate: string; from: string; to: string;
  slots: string[]; cells: Cell[]; candidates: number; expectedFalse: number; dayStats: DayStat[];
}
interface DayRow { date: string; side: string; outcome: string; netUsd: number; test: boolean; }

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const COLS = [-1, 0, 1, 2, 3, 4];
const HOURS = ['9:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30'];
const RULES: [string, string][] = [
  ['long', 'Always long'], ['short', 'Always short'],
  ['trend30', 'With the last 30 min'], ['fade30', 'Against the last 30 min'],
  ['trendOpen', 'With the move since 9:30'], ['fadeOpen', 'Against the move since 9:30'],
  ['vwap', 'With VWAP'], ['antiVwap', 'Against VWAP'],
];
const usd = (x: number) => `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(Math.abs(x) < 10 ? 2 : 0)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const passes = (c: Cell) => c.train.n >= 40 && c.test.n >= 40 && c.train.avgUsd > 0 && c.test.avgUsd > 0;

function heat(avg: number, scale: number) {
  const a = Math.min(1, Math.abs(avg) / Math.max(1, scale));
  return avg >= 0 ? `rgba(8, 153, 129, ${0.12 + 0.6 * a})` : `rgba(242, 54, 69, ${0.12 + 0.6 * a})`;
}

export default function PatternFinder({ token }: { token: string }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [form, setForm] = useState({ contract: 'NQ', targetUsd: 150, stopUsd: 100, slotMin: 15, maxHoldMin: 60, dir: 'trend30', from: '', to: '' });
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'test' | 'train' | 'all' | 'move' | 'vol'>('test');
  const [sel, setSel] = useState<Cell | null>(null);
  const [days, setDays] = useState<DayRow[] | null>(null);

  const params = () => ({ ...form, from: form.from || undefined, to: form.to || undefined });
  const run = async () => {
    setBusy(true); setErr(''); setSel(null); setDays(null);
    try { setRes((await axios.get('/api/patterns/time', { ...auth, params: params() })).data.result); }
    catch (e: any) { setErr(e?.response?.data?.error || 'The scan failed.'); }
    finally { setBusy(false); }
  };
  const pick = async (c: Cell) => {
    setSel(c); setDays(null);
    try { setDays((await axios.get('/api/patterns/time/days', { ...auth, params: { ...params(), slot: c.slot, wd: c.wd } })).data.days); }
    catch { setDays([]); }
  };

  const grid = useMemo(() => {
    if (!res) return null;
    const m = new Map<string, Cell>();
    for (const c of res.cells) m.set(`${c.slot}|${c.wd}`, c);
    const scale = Math.max(5, ...res.cells.map(c => Math.abs(view === 'train' ? c.train.avgUsd : view === 'all' ? c.all.avgUsd : c.test.avgUsd)));
    return { m, scale };
  }, [res, view]);

  const allCells = res ? res.cells.filter(c => c.wd === -1) : [];
  const total = allCells.reduce((s, c) => ({ n: s.n + c.all.n, net: s.net + c.all.netUsd, w: s.w + c.all.wins }), { n: 0, net: 0, w: 0 });
  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="bl pf">
      <div className="bl-card">
        <h3>Your trade</h3>
        <div className="bl-rules">
          <label className="bl-field">Contract
            <select value={form.contract} onChange={e => set('contract', e.target.value)}><option>NQ</option><option>MNQ</option></select></label>
          <label className="bl-field">Target $ (1 contract)<input type="number" min={5} value={form.targetUsd} onChange={e => set('targetUsd', Number(e.target.value))} /></label>
          <label className="bl-field">Stop $<input type="number" min={5} value={form.stopUsd} onChange={e => set('stopUsd', Number(e.target.value))} /></label>
          <label className="bl-field">Direction
            <select value={form.dir} onChange={e => set('dir', e.target.value)}>{RULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="bl-field">Entry every
            <select value={form.slotMin} onChange={e => set('slotMin', Number(e.target.value))}>{[5, 10, 15, 30, 60].map(v => <option key={v} value={v}>{v} min</option>)}</select></label>
          <label className="bl-field">Max hold (min)<input type="number" min={5} max={390} value={form.maxHoldMin} onChange={e => set('maxHoldMin', Number(e.target.value))} /></label>
          <label className="bl-field">From<input type="date" value={form.from} onChange={e => set('from', e.target.value)} /></label>
          <label className="bl-field">To<input type="date" value={form.to} onChange={e => set('to', e.target.value)} /></label>
        </div>
        <button className="pf-run" disabled={busy} onClick={run}><Search size={14} /> {busy ? 'Scanning… (first run loads 5 years, ~20 s)' : 'Find patterns'}</button>
        {err && <p className="bl-bad">{err}</p>}
        <p className="bl-dim">
          {form.contract === 'NQ' ? `NQ: $${form.targetUsd} = ${(form.targetUsd / 20).toFixed(2)} pt target, $${form.stopUsd} = ${(form.stopUsd / 20).toFixed(2)} pt stop.` : `MNQ: $${form.targetUsd} = ${(form.targetUsd / 2).toFixed(1)} pt target, $${form.stopUsd} = ${(form.stopUsd / 2).toFixed(1)} pt stop.`}
          {' '}Entry at the open of the minute, decided only from finished candles. A candle that touches both stop and target counts as a loss. Costs: $3.50 / $1.00 + 0.5 pt slippage per trade.
        </p>
      </div>

      {res && (
        <>
          <div className="bl-card">
            <h3>Verdict</h3>
            <div className="bl-tiles">
              <div className="bl-tile"><div className="bl-tile-label">All entries</div><div className="bl-tile-v">{total.n.toLocaleString()}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Win rate / needed</div><div className="bl-tile-v">{pct(total.w / Math.max(1, total.n))} / {pct(res.params.breakEvenWinRate)}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Avg per trade (after costs)</div><div className={`bl-tile-v ${total.net >= 0 ? 'bl-up' : 'bl-down'}`}>{usd(total.net / Math.max(1, total.n))}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Cells good in train + test</div><div className="bl-tile-v">{res.candidates} <span className="pf-luck">luck alone ≈ {res.expectedFalse}</span></div></div>
            </div>
            <p className={`pf-verdict ${res.candidates > res.expectedFalse * 1.5 ? 'ok' : 'no'}`}>
              {res.candidates > res.expectedFalse * 1.5
                ? `More good cells than luck would give (${res.candidates} vs ≈${res.expectedFalse}). Worth a pre-registered test on new data before trusting any of them.`
                : res.candidates < res.expectedFalse * 0.5
                  ? `Worse than random: only ${res.candidates} cells are positive in both halves (luck alone would give ≈${res.expectedFalse}). This trade loses at almost every time of day: the target / stop does not fit how NQ moves.`
                  : `No real time-of-day edge: ${res.candidates} cells look good in both halves, about what luck alone gives (≈${res.expectedFalse}). A green cell here is most likely noise.`}
            </p>
            <p className="bl-dim">{res.days} New York sessions, {res.from} → {res.to}. TRAIN = before {res.splitDate} ({res.trainDays} days), TEST = after ({res.testDays} days). Pick on TRAIN, believe only what also holds on TEST.</p>
          </div>

          <div className="bl-card">
            <div className="bl-head">
              <h3>Time × weekday</h3>
              <div className="pf-seg">
                {([['test', 'TEST avg $'], ['train', 'TRAIN avg $'], ['all', 'All avg $'], ['move', 'Move next 30 min'], ['vol', 'Volume']] as const).map(([k, l]) =>
                  <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
              </div>
            </div>
            <div className="pf-scroll">
              <table className="pf-grid">
                <thead><tr><th>ET</th>{COLS.map(w => <th key={w}>{w < 0 ? 'All' : WD[w]}</th>)}</tr></thead>
                <tbody>
                  {res.slots.map(slot => (
                    <tr key={slot}>
                      <td className="pf-slot">{slot}</td>
                      {COLS.map(w => {
                        const c = grid!.m.get(`${slot}|${w}`);
                        if (!c) return <td key={w} />;
                        const v = view === 'test' ? c.test : view === 'train' ? c.train : c.all;
                        const txt = view === 'move' ? `${Math.round(c.move30)} pt · ${pct(c.up30)}↑` : view === 'vol' ? `${c.relVol.toFixed(1)}×` : v.n ? usd(v.avgUsd) : '—';
                        const bg = view === 'move' || view === 'vol' || !v.n ? undefined : heat(v.avgUsd, grid!.scale);
                        return (
                          <td key={w} className={`pf-cell${sel === c ? ' sel' : ''}${passes(c) ? ' pass' : ''}`} style={{ background: bg }} onClick={() => pick(c)}
                            title={`${w < 0 ? 'All days' : WD[w]} ${slot} ET · train ${usd(c.train.avgUsd)} (n ${c.train.n}) · test ${usd(c.test.avgUsd)} (n ${c.test.n})`}>{txt}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="bl-dim">Outlined cells are positive in both TRAIN and TEST with 40+ trades each. Click a cell for its days.</p>
          </div>

          {sel && (
            <div className="bl-card">
              <h3>{sel.wd < 0 ? 'Every weekday' : WD[sel.wd]} at {sel.slot} ET</h3>
              <table className="bl-table">
                <thead><tr><th></th><th>Trades</th><th>Win</th><th>Stop</th><th>Time out</th><th>Avg</th><th>PF</th><th>Total</th></tr></thead>
                <tbody>
                  {([['TRAIN', sel.train], ['TEST', sel.test], ['All', sel.all]] as const).map(([l, s]) => (
                    <tr key={l}><td>{l}</td><td>{s.n}</td><td>{pct(s.winRate)}</td><td>{s.losses}</td><td>{s.timeouts}</td>
                      <td className={s.avgUsd >= 0 ? 'bl-up' : 'bl-down'}>{usd(s.avgUsd)}</td><td>{s.pf ?? '—'}</td><td>{usd(s.netUsd)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="bl-dim">Usual move in the next 30 minutes: {sel.move30} pt, up {pct(sel.up30)} of the time. Volume at entry: {sel.relVol}× the day's average minute.</p>
              {days === null ? <p className="bl-dim">Loading days…</p> : (
                <div className="pf-days">
                  {days.slice(0, 120).map(d => (
                    <div key={d.date} className="pf-day">
                      <span>{d.date}</span><span className={d.side === 'long' ? 'bl-up' : 'bl-down'}>{d.side}</span>
                      <span className="bl-dim">{d.outcome}{d.test ? ' · test' : ''}</span>
                      <span className={d.netUsd >= 0 ? 'bl-up' : 'bl-down'}>{usd(d.netUsd)}</span>
                      <button className="s1p-btn" onClick={() => openReplayDay(d.date)} title="Replay this day from 9:25 ET"><Play size={12} /> Replay</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bl-card">
            <h3>How each weekday behaves</h3>
            <div className="pf-scroll">
              <table className="bl-table">
                <thead><tr><th>Day</th><th>Sessions</th><th>Avg range</th><th>Closes up</th>{HOURS.map(h => <th key={h}>High @{h}</th>)}{HOURS.map(h => <th key={'l' + h}>Low @{h}</th>)}</tr></thead>
                <tbody>
                  {[...res.dayStats].sort((a, b) => (a.wd < 0 ? 9 : a.wd) - (b.wd < 0 ? 9 : b.wd)).map(d => (
                    <tr key={d.wd}><td>{d.wd < 0 ? 'All' : WD[d.wd]}</td><td>{d.days}</td><td>{Math.round(d.avgRange)} pt</td><td>{pct(d.upPct)}</td>
                      {d.highHour.map((x, i) => <td key={i} style={{ background: `rgba(8,153,129,${x})` }}>{pct(x)}</td>)}
                      {d.lowHour.map((x, i) => <td key={'l' + i} style={{ background: `rgba(242,54,69,${x})` }}>{pct(x)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="bl-dim">"High @10:30" = share of days whose New York high printed in the hour starting 10:30 ET. These are descriptions, not trade signals.</p>
          </div>
        </>
      )}
      {!res && !busy && (
        <div className="bl-card pf-note"><AlertTriangle size={16} /> Time and weekday alone rarely make an edge. Use this to see when NQ moves, then test a real setup at those times.</div>
      )}
    </div>
  );
}
