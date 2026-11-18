// Object tree, like TradingView's: every drawing in one list — find it, hide it, lock it,
// delete it, or click it to jump the chart to it.
import { useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Trash2, Crosshair } from 'lucide-react';
import { Floating } from './ChartDialogs';
import type { DrawingStore } from '../chart/drawingController';
import { Drawing, Tool, TOOLS, fmtPrice } from '../chart/drawings';
import { Clock, fmtWall } from '../chart/time';

interface Props {
  store: DrawingStore;
  clock: Clock;
  onJump: (d: Drawing) => void;
  onClose: () => void;
}

const describe = (d: Drawing, clock: Clock) => {
  const p0 = d.points[0];
  const prices = d.points.map(p => p.p);
  const price = d.tool === 'hline' || d.tool === 'hray' || prices.length === 1
    ? fmtPrice(p0.p)
    : `${fmtPrice(Math.min(...prices))} – ${fmtPrice(Math.max(...prices))}`;
  return `${price} · ${fmtWall(p0.t, clock).slice(0, 16)}`;
};

export default function ObjectTree({ store, clock, onJump, onClose }: Props) {
  const [q, setQ] = useState('');
  const [tool, setTool] = useState<Tool | ''>('');
  const list = store.drawings;
  const tools = useMemo(() => [...new Set(list.map(d => d.tool))].sort((a, b) => TOOLS[a].label.localeCompare(TOOLS[b].label)), [list]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...list]
      .filter(d => (!tool || d.tool === tool) && (!t || `${TOOLS[d.tool].label} ${d.text ?? ''} ${describe(d, clock)}`.toLowerCase().includes(t)))
      .sort((a, b) => b.points[0].t - a.points[0].t);
  }, [list, q, tool, clock]);
  const setMany = (ids: string[], patch: Partial<Drawing>) => {
    const set = new Set(ids);
    store.commit(store.drawings.map(d => (set.has(d.id) ? { ...d, ...patch } : d)));
  };
  const allHidden = shown.length > 0 && shown.every(d => d.hidden);
  return (
    <Floating id="object-tree" title={<>Drawings <span className="mc-dim">{list.length}</span></>} onClose={onClose} initial={{ x: Math.max(80, window.innerWidth - 420), y: 110 }} width={360}>
      <div className="mc-dlg-body mc-tree">
        <div className="mc-row">
          <input className="mc-input mc-grow" placeholder="Search price, date, label…" value={q} onChange={e => setQ(e.target.value)} />
          <select className="mc-input" value={tool} onChange={e => setTool(e.target.value as Tool | '')}>
            <option value="">All types</option>
            {tools.map(t => <option key={t} value={t}>{TOOLS[t].label} ({list.filter(d => d.tool === t).length})</option>)}
          </select>
        </div>
        <div className="mc-row mc-row-end">
          <span className="mc-dim mc-grow">{shown.length} shown</span>
          <button className="mc-btn mc-small" disabled={!shown.length} onClick={() => setMany(shown.map(d => d.id), { hidden: !allHidden })}>
            {allHidden ? <><Eye size={13} /> Show these</> : <><EyeOff size={13} /> Hide these</>}
          </button>
        </div>
        <div className="mc-tree-list">
          {shown.slice(0, 400).map(d => (
            <div key={d.id} className={`mc-tree-row${d.hidden ? ' hidden' : ''}`}>
              <span className="mc-tree-swatch" style={{ background: d.fill ?? d.color }} />
              <button className="mc-tree-name" onClick={() => onJump(d)} title="Show it on the chart">
                <b>{TOOLS[d.tool].label}{d.text ? ` · ${d.text}` : ''}</b>
                <span className="mc-dim">{describe(d, clock)}</span>
              </button>
              <button className="mc-btn mc-small" title="Go to it" onClick={() => onJump(d)}><Crosshair size={13} /></button>
              <button className="mc-btn mc-small" title={d.hidden ? 'Show' : 'Hide'} onClick={() => store.update(d.id, { hidden: !d.hidden })}>{d.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              <button className="mc-btn mc-small" title={d.locked ? 'Unlock' : 'Lock'} onClick={() => store.update(d.id, { locked: !d.locked })}>{d.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
              <button className="mc-btn mc-small mc-danger-btn" title="Delete" onClick={() => store.remove(d.id)}><Trash2 size={13} /></button>
            </div>
          ))}
          {shown.length > 400 && <div className="mc-hint">Showing the newest 400 — use the search or type filter.</div>}
          {!shown.length && <div className="mc-hint">No drawings match.</div>}
        </div>
      </div>
    </Floating>
  );
}
