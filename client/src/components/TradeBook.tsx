// AI Trade Book: strategies the AI's backtests recorded, with every trade (entry, exit, management, and what each
// timeframe / level looked like at entry). "Open on chart" shows the trade on the market chart (journal account
// "AI Playbook"). Server: src/patterns/tradeBook.ts, /api/patterns/book.
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BookOpen, CheckCircle2, XCircle, CandlestickChart, Play, Trash2, ArrowLeft } from 'lucide-react';
import { openOnChart, openReplayDay } from '../utils/chartLink';
import '../styles/BacktestLab.css';
import '../styles/PatternFinder.css';

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const rr = (x: number | null | undefined) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}R`);
const usd = (x: number) => `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

interface Playbook {
  id: number; source: string; name: string; rule: string; status: 'prop-ready' | 'watch'; created_at: string; updated_at: string;
  stats: any; gate: { propReady: boolean; checks: { name: string; pass: boolean; value: string }[] };
}

export default function TradeBook({ token, openId }: { token: string; openId?: number | null }) {
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);
  const [list, setList] = useState<Playbook[] | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<number | null>(openId ?? null);
  const load = () => axios.get('/api/patterns/book', auth).then(r => setList(r.data.playbooks)).catch(e => setErr(e.response?.data?.error || 'Failed to load'));
  useEffect(() => { load(); }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (openId) setSel(openId); }, [openId]);

  if (sel) return <Detail auth={auth} id={sel} onBack={() => { setSel(null); load(); }} />;
  return (
    <div className="bl-card">
      <div className="pf-note"><BookOpen size={15} style={{ flexShrink: 0 }} /><span>
        When an AI backtest finds a strategy, every trade it would have taken is recorded here: how it entered, how it was managed and why it exited,
        and what each timeframe and key level looked like at the entry. Edge Hunter records a strategy <b>automatically</b> when it passes the prop gate
        (t ≥ 3, positive on validation and on unseen days, worst drawdown ≤ 5R); you can also press “Record every trade” on any Edge Hunter rule.
        Trades are saved in the journal account <b>AI Playbook</b> (one attempt per strategy), so “Open on chart” shows each one.</span></div>
      {err && <p className="bl-bad">{err}</p>}
      {!list && !err && <p className="bl-dim">Loading…</p>}
      {list && !list.length && <p className="bl-dim" style={{ marginTop: 10 }}>Nothing recorded yet. No strategy has passed the prop gate so far. Run Edge Hunter, or press “Record every trade” on a rule you want to study.</p>}
      <div className="tb-list">
        {list?.map(p => (
          <div key={p.id} className={`tb-card ${p.status === 'prop-ready' ? 'ok' : ''}`}>
            <div className="tb-top">
              <span className={`tb-badge ${p.status === 'prop-ready' ? 'ok' : 'watch'}`}>{p.status === 'prop-ready' ? 'PROP-READY' : 'WATCH'}</span>
              <b>{p.name}</b> <span className="bl-dim">· {p.source} · {new Date(p.updated_at).toLocaleDateString()}</span>
            </div>
            <div className="bl-dim tb-rule">{p.rule}</div>
            <div className="eh-stats" style={{ marginLeft: 0 }}>
              <span>{p.stats.replayed} trades</span><span>win {pct(p.stats.winRate)}</span>
              <span>avg <b className={p.stats.avgNetR > 0 ? 'bl-up' : 'bl-down'}>{rr(p.stats.avgNetR)}</b></span>
              <span>total {rr(p.stats.totalNetR)} · {usd(p.stats.netUsdNQ)} (1 NQ)</span>
              <span>PF {p.stats.profitFactor ?? '—'}</span><span>max DD {p.stats.maxDdR}R</span><span>t {p.stats.tStat}</span>
              <span>unseen days {rr(p.stats.hold?.avgR)} on {p.stats.hold?.n}</span>
              {p.stats.replayMatch != null && <span className={p.stats.replayMatch >= 0.99 ? 'bl-up' : 'bl-down'}>replay check {pct(p.stats.replayMatch)}</span>}
            </div>
            <div className="tb-gate">{p.gate.checks.map(c => (
              <span key={c.name} className={c.pass ? 'bl-up' : 'bl-down'}>{c.pass ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {c.name} <i className="bl-dim">({c.value})</i></span>
            ))}</div>
            <button className="pf-run" onClick={() => setSel(p.id)}>View every trade</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ auth, id, onBack }: { auth: any; id: number; onBack: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all');
  const [page, setPage] = useState(0);
  const [pick, setPick] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { axios.get(`/api/patterns/book/${id}`, auth).then(r => setD(r.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load')); }, [auth, id]);
  if (err) return <div className="bl-card"><button className="mm-link" onClick={onBack}><ArrowLeft size={12} /> Back</button><p className="bl-bad">{err}</p></div>;
  if (!d) return <div className="bl-card"><p className="bl-dim">Loading every trade…</p></div>;
  const p: Playbook = d.playbook, st = p.stats;
  const rows = [...d.trades].reverse().filter((t: any) => (filter === 'all' ? true : filter === 'win' ? t.netR > 0 : t.netR <= 0));
  const PAGE = 100, shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const del = async () => { await axios.delete(`/api/patterns/book/${id}`, auth); onBack(); };
  return (
    <>
      <div className="bl-card">
        <button className="mm-link" onClick={onBack}><ArrowLeft size={12} /> All strategies</button>
        <div className="tb-top" style={{ marginTop: 8 }}>
          <span className={`tb-badge ${p.status === 'prop-ready' ? 'ok' : 'watch'}`}>{p.status === 'prop-ready' ? 'PROP-READY' : 'WATCH'}</span><b>{p.name}</b>
        </div>
        <p className="bl-dim">{p.rule}</p>
        <div className="bl-tiles">
          <div className="bl-tile"><div className="bl-tile-label">Trades · win rate</div><div className="bl-tile-v">{st.replayed} · {pct(st.winRate)}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Avg per trade (after costs)</div><div className={`bl-tile-v ${st.avgNetR > 0 ? 'bl-up' : 'bl-down'}`}>{rr(st.avgNetR)}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Total · 1 NQ / 1 MNQ</div><div className="bl-tile-v">{rr(st.totalNetR)}</div><div className="bl-dim" style={{ fontSize: 11 }}>{usd(st.netUsdNQ)} / {usd(st.netUsdMNQ)}</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Exits</div><div className="bl-tile-v" style={{ fontSize: 13 }}>{Object.entries(st.exitReasons || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</div><div className="bl-dim" style={{ fontSize: 11 }}>avg {st.avgMinutesHeld} min in a trade</div></div>
          <div className="bl-tile"><div className="bl-tile-label">Best day share of profit</div><div className="bl-tile-v">{pct(st.bestDayShare)}</div><div className="bl-dim" style={{ fontSize: 11 }}>prop consistency rules often cap 30–50%</div></div>
        </div>
        <div className="tb-gate">{p.gate.checks.map(c => (
          <span key={c.name} className={c.pass ? 'bl-up' : 'bl-down'}>{c.pass ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {c.name} <i className="bl-dim">({c.value})</i></span>
        ))}</div>
        {st.replayMatch != null && <p className="bl-dim">Replay check: {pct(st.replayMatch)} of trades re-walked on the chart data give exactly the backtest's result.</p>}
      </div>

      <div className="bl-card">
        <h3>Which confluences went with better trades</h3>
        <p className="bl-dim">Each line splits the trades by one condition at the moment of entry. A big difference that also holds on the unseen days could become an extra filter; with few trades it is usually noise.</p>
        <div className="pf-scroll">
          <table className="pf-grid mm-table">
            <thead><tr><th style={{ textAlign: 'left' }}>Condition at entry</th><th>With: trades</th><th>win</th><th>avg</th><th>Without: trades</th><th>win</th><th>avg</th></tr></thead>
            <tbody>{(st.factors || []).map((f: any) => (
              <tr key={f.name}><td style={{ textAlign: 'left' }}>{f.name}</td>
                <td>{f.withN}</td><td>{pct(f.withWin)}</td><td className={(f.withAvgR ?? 0) > 0 ? 'bl-up' : 'bl-down'}>{rr(f.withAvgR)}</td>
                <td>{f.withoutN}</td><td>{pct(f.withoutWin)}</td><td className={(f.withoutAvgR ?? 0) > 0 ? 'bl-up' : 'bl-down'}>{rr(f.withoutAvgR)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="bl-card">
        <div className="bl-head"><h3 style={{ margin: 0 }}>Every trade</h3>
          <div className="pf-seg">{(['all', 'win', 'loss'] as const).map(k => <button key={k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setPage(0); }}>{k === 'all' ? 'All' : k === 'win' ? 'Winners' : 'Losers'}</button>)}</div>
        </div>
        <div className="pf-scroll">
          <table className="pf-grid mm-table tb-trades">
            <thead><tr><th>Day</th><th>Time</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Exit</th><th>Result</th><th>Confluence</th><th></th></tr></thead>
            <tbody>{shown.map((t: any) => (
              <tr key={t.tradeId ?? `${t.date}${t.entry.time}`} className={pick === t ? 'tb-sel' : ''} onClick={() => setPick(t)} style={{ cursor: 'pointer' }}>
                <td>{t.date} <span className="bl-dim">{t.weekday}</span></td><td>{t.entry.time}</td>
                <td className={t.dir === 'long' ? 'bl-up' : 'bl-down'}>{t.dir}</td>
                <td>{t.entry.price}</td><td>{t.stop.price}</td><td>{t.target.price}</td>
                <td>{t.exit.reason} {t.exit.time}</td>
                <td className={t.netR > 0 ? 'bl-up' : 'bl-down'}>{rr(t.netR)}</td>
                <td>{t.confluence.score}/{t.confluence.of}</td>
                <td><button className="mm-link" onClick={e => { e.stopPropagation(); setPick(t); }}>Details</button></td>
              </tr>))}</tbody>
          </table>
        </div>
        {rows.length > PAGE && <div className="pf-seg" style={{ marginTop: 6 }}>
          {Array.from({ length: Math.ceil(rows.length / PAGE) }, (_, i) => <button key={i} className={page === i ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>)}
        </div>}
      </div>

      {pick && <TradeCard t={pick} onClose={() => setPick(null)} />}

      <div className="bl-card">
        {!confirmDel ? <button className="mm-link" onClick={() => setConfirmDel(true)}><Trash2 size={12} /> Remove this strategy</button>
          : <span>Remove “{p.name}” and its {st.replayed} journal trades from the AI Playbook account? This cannot be undone.{' '}
            <button className="mm-link" onClick={del}>Yes, remove</button> <button className="mm-link" onClick={() => setConfirmDel(false)}>Cancel</button></span>}
      </div>
    </>
  );
}

function TradeCard({ t, onClose }: { t: any; onClose: () => void }) {
  const c = t.confluence;
  return (
    <div className="bl-card tb-card-detail">
      <div className="bl-head">
        <h3 style={{ margin: 0 }}>{t.date} {t.weekday} · {t.dir} at {t.entry.price} ({t.entry.time} ET) → <span className={t.netR > 0 ? 'bl-up' : 'bl-down'}>{rr(t.netR)}</span></h3>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {t.tradeId && <button className="s1p-btn" onClick={() => openOnChart(t.tradeId)}><CandlestickChart size={12} /> Open on chart</button>}
          <button className="s1p-btn" onClick={() => openReplayDay(t.date)}><Play size={12} /> Replay the day</button>
          <button className="mm-link" onClick={onClose}>Close</button>
        </span>
      </div>
      <div className="mm-two">
        <div>
          <div className="bl-head"><b>How the trade was taken and managed</b></div>
          <ol className="tb-timeline">{t.management.map((m: any, i: number) => <li key={i}><b>{m.time}</b> {m.event}</li>)}</ol>
          <p className="bl-dim">Stop {t.stop.pts} pt · target {t.target.r}R ({t.target.pts} pt) · held {t.minutesHeld} min · best +{t.mfeR}R, worst −{t.maeR}R ·
            {' '}{t.netUsdNQ >= 0 ? '+' : ''}{t.netUsdNQ} $ on 1 NQ ({t.netUsdMNQ >= 0 ? '+' : ''}{t.netUsdMNQ} $ on 1 MNQ) after costs</p>
        </div>
        <div>
          <div className="bl-head"><b>Confluence at entry: {c.score}/{c.of} agree</b></div>
          <table className="pf-grid mm-table" style={{ minWidth: 0 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Timeframe</th><th>Trend</th><th>With the trade?</th></tr></thead>
            <tbody>
              {c.timeframes.map((x: any) => <tr key={x.tf}><td style={{ textAlign: 'left' }}>{x.tf}</td><td>{x.trend}</td><td className={x.agrees ? 'bl-up' : 'bl-down'}>{x.agrees ? 'yes' : 'no'}</td></tr>)}
              <tr><td style={{ textAlign: 'left' }}>VWAP</td><td>price {c.vwap.side} ({c.vwap.distPts > 0 ? '+' : ''}{c.vwap.distPts} pt)</td><td className={c.vwap.agrees ? 'bl-up' : 'bl-down'}>{c.vwap.agrees ? 'yes' : 'no'}</td></tr>
            </tbody>
          </table>
          <div className="bl-head" style={{ marginTop: 8 }}><b>Levels</b> <span className="bl-dim">(distance from price; ★ = within half an ATR)</span></div>
          <div className="mm-chips">{c.levels.map((l: any) => <span key={l.name}>{l.near ? '★ ' : ''}{l.name} {l.price} <b>{l.distPts > 0 ? '+' : ''}{l.distPts}</b></span>)}</div>
          <p className="bl-dim">{c.context.time} ET · gap {c.context.gapPts ?? '—'} pt · ATR(5m) {c.context.atr5m} · {c.context.volatility} volatility · range so far {c.context.dayRangeSoFar} pt{c.context.news ? ` · news: ${c.context.news}` : ''}</p>
        </div>
      </div>
    </div>
  );
}
