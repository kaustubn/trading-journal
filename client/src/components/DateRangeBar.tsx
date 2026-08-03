import React from 'react';
import '../styles/DateRangeBar.css';

interface Range { from: string | null; to: string | null; label: string; }
interface Props {
  range: Range;
  onChange: (r: Range) => void;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function DateRangeBar({ range, onChange }: Props) {
  const today = new Date();
  const y = today.getFullYear();

  const presets: Range[] = [
    { from: null, to: null, label: 'All time' },
    { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) },
    { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) },
    { from: `${y - 2}-01-01`, to: `${y - 2}-12-31`, label: String(y - 2) },
    { from: `${y - 3}-01-01`, to: `${y - 3}-12-31`, label: String(y - 3) },
    { from: iso(new Date(today.getTime() - 30 * 864e5)), to: iso(today), label: 'Last 30d' },
    { from: iso(new Date(today.getTime() - 90 * 864e5)), to: iso(today), label: 'Last 90d' },
  ];

  return (
    <div className="range-bar">
      <div className="range-presets">
        {presets.map(p => (
          <button
            key={p.label}
            className={`range-btn ${range.label === p.label ? 'active' : ''}`}
            onClick={() => onChange(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="range-custom">
        <input type="date" value={range.from || ''}
          onChange={e => onChange({ from: e.target.value || null, to: range.to, label: 'Custom' })} />
        <span>→</span>
        <input type="date" value={range.to || ''}
          onChange={e => onChange({ from: range.from, to: e.target.value || null, label: 'Custom' })} />
      </div>
    </div>
  );
}
