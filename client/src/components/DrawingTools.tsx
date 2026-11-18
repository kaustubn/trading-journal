import React, { useEffect, useRef, useState } from 'react';
import { DrawingController, Magnet } from '../chart/drawingController';
import { Tool, TOOLS, COLORS, LineStyle, Drawing } from '../chart/drawings';
import { TEMPLATES, tplPatch } from '../chart/templates';
import { Floating } from './ChartDialogs';
import { Star, ChevronsLeft, X, ListTree } from 'lucide-react';

// ---------- icons (24px, stroke = currentColor) ----------
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);
const ICONS: Record<Tool | 'cursor' | 'measure' | 'magnet' | 'lock' | 'eye' | 'eyeOff' | 'trash', React.ReactNode> = {
  cursor: <Icon><path {...S} d="M6 4l12 7-5.5 1.5L10 18z" /></Icon>,
  trend: <Icon><path {...S} d="M5 19L19 5" /><circle {...S} cx="5" cy="19" r="1.8" /><circle {...S} cx="19" cy="5" r="1.8" /></Icon>,
  hline: <Icon><path {...S} d="M3 12h18" /><circle {...S} cx="12" cy="12" r="1.8" /></Icon>,
  hray: <Icon><path {...S} d="M7 12h14" /><circle {...S} cx="5" cy="12" r="1.8" /></Icon>,
  vline: <Icon><path {...S} d="M12 3v18" /><circle {...S} cx="12" cy="12" r="1.8" /></Icon>,
  rect: <Icon><rect {...S} x="4" y="6" width="16" height="12" rx="1" /></Icon>,
  fib: <Icon><path {...S} d="M4 5h16M4 10h16M4 14h16M4 19h16" /><path {...S} strokeDasharray="2 2" d="M5 19L19 5" /></Icon>,
  channel: <Icon><path {...S} d="M3 15L15 5M9 19L21 9" /><path {...S} strokeDasharray="2 2" d="M6 17L18 7" /></Icon>,
  text: <Icon><path {...S} d="M6 6h12M12 6v13M9.5 19h5" /></Icon>,
  arrow: <Icon><path {...S} d="M5 19L18 6" /><path {...S} d="M10 6h8v8" /></Icon>,
  long: <Icon><rect x="4" y="4" width="16" height="8" fill="#089981" opacity=".55" /><rect x="4" y="12" width="16" height="6" fill="#f23645" opacity=".55" /><path {...S} d="M4 12h16" /></Icon>,
  short: <Icon><rect x="4" y="6" width="16" height="6" fill="#f23645" opacity=".55" /><rect x="4" y="12" width="16" height="8" fill="#089981" opacity=".55" /><path {...S} d="M4 12h16" /></Icon>,
  path: <Icon><path {...S} d="M4 18l5-8 5 5 6-9" /><circle {...S} cx="4" cy="18" r="1.5" /><circle {...S} cx="9" cy="10" r="1.5" /><circle {...S} cx="14" cy="15" r="1.5" /><circle {...S} cx="20" cy="6" r="1.5" /></Icon>,
  brush: <Icon><path {...S} d="M4 17c2-1 3-5 6-5s2 4 5 4 3-6 5-8" /></Icon>,
  highlight: <Icon><path stroke="currentColor" strokeOpacity=".45" strokeWidth="5" strokeLinecap="round" fill="none" d="M5 15c3-3 6-2 8-4s4-3 6-3" /></Icon>,
  daterange: <Icon><path {...S} d="M5 5v14M19 5v14M7 12h10" /><path {...S} d="M14 9l3 3-3 3" /></Icon>,
  dprange: <Icon><rect {...S} x="4" y="5" width="16" height="14" rx="1" /><path {...S} d="M12 7v10M7 12h10" /></Icon>,
  gann: <Icon><rect {...S} x="4" y="4" width="16" height="16" /><path {...S} d="M4 20L20 4M4 20L20 12M4 20L12 4" /></Icon>,
  avwap: <Icon><path {...S} d="M3 18c4-1 5-9 9-9s5 5 9 3" /><circle cx="3.5" cy="18" r="1.6" fill="currentColor" /></Icon>,
  vprofile: <Icon><path {...S} d="M4 4v16" /><path stroke="currentColor" strokeWidth="2.5" d="M5 6h5M5 9h9M5 12h14M5 15h8M5 18h4" /></Icon>,
  measure: <Icon><path {...S} d="M4 16L16 4l4 4L8 20z" /><path {...S} d="M8 12l2 2M11 9l2 2M14 6l2 2" /></Icon>,
  magnet: <Icon><path {...S} d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z" /><path {...S} d="M6 8h4M14 8h4" /></Icon>,
  lock: <Icon><rect {...S} x="6" y="11" width="12" height="9" rx="1.5" /><path {...S} d="M8.5 11V8a3.5 3.5 0 017 0v3" /></Icon>,
  eye: <Icon><path {...S} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle {...S} cx="12" cy="12" r="3" /></Icon>,
  eyeOff: <Icon><path {...S} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><path {...S} d="M4 20L20 4" /></Icon>,
  trash: <Icon><path {...S} d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></Icon>,
};

