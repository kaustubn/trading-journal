// Edge decay monitor: each setup's rolling average (last N trades) with a 95% band, so a setup
// whose edge has faded shows it before the account does.
import { useMemo } from 'react';
import type { TradeLite } from '../utils/backtestStats';

interface Props { groups: { k: string; trades: TradeLite[] }[]; window?: number; }

interface Series { k: string; unit: 'R' | '$'; pts: { i: number; m: number; lo: number; hi: number }[]; all: number; last: number; n: number; status: 'faded' | 'fading' | 'holding' | 'losing' | 'young' }

function build(k: string, trades: TradeLite[], w: number): Series {
  const list = [...trades].sort((a, b) => a.t - b.t);
  const rs = list.map(t => t.r);
  const useR = rs.filter(x => typeof x === 'number' && Number.isFinite(x)).length >= list.length * 0.9;
  const v = list.map(t => (useR ? (t.r as number) : t.pnl)).filter(x => Number.isFinite(x));
  const pts: Series['pts'] = [];
  for (let i = w; i <= v.length; i++) {
    const s = v.slice(i - w, i);
    const m = s.reduce((a, b) => a + b, 0) / w;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (w - 1));
    const e = 1.96 * sd / Math.sqrt(w);
    pts.push({ i, m, lo: m - e, hi: m + e });
  }
  const all = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  const lastP = pts[pts.length - 1];
  const last = lastP?.m ?? all;
  let status: Series['status'] = 'young';
  if (lastP) {
    if (all <= 0) status = 'losing';
    else if (lastP.hi < 0) status = 'faded';            // even the top of the recent band is below zero
    else if (last < all * 0.5) status = 'fading';       // recent average under half the long-run one
    else status = 'holding';
  }
  return { k, unit: useR ? 'R' : '$', pts, all, last, n: v.length, status };
}

const STATUS: Record<Series['status'], [string, string]> = {
  faded: ['Edge gone', 'The last trades are clearly negative: stop trading it and review what changed.'],
  fading: ['Fading', 'Recent results are under half the long-run average: trade it smaller and watch it.'],
  holding: ['Holding', 'Recent results are in line with the long-run average.'],
  losing: ['No edge', 'Negative over all its trades.'],
  young: ['Too few trades', 'Needs more trades before a rolling view means anything.'],
};

function Mini({ s, w }: { s: Series; w: number }) {
  const W = 300, H = 90;
  if (s.pts.length < 2) return <div className="ed-empty">Fewer than {w + 1} trades.</div>;
  const ys = s.pts.flatMap(p => [p.lo, p.hi]).concat([0, s.all]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (j: number) => (j / (s.pts.length - 1)) * W, y = (v: number) => H - 4 - ((v - lo) / span) * (H - 8);
  const band = s.pts.map((p, j) => `${x(j)},${y(p.hi)}`).join(' ') + ' ' + [...s.pts].reverse().map((p, j) => `${x(s.pts.length - 1 - j)},${y(p.lo)}`).join(' ');
  return (
    <svg className="ed-svg" viewBox={`0 0 ${W} ${H}`} aria-label={`${s.k} rolling average`}>
      <polygon points={band} className="ed-band" />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="ed-zero" />
      <line x1={0} x2={W} y1={y(s.all)} y2={y(s.all)} className="ed-all" />
      <polyline points={s.pts.map((p, j) => `${x(j)},${y(p.m)}`).join(' ')} className={`ed-line ed-${s.status}`} />
    </svg>
  );
}

export default function EdgeDecay({ groups, window = 30 }: Props) {
  const series = useMemo(() => groups.filter(g => g.trades.length >= 10).map(g => build(g.k, g.trades, window))
    .sort((a, b) => b.n - a.n).slice(0, 8), [groups, window]);
  if (!series.length) return <p className="bl-dim">Needs a setup with at least 10 trades.</p>;
  const fmt = (s: Series, v: number) => (s.unit === 'R' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}R` : `${v < 0 ? '−' : '+'}$${Math.abs(v).toFixed(0)}`);
  return (
    <div className="ed-grid">
      {series.map(s => (
        <div key={s.k} className="ed-card">
          <div className="ed-head">
            <b>{s.k}</b>
            <span className={`ed-badge ed-${s.status}`} title={STATUS[s.status][1]}>{STATUS[s.status][0]}</span>
          </div>
          <Mini s={s} w={window} />
          <div className="ed-foot">
            <span>Last {window}: <b>{fmt(s, s.last)}</b></span>
            <span>All {s.n}: <b>{fmt(s, s.all)}</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}
