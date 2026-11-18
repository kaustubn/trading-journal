// "Teach me this trade" — step-by-step lesson for a backtest trade (see utils/tradeTeach.ts).
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { GraduationCap, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import {
  Bar, Facts, Levels, Market, Step, TeachTrade, baseFacts, buildMarket, buildSteps, etTime, playbookFor,
} from '../utils/tradeTeach';

interface ChartTrade { entry: number | null; exit: number | null; side: 'long' | 'short' | null }

const MIN = 60000;

async function getBars(tf: number, from: number | null, to: number, limit: number): Promise<Bar[]> {
  const q = new URLSearchParams({ symbol: 'NQ', tf: String(tf), to: String(to), limit: String(limit) });
  if (from != null) q.set('from', String(from));
  const r = await axios.get(`/api/bars?${q}`);
  return r.data.bars as Bar[];
}

/** Candles around the trade with entry / stop / target lines. `reveal` = show the bars after the entry. */
function MiniChart({ f, m, reveal }: { f: Facts; m: Market; reveal: boolean }) {
  const W = 560, H = 230, PAD_R = 104, PAD_T = 10, PAD_B = 18;
  const view = useMemo(() => {
    let bars = m.bars.filter(b => b[0] >= f.entryMs - 75 * MIN);
    if (!reveal) bars = bars.filter(b => b[0] < f.entryMs + MIN);
    // group into 3m / 5m / 15m candles when there are too many
    const tf = bars.length > 360 ? 15 : bars.length > 180 ? 5 : bars.length > 110 ? 3 : 1;
    if (tf > 1) {
      const out: Bar[] = [];
      for (const b of bars) {
        const t = Math.floor(b[0] / (tf * MIN)) * tf * MIN;
        const last = out[out.length - 1];
        if (last && last[0] === t) { last[2] = Math.max(last[2], b[2]); last[3] = Math.min(last[3], b[3]); last[4] = b[4]; last[5] += b[5]; }
        else out.push([t, b[1], b[2], b[3], b[4], b[5]]);
      }
      bars = out;
    }
    return { bars, tf };
  }, [m.bars, f.entryMs, reveal]);
  const { bars, tf } = view;
  if (bars.length < 2) return <div className="tt-chart-empty">No chart data for this time.</div>;
  const prices = bars.flatMap(b => [b[2], b[3]]).concat([f.entry]);
  if (f.stop != null) prices.push(f.stop);
  if (f.target != null) prices.push(f.target);
  const hi = Math.max(...prices), lo = Math.min(...prices);
  const pad = (hi - lo) * 0.06 || 1;
  const yMax = hi + pad, yMin = lo - pad;
  const y = (v: number) => PAD_T + ((yMax - v) / (yMax - yMin)) * (H - PAD_T - PAD_B);
  const step = (W - PAD_R) / bars.length;
  const x = (i: number) => i * step + step / 2;
  const xAt = (ms: number) => {
    const i = bars.findIndex(b => b[0] + tf * MIN > ms);
    return i < 0 ? x(bars.length - 1) : x(i);
  };
  const cw = Math.max(1, step * 0.65);
  // price labels on the right, pushed apart when the lines are close together
  const labels = ([['tt-tgt', 'Target', f.target], ['tt-entry', 'Entry', f.entry], ['tt-stop', 'Stop', f.stop]] as [string, string, number | null][])
    .filter(l => l[2] != null).map(l => ({ cls: l[0], label: l[1], v: l[2] as number, ly: y(l[2] as number) + 4 }))
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 12);
  const line = (v: number | null, cls: string) => {
    const l = labels.find(x => x.cls === cls);
    return v == null || !l ? null : (
      <g className={cls}>
        <line x1={0} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
        <text x={W - PAD_R + 4} y={l.ly}>{l.label} {v.toFixed(2)}</text>
      </g>
    );
  };
  const ex = f.exitMs != null && reveal ? xAt(f.exitMs) : null;
  return (
    <svg className="tt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Candles around the trade">
      {m.nyOpen != null && m.levels && bars[0][0] <= m.levels.nyStart && bars[bars.length - 1][0] >= m.levels.nyStart && (
        <line className="tt-ny" x1={xAt(m.levels.nyStart)} x2={xAt(m.levels.nyStart)} y1={PAD_T} y2={H - PAD_B} />
      )}
      {bars.map((b, i) => {
        const up = b[4] >= b[1];
        const after = b[0] >= f.entryMs;
        return (
          <g key={b[0]} className={`${up ? 'tt-up' : 'tt-dn'}${after ? ' tt-after' : ''}`}>
            <line x1={x(i)} x2={x(i)} y1={y(b[2])} y2={y(b[3])} />
            <rect x={x(i) - cw / 2} width={cw} y={y(Math.max(b[1], b[4]))} height={Math.max(1, Math.abs(y(b[1]) - y(b[4])))} />
          </g>
        );
      })}
      {line(f.target, 'tt-tgt')}
      {line(f.stop, 'tt-stop')}
      {line(f.entry, 'tt-entry')}
      <line className="tt-mark" x1={xAt(f.entryMs)} x2={xAt(f.entryMs)} y1={PAD_T} y2={H - PAD_B} />
      <text className="tt-tag" x={xAt(f.entryMs) + 3} y={H - 5}>entry {etTime(f.entryMs)}</text>
      {ex != null && <line className="tt-mark tt-exit" x1={ex} x2={ex} y1={PAD_T} y2={H - PAD_B} />}
      {!reveal && <text className="tt-hidden" x={W - PAD_R - 6} y={PAD_T + 12} textAnchor="end">future hidden</text>}
      <text className="tt-tf" x={4} y={PAD_T + 10}>{tf}m candles · New York time</text>
    </svg>
  );
}