const GROUPS: Tool[][] = [
  ['trend', 'hline', 'hray', 'vline', 'path'],
  ['rect', 'channel', 'fib', 'gann'],
  ['brush', 'highlight', 'text', 'arrow'],
  ['long', 'short', 'daterange', 'dprange', 'vprofile', 'avwap'],
];
const MAGNET_NEXT: Record<Magnet, Magnet> = { off: 'weak', weak: 'strong', strong: 'off' };
const MAGNET_LABEL: Record<Magnet, string> = { off: 'Magnet off', weak: 'Weak magnet', strong: 'Strong magnet' };

interface ToolbarProps {
  ctl: DrawingController | null;
  magnet: Magnet; hidden: boolean; lockAll: boolean; measureArmed: boolean;
  stay: boolean; onStay: (v: boolean) => void;
  fav: Tool[]; onFav: (t: Tool) => void; favBar: boolean; onFavBar: (v: boolean) => void; onCollapse: () => void;
  treeOpen: boolean; onTree: () => void;
  onMagnet: (m: Magnet) => void; onHidden: (v: boolean) => void; onLockAll: (v: boolean) => void;
  onMeasure: (armed: boolean) => void;
}

/** TradingView-style vertical drawing toolbar on the left of the chart. */
export function DrawToolbar({ ctl, magnet, hidden, lockAll, measureArmed, stay, onStay, fav, onFav, favBar, onFavBar, onCollapse, treeOpen, onTree, onMagnet, onHidden, onLockAll, onMeasure }: ToolbarProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmClear]);
  const ready = !!ctl?.loaded;
  const active = ctl?.active ?? null;
  const count = ctl?.drawings.length ?? 0;
  const pick = (t: Tool) => {
    if (!ctl) return;
    onMeasure(false);
    if (active === t) ctl.cancel(); else ctl.start(t);
  };

  return (
    <div className="mc-draw" role="toolbar" aria-label="Drawing tools">
      <button className={`mc-dbtn${!active && !measureArmed ? ' on' : ''}`} title="Cursor (Esc)"
        onClick={() => { ctl?.cancel(); onMeasure(false); }}>{ICONS.cursor}</button>
      {GROUPS.map((g, i) => (
        <React.Fragment key={i}>
          <span className="mc-dsep" />
          {g.map(t => (
            <button key={t} disabled={!ready} className={`mc-dbtn${active === t ? ' on' : ''}${fav.includes(t) ? ' fav' : ''}`}
              onContextMenu={e => { e.preventDefault(); onFav(t); }}
              title={`${TOOLS[t].label}${TOOLS[t].key ? ` (${TOOLS[t].key})` : ''}${TOOLS[t].hint ? ` — ${TOOLS[t].hint}` : ''}`}
              onClick={() => pick(t)}>{ICONS[t]}</button>
          ))}
        </React.Fragment>
      ))}
      <span className="mc-dsep" />
      <button disabled={!ready} className={`mc-dbtn${measureArmed ? ' on' : ''}`} title="Measure (or Shift + drag on the chart)"
        onClick={() => { ctl?.cancel(); onMeasure(!measureArmed); }}>{ICONS.measure}</button>
      <span className="mc-dgrow" />
      <button className={`mc-dbtn${treeOpen ? ' on' : ''}`} title="Drawings list (object tree): find, hide, lock, delete" onClick={onTree}><ListTree size={18} strokeWidth={1.6} /></button>
      <button className={`mc-dbtn${favBar ? ' on' : ''}`} title={favBar ? 'Hide the favourites toolbar' : 'Show the favourites toolbar (right-click any tool to add / remove it)'}
        onClick={() => onFavBar(!favBar)}><Star size={18} strokeWidth={1.6} /></button>
      <button className="mc-dbtn" title="Hide the drawing toolbar" onClick={onCollapse}><ChevronsLeft size={18} strokeWidth={1.6} /></button>
      <button className={`mc-dbtn${stay ? ' on' : ''}`} title={stay ? 'Stay in drawing mode: ON — the tool stays on after each drawing; right-click or Esc to stop' : 'Stay in drawing mode: OFF — back to the cursor after each drawing'}
        onClick={() => onStay(!stay)}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M4 20l4-1 10-10-3-3L5 16zM13 7l3 3" /><rect x="14" y="15" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M15.5 15v-1.5a2 2 0 014 0V15" /></svg>
      </button>
      <button className={`mc-dbtn${magnet !== 'off' ? ' on' : ''}`} title={`${MAGNET_LABEL[magnet]} — click for ${MAGNET_LABEL[MAGNET_NEXT[magnet]].toLowerCase()}`}
        onClick={() => onMagnet(MAGNET_NEXT[magnet])}>
        {ICONS.magnet}{magnet === 'strong' && <span className="mc-dbadge">S</span>}
      </button>
      <button className={`mc-dbtn${lockAll ? ' on' : ''}`} title={lockAll ? 'Unlock all drawings' : 'Lock all drawings'}
        onClick={() => onLockAll(!lockAll)}>{ICONS.lock}</button>
      <button className={`mc-dbtn${hidden ? ' on' : ''}`} title={hidden ? 'Show drawings' : 'Hide all drawings'}
        onClick={() => onHidden(!hidden)}>{hidden ? ICONS.eyeOff : ICONS.eye}</button>
      <button disabled={!ready || !count} className={`mc-dbtn${confirmClear ? ' danger' : ''}`}
        title={confirmClear ? `Click again to remove all ${count} drawings` : 'Remove all drawings'}
        onClick={() => { if (!ctl) return; if (confirmClear) { ctl.clear(); setConfirmClear(false); } else setConfirmClear(true); }}>
        {ICONS.trash}
      </button>
    </div>
  );
}

