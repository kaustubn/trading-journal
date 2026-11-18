// S1 practice: 25 fixed replay days + every bar-replay trade scored against the S1 bot rules.
// The bot rules and the checks live in utils/s1Score.ts (a line-by-line port of nq_lab.rq, tag 1,
// verified against the RoboQuant research log: 2,743 of 2,748 signals reproduced).
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Check, X, HelpCircle, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { wallToUtc } from '../chart/time';
import { openReplayDay } from '../utils/chartLink';
import { Bar1, BotSignal, PracticeTrade, TradeScore, scoreTrade, simulateS1, summary, Summary } from '../utils/s1Score';
import '../styles/BacktestLab.css';
import '../styles/S1Practice.css';

interface PDay { n: number; day: string; kind: string; dir: string; range: number; atr: number; trades: number; }
interface DayResult { day: string; bot: BotSignal[]; scores: TradeScore[]; error?: string; }

const KIND: Record<string, string> = {
  trend: 'Trend day', range: 'Range / chop day', gapup: 'Gap-up open', gapdown: 'Gap-down open', bigrange: 'Big range day', smallrange: 'Quiet day',
};
const GOAL = 25;
const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtR = (r: number | null | undefined) => (r == null || !Number.isFinite(r) ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`);

async function dayBars(day: string, token: string, until = 0): Promise<Bar1[]> {
  const to = Math.max(wallToUtc(day, '16:05', 'ET'), until); // evening trades need their own candles
  const from = wallToUtc(day, '00:00', 'ET') - 3 * 86400000; // EMA warm-up (covers a weekend)
  const r = await axios.get('/api/bars', { headers: { Authorization: `Bearer ${token}` }, params: { symbol: 'NQ', tf: 1, from, to, limit: 5000 } });
  return r.data.bars as Bar1[];
}

function SumRow({ label, s, note }: { label: string; s: Summary | null; note?: string }) {
  return (
    <tr>
      <td>{label}{note && <div className="bl-dim s1p-note">{note}</div>}</td>
      <td>{s ? s.n : 0}</td>
      <td>{s ? `${Math.round(s.win * 100)}%` : '—'}</td>
      <td className={s ? (s.avgR > 0 ? 'bl-up' : 'bl-down') : ''}>{s ? fmtR(s.avgR) : '—'}</td>
      <td>{s?.pf != null ? s.pf.toFixed(2) : '—'}</td>
      <td>{s ? fmtR(s.totR) : '—'}</td>
    </tr>
  );
}

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === true) return <Check className="s1p-ok" size={15} />;
  if (ok === false) return <X className="s1p-no" size={15} />;
  return <HelpCircle className="s1p-na" size={15} />;
}

export default function S1Practice({ token }: { token: string }) {
  const [days, setDays] = useState<PDay[]>([]);
  const [results, setResults] = useState<DayResult[]>([]);
  const [status, setStatus] = useState<'loading' | 'scoring' | 'ok' | 'error'>('loading');
  const [onlyS1, setOnlyS1] = useState(true);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await axios.get('/api/replay/practice', { headers: { Authorization: `Bearer ${token}` } });
        if (dead) return;
        const ds: PDay[] = r.data.days, ts: PracticeTrade[] = r.data.trades;
        setDays(ds); setStatus('scoring');
        // score day by day (the bot needs the whole session's candles)
        const byDay = new Map<string, PracticeTrade[]>();
        for (const t of ts) { const k = etDay.format(new Date(t.entry)); byDay.set(k, [...(byDay.get(k) || []), t]); }
        for (const d of ds) if (d.trades > 0 && !byDay.has(d.day)) byDay.set(d.day, []);
        const out: DayResult[] = [];
        for (const [day, list] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
          try {
            const bars = await dayBars(day, token, Math.max(0, ...list.map(t => (t.exit ?? t.entry) + 60000)));
            const sim = simulateS1(bars);
            const s0 = wallToUtc(day, '09:30', 'ET'), s1 = wallToUtc(day, '16:00', 'ET');
            out.push({ day, bot: sim.signals.filter(x => x.t > s0 && x.t <= s1), scores: list.map(t => scoreTrade(t, sim)) });
          } catch {
            out.push({ day, bot: [], scores: [], error: 'Could not load the candles for this day.' });
          }
          if (dead) return;
          setResults([...out]);
        }
        setStatus('ok');
      } catch {
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, [token]);

  const practiceSet = useMemo(() => new Set(days.map(d => d.day)), [days]);
  const scores = useMemo(() => results.flatMap(d => d.scores).filter(s => !onlyS1 || s.taggedS1), [results, onlyS1]);
  const rs = (list: TradeScore[]) => list.map(s => s.r).filter((r): r is number => r != null);
  const stats = useMemo(() => {
    const followed = scores.filter(s => s.followed), broken = scores.filter(s => !s.followed);
    const tradedDays = new Set(scores.map(s => etDay.format(new Date(s.trade.entry))));
    const bot = results.filter(d => tradedDays.has(d.day)).flatMap(d => d.bot.filter(b => b.morning && b.r != null));
    const ruleMiss: Record<string, { label: string; n: number }> = {};
    for (const s of scores) for (const c of s.checks) if (c.ok === false) ruleMiss[c.key] = { label: c.label, n: (ruleMiss[c.key]?.n || 0) + 1 };
    const worst = Object.values(ruleMiss).sort((a, b) => b.n - a.n)[0] || null;
    return {
      all: summary(rs(scores)), followed: summary(rs(followed)), broken: summary(rs(broken)),
      bot: summary(bot.map(b => b.r as number)), matched: scores.filter(s => s.botMatch).length,
      followPct: scores.length ? followed.length / scores.length : 0, worst, days: tradedDays.size,
    };
  }, [scores, results]);
  const doneDays = days.filter(d => d.trades > 0).length;
  const untagged = results.flatMap(d => d.scores).filter(s => !s.taggedS1).length;

  if (status === 'error') return <div className="bl"><div className="bl-card">Could not load the practice set.</div></div>;

  return (
    <div className="bl s1p">
      <div className="bl-card">
        <h3>How this works</h3>
        <ol className="s1p-steps">
          <li>Pick the next day below and press <b>Replay</b>. The Market Chart opens at 9:25 ET on that day.</li>
          <li>Trade S1 the way you see it. Choose <b>S1</b> as the setup in the order ticket. Set the stop and target before you enter.</li>
          <li>Come back here. Each trade is checked against the S1 bot's rules, and you see what the bot did on the same day.</li>
        </ol>
        <p className="bl-dim">Goal: {GOAL}+ S1 trades. Then we compare your results with the bot's on the same days, and code whatever you saw that it misses. Results are after costs ($3.50 + 0.5 pt per round trip).</p>
        <div className="bl-tiles">
          <div className="bl-tile"><div className="bl-tile-label">Practice days done</div><div className="bl-tile-v">{doneDays} / {days.length || 25}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">{onlyS1 ? 'S1 trades scored' : 'Replay trades scored'}</div><div className="bl-tile-v">{scores.length} / {GOAL}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Followed every rule</div><div className="bl-tile-v">{scores.length ? `${Math.round(stats.followPct * 100)}%` : '—'}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Bot took the same entry</div><div className="bl-tile-v">{scores.length ? `${stats.matched} / ${scores.length}` : '—'}</div></div>
        </div>
        <div className="s1p-progress"><div style={{ width: `${Math.min(100, (scores.length / GOAL) * 100)}%` }} /></div>
      </div>

      <div className="bl-card">
        <div className="bl-head">
          <h3>Your results vs the bot</h3>
          <label className="bl-check"><input type="checkbox" checked={onlyS1} onChange={e => setOnlyS1(e.target.checked)} /> Only trades tagged S1{onlyS1 && untagged ? ` (${untagged} other replay trade${untagged > 1 ? 's' : ''} hidden)` : ''}</label>
        </div>
        {status !== 'ok' && <p className="bl-dim">Scoring your replay trades… {results.length ? `${results.length} day(s) done` : ''}</p>}
        {scores.length === 0 && status === 'ok' ? (
          <p className="bl-dim">No {onlyS1 ? 'S1-tagged ' : ''}replay trades yet. Start with day 1 below.</p>
        ) : (
          <table className="bl-table">
            <thead><tr><th></th><th>Trades</th><th>Win</th><th>Avg R</th><th>PF</th><th>Total</th></tr></thead>
            <tbody>
              <SumRow label="All your trades" s={stats.all} />
              <SumRow label="Followed every rule" s={stats.followed} />
              <SumRow label="Broke at least one rule" s={stats.broken} />
              <SumRow label="Bot: S1 Morning, same days" s={stats.bot} note="What the coded S1 took on the days you traded" />
            </tbody>
          </table>
        )}
        {scores.length > 0 && (
          <p className="s1p-verdict">
            {scores.length < GOAL
              ? `Too few trades to judge (${scores.length}; need ${GOAL}+). Keep going.`
              : stats.all && stats.bot && stats.all.avgR > stats.bot.avgR && stats.all.avgR > 0
                ? `You beat the bot on the same days (${fmtR(stats.all.avgR)} vs ${fmtR(stats.bot.avgR)} per trade). Next: find what you do differently so it can be coded and tested on new data.`
                : `You did not beat the bot on the same days (${fmtR(stats.all?.avgR)} vs ${fmtR(stats.bot?.avgR)}). The S1 idea is not working in practice either. Review the broken rules below before adding more trades.`}
            {stats.worst ? ` Most broken rule: "${stats.worst.label}" (${stats.worst.n}×).` : ''}
          </p>
        )}
      </div>

      <div className="bl-card">
        <h3>Practice days</h3>
        <p className="bl-dim">25 fixed days: a mix of trend, range, gap and quiet days. The day type stays hidden until you have traded it.</p>
        <div className="s1p-days">
          {days.map(d => (
            <div key={d.day} className={`s1p-day${d.trades ? ' done' : ''}`}>
              <span className="s1p-num">{d.n}</span>
              <span className="s1p-date">{fmtDay(d.day)}</span>
              <span className="bl-dim s1p-kind">{d.trades ? `${KIND[d.kind] || d.kind} · ${d.dir === 'up' ? '▲' : '▼'} ${d.range} pt · ${d.trades} trade${d.trades > 1 ? 's' : ''}` : 'to do'}</span>
              <button className="s1p-btn" onClick={() => openReplayDay(d.day)} title="Open the Market Chart in replay at 9:25 ET on this day"><Play size={13} /> Replay</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bl-card">
        <h3>Each trade, rule by rule</h3>
        {results.length === 0 && <p className="bl-dim">{status === 'ok' ? 'Nothing yet.' : 'Loading…'}</p>}
        {results.map(d => {
          const list = d.scores.filter(s => !onlyS1 || s.taggedS1);
          if (!list.length && !practiceSet.has(d.day)) return null;
          const morning = d.bot.filter(b => b.morning);
          return (
            <div key={d.day} className="s1p-dayblock">
              <div className="s1p-dayhead">
                <b>{fmtDay(d.day)}</b>{practiceSet.has(d.day) && <span className="s1p-tag">practice day</span>}
                <span className="bl-dim">Bot S1 Morning: {morning.length ? morning.map(b => `${etTime.format(new Date(b.t))} ${b.dir > 0 ? 'long' : 'short'} ${fmtR(b.r)}`).join(' · ') : 'no signal'}</span>
              </div>
              {d.error && <p className="bl-bad">{d.error}</p>}
              {list.map(s => {
                const isOpen = !!open[s.trade.id];
                return (
                  <div key={s.trade.id} className="s1p-trade">
                    <button className="s1p-trow" onClick={() => setOpen(o => ({ ...o, [s.trade.id]: !isOpen }))}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span>{etTime.format(new Date(s.trade.entry))} ET</span>
                      <span className={s.trade.side === 'long' ? 'bl-up' : 'bl-down'}>{s.trade.side}</span>
                      <span className="bl-dim">{s.trade.setup_tag || 'no setup tag'}</span>
                      <span className={s.r != null && s.r > 0 ? 'bl-up' : 'bl-down'}>{fmtR(s.r)}</span>
                      <span className={`s1p-badge ${s.followed ? 'ok' : 'no'}`}>{s.followed ? 'rules followed' : `${s.checks.filter(c => c.ok === false).length} rule(s) broken`}</span>
                      {s.botMatch ? <span className="s1p-badge bot">bot took it too ({fmtR(s.botMatch.r)})</span> : <span className="bl-dim">bot: no matching signal</span>}
                    </button>
                    {isOpen && (
                      <ul className="s1p-checks">
                        {s.checks.map(c => (
                          <li key={c.key}><Mark ok={c.ok} /><div><b>{c.label}</b><div className="bl-dim">{c.detail}</div></div></li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