export default function TradeTeacher({ trade }: { trade: TeachTrade }) {
  const pb = playbookFor(trade);
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'nochart' | 'error'>('loading');

  useEffect(() => {
    if (!pb) return;
    let dead = false;
    (async () => {
      try {
        const ct: ChartTrade = (await axios.get(`/api/chart/trade/${trade.id}`)).data.trade;
        if (dead || ct.entry == null) { setStatus('error'); return; }
        const f = baseFacts(trade, ct.side, ct.entry, ct.exit);
        setFacts(f);
        try {
          const endMs = Math.max(f.exitMs ?? f.entryMs, f.entryMs) + 15 * MIN;
          const startMs = f.entryMs - 8 * 60 * MIN; // enough for the 9:30 open on a morning trade
          const [m1, m5, m15, lv] = await Promise.all([
            getBars(1, startMs, Math.min(endMs, startMs + 1400 * MIN), 1500),
            getBars(5, null, Math.floor(f.entryMs / (5 * MIN)) * 5 * MIN, 80),
            getBars(15, null, Math.floor(f.entryMs / (15 * MIN)) * 15 * MIN, 80),
            axios.get(`/api/bars/levels?symbol=NQ&at=${f.entryMs}`).then(r => r.data.levels as Levels | null),
          ]);
          if (dead) return;
          setMarket(m1.length ? buildMarket(f, m1, m5, m15, lv) : null);
          setStatus(m1.length ? 'ok' : 'nochart');
        } catch {
          if (!dead) setStatus('nochart');
        }
      } catch {
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, [trade.id]);

  const steps: Step[] = useMemo(
    () => (pb && facts ? buildSteps(pb, facts, market, trade.setup_tag || '') : []),
    [pb, facts, market, trade.setup_tag]);

  if (!pb) return null;
  const s = steps[Math.min(step, steps.length - 1)];

  return (
    <div className="tt">
      <button className="tt-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <GraduationCap className="ic-sm" />
        <span className="tt-title">Teach me this trade</span>
        <span className="tt-sub">{pb.name}{steps.length ? ` · step ${step + 1} of ${steps.length}` : ''}</span>
        <ChevronDown className={`ic-sm tt-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="tt-body">
          {status === 'loading' && !facts && <div className="tt-dim">Loading the market around this trade…</div>}
          {status === 'error' && <div className="tt-dim">Could not load this trade.</div>}
          {s && (
            <>
              {market && facts && <MiniChart f={facts} m={market} reveal={s.reveal} />}
              {status === 'nochart' && <div className="tt-dim">No market bars for this time, so the lesson uses the strategy rules only.</div>}
              {market && market.shift !== 0 && (
                <div className="tt-dim">Chart prices shifted {market.shift > 0 ? '+' : ''}{market.shift} pt to match the backtest (different futures contract month).</div>
              )}
              <div className="tt-dots">
                {steps.map((x, i) => (
                  <button key={x.title} className={`tt-dot${i === step ? ' on' : ''}${i < step ? ' done' : ''}`} onClick={() => setStep(i)}
                    title={x.title} aria-label={x.title} />
                ))}
              </div>
              <h4 className="tt-step">{s.title}</h4>
              <div className="tt-say">
                {s.say.map((line, i) => <p key={i} className={line.startsWith('•') || /^\d\. /.test(line) ? 'tt-li' : line.startsWith('→') ? 'tt-go' : ''}>{line}</p>)}
              </div>
              {s.facts && (
                <dl className="tt-facts">
                  {s.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
              )}
              <div className="tt-nav">
                <button className="tt-btn" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft className="ic-sm" /> Back</button>
                <button className="tt-btn primary" disabled={step >= steps.length - 1} onClick={() => setStep(step + 1)}>Next <ChevronRight className="ic-sm" /></button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
