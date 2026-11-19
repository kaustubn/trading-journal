import { useState } from 'react';
import '../styles/Checklist.css';

// Tick the gates and confluence factors before an entry; the result updates live.
const GATES = [
  'Prime session (open→~2 hrs / power hour) — no lunch chop (12–1 ET)',
  'ATR-14: 8–30 normal · 30–40 cut size 40% · >40 SKIP',
  'Day classified at IB (10:00 ET): trend/expansion vs range/reversal',
  'No news next 5 min · normal spread/volatility',
  'Entry references a real level (VWAP/POC/VAH-VAL/PDH-PDL/swing/round#)',
  'Stop + R:R + size defined before entry',
  'Scanned BOTH directions — not married to a bias',
];
const FACTORS = ['Level stack (2+)', '15m HTF aligned', 'Clean structure', 'Tape / delta confirm', 'ATR 8–30', 'R:R ≥ 2.5', 'Major level', 'Prime time'];

export default function Checklist() {
  const [gates, setGates] = useState<boolean[]>(() => GATES.map(() => false));
  const [factors, setFactors] = useState<boolean[]>(() => FACTORS.map(() => false));
  const flip = (arr: boolean[], i: number) => arr.map((v, k) => (k === i ? !v : v));
  const gatesOk = gates.filter(Boolean).length, allGates = gatesOk === GATES.length;
  const pts = factors.filter(Boolean).length;
  const grade = pts >= 6 ? 'A' : pts >= 4 ? 'B' : 'C';
  const touched = gatesOk + pts > 0;
  const result = !touched ? { cls: 'idle', text: 'Tick the gates and factors for the trade you are looking at.' }
    : !allGates ? { cls: 'c', text: `NO TRADE — ${GATES.length - gatesOk} gate${GATES.length - gatesOk > 1 ? 's' : ''} not passed. Any gate fails → no trade.` }
      : grade === 'A' ? { cls: 'a', text: `A setup — ${pts} pts → full size, take it.` }
        : grade === 'B' ? { cls: 'b', text: `B setup — ${pts} pts → half size / selective.` }
          : { cls: 'c', text: `C — only ${pts} pts → NO TRADE. That's a hope, not an edge.` };
  return (
    <div className="checklist">
      <p className="cl-flow">Work top-down: <b>1</b> universal gates → <b>2</b> day type → <b>3</b> setup criteria → <b>4</b> score &amp; rank. Any gate fails → no trade.</p>

      <div className="cl-card">
        <h3>1 · Universal Gates <span className="cl-note">(all must pass · {gatesOk}/{GATES.length} ticked)</span></h3>
        <ul className="cl-ticks">
          {GATES.map((g, i) => (
            <li key={g}><label className={gates[i] ? 'on' : ''}><input type="checkbox" checked={gates[i]} onChange={() => setGates(cur => flip(cur, i))} /> {g}</label></li>
          ))}
        </ul>
      </div>

      <div className="cl-card">
        <h3>2 · Day Type → Which Setup Is Live</h3>
        <ul>
          <li><strong>Trend / expansion</strong> → S1 (pullback) or ORB (breakout). Don't fade.</li>
          <li><strong>Range / reversal</strong> → S2 (extreme fade) or S3 (sweep reversal). Don't chase.</li>
          <li>Unsure → no trade until IB resolves.</li>
        </ul>
      </div>

      <div className="cl-grid">
        <div className="cl-card setup">
          <h4>S1 — Trend Pullback <span className="cl-tag">trend day</span></h4>
          <ul>
            <li>C1 Trend: 2 HH/HL (3 swings) · EMA-21 slope ≥ ±0.001</li>
            <li>C2 Pullback: 30–60% into level (tol 0.15%)</li>
            <li>C3 Rejection: 5-min body closes ≥50% off level</li>
            <li>C4 Trigger: 2-min close ≤4 candles after rejection</li>
            <li>R:R ≥ 1:2.5</li>
          </ul>
        </div>
        <div className="cl-card setup">
          <h4>S2 — Range Extreme Fade <span className="cl-tag">range day</span></h4>
          <ul>
            <li>At range extreme (VAH/VAL, PDH/PDL, session hi/lo)</li>
            <li>5-min wick rejection at the extreme</li>
            <li>Entry: first 2-min close back in fade direction</li>
            <li>Stop: 5 pts beyond wick</li>
            <li>T1 VWAP/POC (60%), T2 opposite extreme (40%) · R:R 1.5–2</li>
          </ul>
        </div>
        <div className="cl-card setup">
          <h4>S3 — Liquidity Sweep Reversal <span className="cl-tag">range/reversal</span></h4>
          <ul>
            <li>Magnet: sweep hits real liquidity (PDH/PDL, swing, VAH/VAL, round#)</li>
            <li>Sweep: 5-min wick beyond into stops (~0.1%)</li>
            <li>Reclaim: closes back on original side in 1–2 candles</li>
            <li>Trend filter: skip if 5+ HH/HL in last 10 bars (no fading runaway)</li>
            <li>Entry 2-min close ≤4 candles · stop 3–5 pts beyond wick · R:R 2–3</li>
          </ul>
        </div>
        <div className="cl-card setup">
          <h4>ORB — Opening Range Breakout <span className="cl-tag">expansion day</span></h4>
          <ul>
            <li>Opening range defined</li>
            <li>Break + hold (close outside, not a wick)</li>
            <li>Volume / momentum expansion on the break</li>
            <li>Entry on break or pullback to edge · stop back inside range</li>
            <li>Only on classified expansion day</li>
          </ul>
        </div>
      </div>

      <div className="cl-card score">
        <h3>4 · Confluence Score → Rank <span className="cl-note">(1 pt each · {pts}/8)</span></h3>
        <div className="cl-factors">
          {FACTORS.map((f, i) => (
            <button key={f} type="button" className={factors[i] ? 'on' : ''} aria-pressed={factors[i]} onClick={() => setFactors(cur => flip(cur, i))}>{factors[i] ? '✓ ' : ''}{f}</button>
          ))}
        </div>
        <div className="cl-ranks">
          <div className="cl-rank a"><strong>A</strong> 6–8 pts → full size, take it</div>
          <div className="cl-rank b"><strong>B</strong> 4–5 pts → half size / selective</div>
          <div className="cl-rank c"><strong>C</strong> ≤3 pts → <strong>NO TRADE</strong> — where accounts bleed</div>
        </div>
        <p className="cl-rule">Only A and B. Can't tick 4+? That's a hope, not an edge.</p>
      </div>

      <div className={`cl-result ${result.cls}`} role="status">
        <span>{result.text}</span>
        {touched && <button type="button" onClick={() => { setGates(GATES.map(() => false)); setFactors(FACTORS.map(() => false)); }}>Reset</button>}
      </div>

      <div className="cl-card">
        <h3>5 · After Entry</h3>
        <ul>
          <li>Physical stop placed (not mental)</li>
          <li>T1 → move stop to BE+3</li>
          <li>Log setup tag (S1/S2/S3/ORB) + grade (A/B/C) on the trade → review per-setup edge</li>
        </ul>
      </div>
    </div>
  );
}
