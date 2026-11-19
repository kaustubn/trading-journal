// Edge Hunter view: the automatic pattern + stop/target search (src/patterns/edgeHunter.ts).
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Play, Radar, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { openReplayDay } from '../utils/chartLink';

interface S { n: number; avgR: number; win: number; }
interface Cand {
  key: number; pattern: string; mode: string; rule: string; stopAtr: number; targetR: number; avgStopPts: number;
  disc: S; val: S; hold: S; perDay: number; maxLosingStreak: number; maxDdR: number; trades: [string, number, number, number][];
  tStat?: number; passesT?: boolean; years?: { y: string; n: number; avgR: number }[];
}
interface Res {
  runAt: string; secs: number; days: number; from: string; to: string; splits: [string, string];
  tested: number; events: number; survivors: number; luck: number; verdict: string; candidates: Cand[];
  scoreboard?: { pattern: string; desc: string; mode: string; stopAtr: number; targetR: number; disc: S; val: S; hold: S; tStat: number }[];
}

const r2 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hm = (m: number) => { const t = 570 + m; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export default function EdgeHunter({ token }: { token: string }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [res, setRes] = useState<Res | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [rec, setRec] = useState<Record<number, string>>({});
  const recordTrades = async (key: number) => {
    setRec(r => ({ ...r, [key]: 'Recording every trade…' }));
    try {
      const x = await axios.post('/api/patterns/book/record-candidate', { key }, { headers: { Authorization: `Bearer ${token}` } });
      setRec(r => ({ ...r, [key]: `Recorded ${x.data.trades} trades (${x.data.status === 'prop-ready' ? 'PROP-READY' : 'watch: does not pass the prop gate'}).` }));
      window.dispatchEvent(new CustomEvent('jc:open-tradebook', { detail: { id: x.data.id } }));
    } catch (e: any) { setRec(r => ({ ...r, [key]: e.response?.data?.error || 'Recording failed' })); }
  };
  const timer = useRef<number | null>(null);

  const poll = async () => {
    try {
      const r = await axios.get('/api/patterns/edge', auth);
      setRes(r.data.result); setRunning(r.data.status.running); setProgress(r.data.status.progress);
      if (r.data.status.running) timer.current = window.setTimeout(poll, 2500);
    } catch (e: any) { setErr(e?.response?.data?.error || 'Could not load the search.'); setRunning(false); }
  };
  useEffect(() => { poll(); return () => { if (timer.current) clearTimeout(timer.current); }; }, []);
  const run = async () => {
    setErr(''); setRunning(true);
    try { await axios.post('/api/patterns/edge/run', {}, auth); timer.current = window.setTimeout(poll, 1500); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Could not start.'); setRunning(false); }
  };

  const real = res ? res.survivors > res.luck * 1.5 : false;
  const holdPos = res ? res.candidates.filter(c => c.hold.n >= 20 && c.hold.avgR > 0).length : 0;

  return (
    <>
      <div className="bl-card">
        <h3>Edge Hunter: finds patterns and their stop / target by itself</h3>
        <p className="bl-dim">
          Searches 18 patterns on 5-minute NQ candles — price action (opening-range break, EMA pullback, VWAP cross, engulfing, inside-bar break,
          3 same-colour candles, big candle, opening gap, first-hour break), levels (prior-day, overnight and prior-week high/low sweeps and breaks,
          prior value-area re-entry) and published intraday studies (5-min ORB, noise-area breakout, intraday momentum, overnight → last half-hour) —
          each followed or faded, by time of day, weekday or calendar event (FOMC, OPEX, turn of month, jobs-report Friday), 15m trend and volatility,
          with stops of 0.5–2 × ATR and targets of 1–3R. Rules are picked on the oldest 50% of days, must hold on the
          next 25%, and are then shown on the newest 25% they never saw. The same search with coin-flip directions shows how many winners luck alone makes.
        </p>
        <button className="pf-run" disabled={running} onClick={run}><Radar size={14} /> {running ? (progress || 'Searching…') : res ? 'Run the search again' : 'Run the search'}</button>
        {err && <p className="bl-bad">{err}</p>}
      </div>

      {res && (
        <>
          <div className="bl-card">
            <h3>Verdict</h3>
            <div className="bl-tiles">
              <div className="bl-tile"><div className="bl-tile-label">Rules tested</div><div className="bl-tile-v">{res.tested.toLocaleString()}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Passed 2 checks</div><div className="bl-tile-v">{res.survivors.toLocaleString()}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Luck alone gives</div><div className="bl-tile-v">{res.luck.toLocaleString()}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Top {res.candidates.length} positive on unseen days</div><div className="bl-tile-v">{holdPos} <span className="pf-luck">coin ≈ {Math.round(res.candidates.length / 2)}</span></div></div>
            </div>
            <p className={`pf-verdict ${real ? 'ok' : 'no'}`}>{res.verdict}</p>
            <p className="bl-dim">{res.days} sessions {res.from} → {res.to}. Discovery before {res.splits[0]}, validation to {res.splits[1]}, unseen (holdout) after. {res.events.toLocaleString()} pattern events. Ran {new Date(res.runAt).toLocaleString()} in {res.secs} s. Results in R after NQ costs; 1R = the stop.</p>
          </div>

          {res.scoreboard && (
            <div className="bl-card">
              <h3>Scoreboard: every pattern on its own</h3>
              <p className="bl-dim">No time / day / trend filters, so only {res.scoreboard.length} tests and far less luck than the full search. The exit is the one that was best on DISCOVERY. Green in all three columns = worth a pre-registered forward test.</p>
              <div className="pf-scroll">
                <table className="bl-table">
                  <thead><tr><th>Pattern</th><th>Way</th><th>Exit</th><th>Discovery</th><th>Validation</th><th>Unseen</th><th>t</th></tr></thead>
                  <tbody>
                    {[...res.scoreboard].sort((a, b) => Math.min(b.disc.avgR, b.val.avgR, b.hold.avgR) - Math.min(a.disc.avgR, a.val.avgR, a.hold.avgR)).map(b => {
                      const all3 = b.disc.avgR > 0 && b.val.avgR > 0 && b.hold.avgR > 0;
                      return (
                        <tr key={b.pattern + b.mode} className={all3 ? 'eh-all3' : ''} title={b.desc}>
                          <td>{b.pattern}</td><td>{b.mode}</td><td>{b.stopAtr}×ATR / {b.targetR}R</td>
                          {[b.disc, b.val, b.hold].map((x, i) => <td key={i} className={x.avgR > 0 ? 'bl-up' : 'bl-down'}>{r2(x.avgR)} <span className="bl-dim">n{x.n}</span></td>)}
                          <td className={b.tStat >= 3 ? 'bl-up' : ''}>{b.tStat}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bl-card">
            <h3>Best-looking rules {real ? '' : '(most likely luck — study, don’t trade)'}</h3>
            <div className="eh-list">
              {res.candidates.map((c, i) => {
                const isOpen = open === i;
                const holdOk = c.hold.n >= 20 && c.hold.avgR > 0;
                return (
                  <div key={c.key} className={`eh-cand ${holdOk ? 'ok' : 'no'}`}>
                    <button className="eh-head" onClick={() => setOpen(isOpen ? null : i)}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="eh-rule">{c.rule}</span>
                    </button>
                    <div className="eh-stats">
                      <span>Discovery <b className={c.disc.avgR > 0 ? 'bl-up' : 'bl-down'}>{r2(c.disc.avgR)}</b> n{c.disc.n} · {pct(c.disc.win)}</span>
                      <span>Validation <b className={c.val.avgR > 0 ? 'bl-up' : 'bl-down'}>{r2(c.val.avgR)}</b> n{c.val.n}</span>
                      <span>Unseen <b className={c.hold.avgR > 0 ? 'bl-up' : 'bl-down'}>{r2(c.hold.avgR)}</b> n{c.hold.n} · {pct(c.hold.win)}</span>
                      <span className="bl-dim">{c.perDay}/day · worst streak {c.maxLosingStreak} · max DD {c.maxDdR}R</span>
                      {c.tStat != null && <span className={c.passesT ? 'bl-up' : 'bl-dim'}>t {c.tStat}{c.passesT ? ' ≥ 3' : ' (< 3)'}</span>}
                      {c.years && <span className="eh-years">{c.years.map(y => <i key={y.y} className={y.avgR > 0 ? 'up' : 'dn'} title={`${y.y}: ${r2(y.avgR)} on ${y.n} trades`}>{y.y.slice(2)}</i>)}</span>}
                    </div>
                    <div className="eh-rec">
                      <button className="s1p-btn" disabled={rec[c.key] === 'Recording every trade…'} onClick={() => recordTrades(c.key)} title="Replay every trade of this rule and save it (entry, exit, management, confluence) in the AI Trade Book">
                        <BookOpen size={12} /> Record every trade
                      </button>
                      {rec[c.key] && <span className="bl-dim">{rec[c.key]}</span>}
                    </div>
                    {isOpen && (
                      <div className="pf-days">
                        {[...c.trades].reverse().slice(0, 150).map((t, k) => (
                          <div key={k} className="pf-day">
                            <span>{t[0]}</span><span className={t[2] > 0 ? 'bl-up' : 'bl-down'}>{t[2] > 0 ? 'long' : 'short'}</span>
                            <span className="bl-dim">{hm(t[1])} ET</span>
                            <span className={t[3] > 0 ? 'bl-up' : 'bl-down'}>{r2(t[3])}</span>
                            <button className="s1p-btn" onClick={() => openReplayDay(t[0])} title="Replay this day from 9:25 ET"><Play size={12} /> Replay</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="bl-dim">Green border = also positive on the unseen days. Even then, only a pre-registered forward test (new days, rules frozen) makes it tradable. Footprint (delta / imbalance) joins the search once Databento data is loaded.</p>
          </div>
        </>
      )}
      {!res && !running && <div className="bl-card bl-dim">No search yet. Press Run the search (about 10–60 seconds).</div>}
    </>
  );
}
