import React, { useState } from 'react';
import { FIRMS, PRICES, Price } from '../data/propfirms';

type Size = '25K' | '50K';

export default function CostCalculator({ size }: { size: Size }) {
  const [attempts, setAttempts] = useState(1);
  const [months, setMonths] = useState(1);
  const [discount, setDiscount] = useState(50);
  const [cad, setCad] = useState(true);       // default CAD for the user
  const [rate, setRate] = useState(1.37);     // USD → CAD, editable
  // Editable per-firm prices (overrides defaults)
  const [edits, setEdits] = useState<Record<string, Partial<Price>>>({});

  const d = 1 - discount / 100;
  const priceOf = (id: string): Price | null => {
    const base = PRICES[id]?.[size];
    if (!base) return null;
    const e = edits[id] || {};
    return { eval: e.eval ?? base.eval, monthly: e.monthly ?? base.monthly, activation: e.activation ?? base.activation };
  };

  // total = discounted eval × attempts + discounted monthly × months + activation
  const totalOf = (p: Price) => Math.round(p.eval * d * attempts + p.monthly * d * months + p.activation);

  const rows = FIRMS
    .map(f => ({ f, p: priceOf(f.id) }))
    .filter(r => r.p)
    .map(r => ({ ...r, total: totalOf(r.p!) }))
    .sort((a, b) => a.total - b.total);
  const unavailable = FIRMS.filter(f => !priceOf(f.id));

  const cheapest = rows.length ? rows[0].total : 0;

  const setEdit = (id: string, key: keyof Price, val: string) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [key]: val === '' ? undefined : Number(val) } }));

  // Display a USD amount in the chosen currency
  const fmt = (usd: number) => {
    const v = cad ? Math.round(usd * rate) : usd;
    return `${cad ? 'CA$' : '$'}${v.toLocaleString()}`;
  };

  return (
    <div className="pf-card cost-calc">
      <h3>💰 Cost-to-Funded Calculator — {size}</h3>
      <p className="cc-sub">Prop firms bill in <b>USD</b>. Edit prices are USD; the <b>Total</b> shows in your chosen currency. Ballpark defaults — plug in your real checkout price.</p>

      <div className="cc-currency">
        <div className="cc-cur-toggle">
          <button className={!cad ? 'on' : ''} onClick={() => setCad(false)}>USD</button>
          <button className={cad ? 'on' : ''} onClick={() => setCad(true)}>CAD</button>
        </div>
        {cad && (
          <label className="cc-rate">USD→CAD rate
            <input type="number" step="0.01" value={rate} onChange={e => setRate(Number(e.target.value) || 1)} />
            <span className="cc-hint">+ your bank adds ~2.5% FX fee</span>
          </label>
        )}
      </div>

      <div className="cc-controls">
        <label>Attempts to pass
          <div className="cc-stepper">
            <button onClick={() => setAttempts(Math.max(1, attempts - 1))}>−</button>
            <span>{attempts}</span>
            <button onClick={() => setAttempts(attempts + 1)}>+</button>
          </div>
        </label>
        <label>Months to 1st payout <span className="cc-hint">(monthly firms)</span>
          <div className="cc-stepper">
            <button onClick={() => setMonths(Math.max(1, months - 1))}>−</button>
            <span>{months}</span>
            <button onClick={() => setMonths(months + 1)}>+</button>
          </div>
        </label>
        <label>Discount % on eval
          <div className="cc-slider">
            <input type="range" min={0} max={90} value={discount} onChange={e => setDiscount(Number(e.target.value))} />
            <span>{discount}%</span>
          </div>
        </label>
      </div>

      <div className="cc-tablewrap">
        <table className="cc-table">
          <thead>
            <tr><th>Firm</th><th>Eval (USD)</th><th>Monthly (USD)</th><th>Activation (USD)</th><th>Total ({cad ? 'CAD' : 'USD'})</th></tr>
          </thead>
          <tbody>
            {rows.map(({ f, p, total }) => (
              <tr key={f.id} className={total === cheapest ? 'cc-best' : ''}>
                <td>{f.name}{total === cheapest && <span className="cc-badge">cheapest</span>}</td>
                <td><input type="number" value={edits[f.id]?.eval ?? p!.eval} onChange={e => setEdit(f.id, 'eval', e.target.value)} /></td>
                <td><input type="number" value={edits[f.id]?.monthly ?? p!.monthly} onChange={e => setEdit(f.id, 'monthly', e.target.value)} /></td>
                <td><input type="number" value={edits[f.id]?.activation ?? p!.activation} onChange={e => setEdit(f.id, 'activation', e.target.value)} /></td>
                <td className="cc-total">{fmt(total)}</td>
              </tr>
            ))}
            {unavailable.map(f => (
              <tr key={f.id} className="cc-unavail">
                <td>{f.name}</td>
                <td colSpan={3} className="cc-na">no {size} account (starts at 50K)</td>
                <td className="cc-total">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cc-formula">
        Total = (Eval × {(d).toFixed(2)} × {attempts} attempt{attempts > 1 ? 's' : ''}) + (Monthly × {(d).toFixed(2)} × {months} mo) + Activation.
        Discount applies to eval + monthly; activation charged once on pass.
      </p>
    </div>
  );
}
