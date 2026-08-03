import React from 'react';
import '../styles/Checklist.css';

export default function Checklist() {
  return (
    <div className="checklist">
      <div className="cl-head">
        <h2>✅ NQ Entry Checklist & Ranking</h2>
        <p>Top-down: Universal gates → Day type → Setup criteria → Score & rank. Any gate fails → NO TRADE.</p>
      </div>

      <div className="cl-card">
        <h3>1 · Universal Gates <span className="cl-note">(all must pass)</span></h3>
        <ul>
          <li>Prime session (open→~2 hrs / power hour) — no lunch chop (12–1 ET)</li>
          <li>ATR-14: 8–30 normal · 30–40 cut size 40% · <strong>&gt;40 SKIP</strong></li>
          <li>Day classified at IB (10:00 ET): trend/expansion vs range/reversal</li>
          <li>No news next 5 min · normal spread/volatility</li>
          <li>Entry references a real level (VWAP/POC/VAH-VAL/PDH-PDL/swing/round#)</li>
          <li>Stop + R:R + size defined <strong>before</strong> entry</li>
          <li>Scanned BOTH directions — not married to a bias</li>
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
        <h3>4 · Confluence Score → Rank <span className="cl-note">(1 pt each)</span></h3>
        <div className="cl-factors">
          <span>Level stack (2+)</span><span>15m HTF aligned</span><span>Clean structure</span>
          <span>Tape / delta confirm</span><span>ATR 8–30</span><span>R:R ≥ 2.5</span>
          <span>Major level</span><span>Prime time</span>
        </div>
        <div className="cl-ranks">
          <div className="cl-rank a"><strong>A</strong> 6–8 pts → full size, take it</div>
          <div className="cl-rank b"><strong>B</strong> 4–5 pts → half size / selective</div>
          <div className="cl-rank c"><strong>C</strong> ≤3 pts → <strong>NO TRADE</strong> — where accounts bleed</div>
        </div>
        <p className="cl-rule">Only A and B. Can't tick 4+? That's a hope, not an edge.</p>
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
