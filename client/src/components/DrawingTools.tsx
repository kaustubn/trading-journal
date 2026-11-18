import React, { useEffect, useRef, useState } from 'react';
import { DrawingController, Magnet } from '../chart/drawingController';
import { Tool, TOOLS, COLORS, LineStyle, Drawing } from '../chart/drawings';
import { TEMPLATES, tplPatch } from '../chart/templates';

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
  measure: <Icon><path {...S} d="M4 16L16 4l4 4L8 20z" /><path {...S} d="M8 12l2 2M11 9l2 2M14 6l2 2" /></Icon>,
  magnet: <Icon><path {...S} d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z" /><path {...S} d="M6 8h4M14 8h4" /></Icon>,
  lock: <Icon><rect {...S} x="6" y="11" width="12" height="9" rx="1.5" /><path {...S} d="M8.5 11V8a3.5 3.5 0 017 0v3" /></Icon>,
  eye: <Icon><path {...S} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle {...S} cx="12" cy="12" r="3" /></Icon>,
  eyeOff: <Icon><path {...S} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><path {...S} d="M4 20L20 4" /></Icon>,
  trash: <Icon><path {...S} d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></Icon>,
};

const GROUPS: Tool[][] = [
  ['trend', 'hline', 'hray', 'vline'],
  ['rect', 'channel', 'fib'],
  ['text', 'arrow'],
  ['long', 'short'],
];
const MAGNET_NEXT: Record<Magnet, Magnet> = { off: 'weak', weak: 'strong', strong: 'off' };
const MAGNET_LABEL: Record<Magnet, string> = { off: 'Magnet off', weak: 'Weak magnet', strong: 'Strong magnet' };

interface ToolbarProps {
  ctl: DrawingController | null;
  magnet: Magnet; hidden: boolean; lockAll: boolean; measureArmed: boolean;
  onMagnet: (m: Magnet) => void; onHidden: (v: boolean) => void; onLockAll: (v: boolean) => void;
  onMeasure: (armed: boolean) => void;
}

/** TradingView-style vertical drawing toolbar on the left of the chart. */
export function DrawToolbar({ ctl, magnet, hidden, lockAll, measureArmed, onMagnet, onHidden, onLockAll, onMeasure }: ToolbarProps) {
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
            <button key={t} disabled={!ready} className={`mc-dbtn${active === t ? ' on' : ''}`}
              title={TOOLS[t].key ? `${TOOLS[t].label} (${TOOLS[t].key})` : TOOLS[t].label}
              onClick={() => pick(t)}>{ICONS[t]}</button>
          ))}
        </React.Fragment>
      ))}
      <span className="mc-dsep" />
      <button disabled={!ready} className={`mc-dbtn${measureArmed ? ' on' : ''}`} title="Measure (or Shift + drag on the chart)"
        onClick={() => { ctl?.cancel(); onMeasure(!measureArmed); }}>{ICONS.measure}</button>
      <span className="mc-dgrow" />
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
  );
}