const WIDTHS = [1, 2, 3, 4];
const LINES: { v: LineStyle; label: string }[] = [{ v: 'solid', label: '━' }, { v: 'dashed', label: '╍' }, { v: 'dotted', label: '┉' }];

/** Floating bar for the selected drawing: colour, width, line style, text, size, lock, delete. */
export function DrawEditBar({ ctl, tplOf, onTemplate }: {
  ctl: DrawingController | null;
  tplOf?: (tool: Tool) => string | undefined;
  onTemplate?: (tool: Tool, name: string) => void;   // remembered for that tool's next drawings
}) {
  const d = ctl?.selectedDrawing ?? null;
  const [text, setText] = useState('');
  const [qty, setQty] = useState('1');
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(d?.text ?? '');
    setQty(String(d?.qty ?? 1));
  }, [d?.id, d?.text, d?.qty]);

  // A new text drawing opens straight into editing
  useEffect(() => {
    if (d && d.tool === 'text' && ctl?.justCreated === d.id) {
      ctl.justCreated = null;
      window.setTimeout(() => { textRef.current?.focus(); textRef.current?.select(); }, 0);
    }
  }, [d, ctl]);

  if (!ctl || !d) return null;
  const set = (patch: Partial<Drawing>) => ctl.update(d.id, patch);
  const position = d.tool === 'long' || d.tool === 'short';
  const commitText = () => { const v = text.trim() || 'Text'; if (v !== d.text) set({ text: v }); };
  const commitQty = () => {
    const n = Math.round(Number(qty));
    if (Number.isFinite(n) && n >= 1 && n <= 100) set({ qty: n }); else setQty(String(d.qty ?? 1));
  };

  const tpls = TEMPLATES[d.tool] ?? [];
  const labelled = d.tool === 'hline' || d.tool === 'hray' || d.tool === 'trend';
  return (
    <Floating id="draw-edit" bare initial={{ x: Math.max(80, Math.round(window.innerWidth / 2 - 260)), y: 150 }} className="mc-edit-float">
    <div className="mc-edit" onMouseDown={e => e.stopPropagation()}>
      <span className="mc-edit-name">{TOOLS[d.tool].label}</span>
      {tpls.length > 0 && (
        <select className="mc-input mc-tpl" value="" title="Templates from your TradingView (choosing one also makes it the default for this tool)"
          onChange={e => {
            const t = tpls.find(x => x.name === e.target.value);
            if (!t) return;
            set(tplPatch(t.style));
            onTemplate?.(d.tool, t.name);
          }}>
          <option value="">Template{tplOf?.(d.tool) ? ` · ${tplOf(d.tool)}` : ''} ▾</option>
          {tpls.map(t => <option key={t.name} value={t.name}>{t.name}{t.from === 'TV chart' ? ' (from your chart)' : ''}</option>)}
        </select>
      )}
      {labelled && (
        <input className="mc-input mc-edit-text" placeholder="Label" maxLength={60} defaultValue={d.text ?? ''} key={`${d.id}:${d.text ?? ''}`}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={e => { const v = e.target.value.trim(); if (v !== (d.text ?? '')) set({ text: v || undefined }); }} />
      )}
      {!position && (
        <>
          <div className="mc-swatches">
            {COLORS.map(c => (
              <button key={c} className={`mc-swatch${d.color === c ? ' on' : ''}`} style={{ background: c }}
                title={c} aria-label={`Colour ${c}`} onClick={() => set({ color: c })} />
            ))}
          </div>
          <div className="mc-seg" title={d.tool === 'text' ? 'Text size' : 'Line width'}>
            {WIDTHS.map(w => (
              <button key={w} className={d.width === w ? 'on' : ''} onClick={() => set({ width: w })}>
                {d.tool === 'text' ? ['S', 'M', 'L', 'XL'][w - 1] : `${w}px`}
              </button>
            ))}
          </div>
          {d.tool !== 'text' && (
            <div className="mc-seg" title="Line style">
              {LINES.map(l => (
                <button key={l.v} className={d.line === l.v ? 'on' : ''} title={l.v} onClick={() => set({ line: l.v })}>{l.label}</button>
              ))}
            </div>
          )}
        </>
      )}
      {d.tool === 'text' && (
        <input ref={textRef} className="mc-input mc-edit-text" value={text} maxLength={200} placeholder="Text"
          onChange={e => setText(e.target.value)} onBlur={commitText}
          onKeyDown={e => { if (e.key === 'Enter') { commitText(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setText(d.text ?? ''); (e.target as HTMLInputElement).blur(); } }} />
      )}
      {position && (
        <>
          <label className="mc-edit-label">Qty
            <input className="mc-input mc-edit-qty" value={qty} inputMode="numeric"
              onChange={e => setQty(e.target.value)} onBlur={commitQty}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </label>
          <div className="mc-seg" title="Contract">
            {(['NQ', 'MNQ'] as const).map(c => (
              <button key={c} className={(d.contract ?? 'NQ') === c ? 'on' : ''} onClick={() => set({ contract: c })}>{c}</button>
            ))}
          </div>
        </>
      )}
      <button className={`mc-btn mc-small${d.locked ? ' on' : ''}`} title={d.locked ? 'Unlock' : 'Lock in place'}
        onClick={() => set({ locked: !d.locked })}>{ICONS.lock}</button>
      <button className="mc-btn mc-small mc-danger-btn" title="Delete (Del)" onClick={() => ctl.remove(d.id)}>{ICONS.trash}</button>
    </div>
    </Floating>
  );
}

/** Kay's TradingView favourite drawing tools, as a floating bar you can drag and hide. */
export function FavBar({ ctl, tools, onClose }: { ctl: DrawingController | null; tools: Tool[]; onClose: () => void }) {
  const active = ctl?.active ?? null;
  return (
    <Floating id="fav-bar" bare initial={{ x: 140, y: 120 }} className="mc-fav-float">
      <div className="mc-fav" role="toolbar" aria-label="Favourite drawing tools">
        {tools.map(t => (
          <button key={t} className={`mc-dbtn${active === t ? ' on' : ''}`} disabled={!ctl?.loaded}
            title={`${TOOLS[t].label}${TOOLS[t].hint ? ` — ${TOOLS[t].hint}` : ''}`}
            onClick={() => { if (!ctl) return; if (active === t) ctl.cancel(); else ctl.start(t); }}>{ICONS[t]}</button>
        ))}
        {!tools.length && <span className="mc-dim mc-fav-empty">Right-click tools on the left toolbar to add them here</span>}
        <button className="mc-dbtn mc-fav-close" title="Hide the favourites toolbar" onClick={onClose}><X size={14} /></button>
      </div>
    </Floating>
  );
}
