import React, { useState } from 'react';
import { FIRMS, STYLES, GLOSSARY, LAST_UPDATED, ACCOUNT_TYPES, Firm, SizeDetail } from '../data/propfirms';
import CostCalculator from './CostCalculator';
import '../styles/PropFirms.css';

type Size = '25K' | '50K';

function Row({ label, value, hi }: { label: string; value: string; hi?: boolean }) {
  const good = /none|unlimited|on-demand|no monthly/i.test(value) && !/none —/i.test(value);
  const warn = /⚠|closes|cap|scale|carries/i.test(value);
  return (
    <div className={`det-row ${hi ? 'det-hi' : ''}`}>
      <span className="det-label">{label}</span>
      <span className={`det-val ${good ? 'good' : ''} ${warn ? 'warn' : ''}`}>{value}</span>
    </div>
  );
}

function FirmDetail({ f, size }: { f: Firm; size: Size }) {
  const d: SizeDetail = f.sizes[size];
  if (!d.available) {
    return <div className="firm-na">{d.note || `${f.name} doesn't offer a ${size} account.`}</div>;
  }
  return (
    <div className="firm-detail">
      <div className="det-col">
        <div className="det-group-title">Pass the eval</div>
        <Row label="Profit target" value={d.profitTarget} />
        <Row label="Max drawdown" value={d.maxDrawdown} />
        <Row label="Min trading days" value={d.minDays} />
        <Row label="Cost" value={d.cost} />
      </div>
      <div className="det-col">
        <div className="det-group-title">Trading limits</div>
        <Row label="Contracts / lots" value={d.contracts} hi />
        {d.scaling && <Row label="Scaling gotcha" value={d.scaling} />}
        <Row label="Daily loss limit" value={d.dailyLoss} />
        <Row label="Consistency rule" value={d.consistency} />
        <Row label="Profit split" value={d.split} />
      </div>
      <div className="det-col">
        <div className="det-group-title">💰 Payouts (the hidden part)</div>
        <Row label="How many payouts" value={d.payoutCount} hi />
        <Row label="Cap per payout" value={d.payoutCap} hi />
        <Row label="Minimum payout" value={d.payoutMin} />
        <Row label="Days between" value={d.daysBetween} />
        <Row label="Unlock 1st payout" value={d.firstPayout} />
      </div>
      {d.note && <div className="det-note">💡 {d.note}</div>}
    </div>
  );
}

export default function PropFirms() {
  const [size, setSize] = useState<Size>('50K');
  const [style, setStyle] = useState<string | null>(null);
  const [openFirm, setOpenFirm] = useState<string | null>('apex');
  const [showGlossary, setShowGlossary] = useState(false);

  const styleObj = STYLES.find(s => s.key === style);
  const matches = (f: Firm) => !style || f.tags.includes(style);

  return (
    <div className="propfirms">
      <div className="pf-head">
        <div>
          <h2>🏦 Prop Firms — 25K & 50K, spelled out</h2>
          <p>The stuff firms hide — contract limits, payout caps, how many payouts — made plain. Researched {LAST_UPDATED}; always confirm the exact number on the firm's site before buying.</p>
        </div>
      </div>

      {/* Size + style pickers */}
      <div className="pf-card">
        <div className="pf-controls">
          <div className="size-toggle">
            {(['25K', '50K'] as Size[]).map(s => (
              <button key={s} className={`size-btn ${size === s ? 'on' : ''}`} onClick={() => setSize(s)}>{s} account</button>
            ))}
          </div>
        </div>
        <div className="pf-styles">
          {STYLES.map(s => (
            <button key={s.key} className={`pf-style ${style === s.key ? 'on' : ''}`} onClick={() => setStyle(style === s.key ? null : s.key)}>{s.label}</button>
          ))}
        </div>
        {styleObj && <div className="pf-why">→ {styleObj.why}</div>}
      </div>

      {/* Cost calculator */}
      <CostCalculator size={size} />

      {/* Firm detail cards */}
      <div className="pf-firms">
        {FIRMS.map((f: Firm) => (
          <div key={f.id} className={`pf-firmcard ${style && !matches(f) ? 'dim' : ''} ${style && matches(f) ? 'hit' : ''}`}>
            <div className="pf-firmcard-head" onClick={() => setOpenFirm(openFirm === f.id ? null : f.id)}>
              <div>
                <div className="pf-firmname">{f.name} <span className="pf-variant">· {f.variant}</span> <span className="pf-rating">★ {f.rating}</span></div>
                <div className="pf-tagline">{f.tagline}</div>
                <div className="pf-dd">{f.drawdownType}</div>
              </div>
              <div className="pf-headright">
                <div className="pf-discount">
                  <div className="pf-code">{f.discount.code}</div>
                  <div className="pf-off">{f.discount.off}</div>
                </div>
                <span className="pf-expand">{openFirm === f.id ? '▾' : '▸'}</span>
              </div>
            </div>
            {openFirm === f.id && (
              <div className="pf-firmcard-body">
                {ACCOUNT_TYPES[f.id] && (
                  <div className="acct-types">
                    <div className="det-group-title">Account types — which to pick</div>
                    <div className="acct-cards">
                      {ACCOUNT_TYPES[f.id].map(a => (
                        <div key={a.name} className={`acct-card path-${a.path.toLowerCase()}`}>
                          <div className="acct-head">
                            <span className="acct-name">{a.name}</span>
                            <span className={`acct-path ${a.path.toLowerCase()}`}>{a.path === 'Instant' ? '⚡ Instant' : '📝 Eval'}</span>
                          </div>
                          <span className={`acct-diff d-${a.difficulty.toLowerCase()}`}>{a.difficulty} to pass</span>
                          <div className="acct-line">🏁 {a.pass}</div>
                          <div className="acct-line">💵 {a.payout}</div>
                          <div className="acct-note">{a.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <FirmDetail f={f} size={size} />
                <div className="pf-proscons">
                  <div className="pf-pros"><b>✓ Pros</b><ul>{f.pros.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
                  <div className="pf-cons"><b>✗ Cons</b><ul>{f.cons.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
                </div>
                <div className="pf-links">
                  <a href={f.url} target="_blank" rel="noreferrer" className="pf-link">Open {f.name} →</a>
                  <a href={f.discount.source} target="_blank" rel="noreferrer" className="pf-link ghost">🔎 Check latest discount (verified {f.discount.verified})</a>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="pf-note">💡 Discount codes change constantly — the "Check latest" links go to trackers that update daily. Always verify the code at checkout.</p>

      {/* Glossary */}
      <div className="pf-card">
        <button className="pf-gloss-toggle" onClick={() => setShowGlossary(!showGlossary)}>
          {showGlossary ? '▾' : '▸'} What do these terms mean? (contracts, payouts, drawdown…)
        </button>
        {showGlossary && (
          <div className="pf-glossary">
            {GLOSSARY.map(g => (
              <div key={g.term} className="pf-gloss-item">
                <div className="pf-gloss-term">{g.term}</div>
                <div className="pf-gloss-def">{g.def}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
