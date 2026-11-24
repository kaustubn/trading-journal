// Floating windows for the market chart, TradingView-style: drag by the title bar, close,
// position remembered per browser. Plus the colour picker, the indicator settings dialog
// (the gear in an indicator's legend) and the chart settings dialog.
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  ChartCfg, ChartType, CHART_TYPES, CHART_TV, CHART_STD, IndKey, IndCfg, INDS, LINE_COLORS, lineNames, parseParams, VOL_BARS_TV,
} from '../chart/config';
import { NQ_STYLE_TV, NqStyle, NqLine } from '../chart/nqsys';
import { CPAT_DEFAULT, CpatOpts, PAT_INFO, PAT_TYPES, sanitizeCpat } from '../chart/chartPatterns';
import { CANDLE_INFO, CANDLE_TYPES, CNDL_DEFAULT, CndlOpts, sanitizeCndl } from '../chart/candlePatterns';

/** Number box that commits on blur / Enter and snaps back if the value is out of range. */
function NumBox({ value, min, max, step, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = () => { const v = Number(t); if (t.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v); else setT(String(value)); };
  return <input className="mc-input mc-w" type="number" min={min} max={max} step={step ?? 1} value={t}
    onChange={e => setT(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />;
}

const biasMark = (b: number) => (b > 0 ? '▲' : b < 0 ? '▼' : '◆');

function ChartPatternSettings({ opts, onChange }: { opts: CpatOpts; onChange: (o: CpatOpts) => void }) {
  const set = (patch: Partial<CpatOpts>) => onChange(sanitizeCpat({ ...opts, ...patch }));
  const groups = [...new Set(PAT_TYPES.map(t => PAT_INFO[t].group))];
  const all = (v: boolean) => set({ types: Object.fromEntries(PAT_TYPES.map(t => [t, v])) });
  return (<>
    <div className="mc-dlg-h">Matching</div>
    <div className="mc-dlg-row"><span>Similarity at least (%)</span><NumBox value={opts.minSim} min={50} max={100} onChange={v => set({ minSim: v })} /></div>
    <input type="range" min={50} max={100} value={opts.minSim} onChange={e => set({ minSim: Number(e.target.value) })} style={{ width: '100%' }} />
    <div className="mc-dlg-row"><span>Swing size (× ATR 14)</span><NumBox value={opts.sens} min={0.3} max={6} step={0.1} onChange={v => set({ sens: v })} /></div>
    <div className="mc-dlg-row"><span>Bars to search back</span><NumBox value={opts.lookback} min={100} max={10000} step={100} onChange={v => set({ lookback: v })} /></div>
    <div className="mc-dlg-row"><span>Stats: bars after pattern</span><NumBox value={opts.ahead} min={1} max={100} onChange={v => set({ ahead: v })} /></div>
    <div className="mc-hint">Lower similarity = more, looser patterns. Bigger swing size = fewer, larger patterns.</div>
    <div className="mc-dlg-h">Patterns <button className="mc-btn mc-small" onClick={() => all(true)}>All</button> <button className="mc-btn mc-small" onClick={() => all(false)}>None</button></div>
    {groups.map(g => (
      <div key={g}>
        <div className="mc-dim" style={{ marginTop: 4 }}>{g}</div>
        {PAT_TYPES.filter(t => PAT_INFO[t].group === g).map(t => (
          <label key={t} className="mc-check"><input type="checkbox" checked={!!opts.types[t]} onChange={e => set({ types: { ...opts.types, [t]: e.target.checked } })} /> {PAT_INFO[t].label} <span className="mc-dim">{biasMark(PAT_INFO[t].bias)}</span></label>
        ))}
      </div>
    ))}
    <div className="mc-dlg-h">Show</div>
    <label className="mc-check"><input type="checkbox" checked={opts.lines} onChange={e => set({ lines: e.target.checked })} /> Pattern lines</label>
    <label className="mc-check"><input type="checkbox" checked={opts.labels} onChange={e => set({ labels: e.target.checked })} /> Labels with similarity %</label>
    <label className="mc-check"><input type="checkbox" checked={opts.stats} onChange={e => set({ stats: e.target.checked })} /> Backtest stats in the legend</label>
    <div className="mc-hint">Stats show what followed each pattern on the bars loaded. They describe the past; they are not a tested edge.</div>
    <button className="mc-btn mc-small" onClick={() => onChange(sanitizeCpat(CPAT_DEFAULT))}>Reset to defaults</button>
  </>);
}

const CNDL_TFS: [number, string][] = [[0, 'Chart timeframe'], [1, '1 min'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [240, '4 hours']];
function CandlePatternSettings({ opts, onChange }: { opts: CndlOpts; onChange: (o: CndlOpts) => void }) {
  const set = (patch: Partial<CndlOpts>) => onChange(sanitizeCndl({ ...opts, ...patch }));
  return (<>
    <div className="mc-dlg-h">When</div>
    <div className="mc-dlg-row"><span>How many</span>
      <select className="mc-input" value={opts.run} onChange={e => set({ run: Number(e.target.value) })}>
        {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n === 1 ? 'single' : `${n} in a row`}</option>)}
      </select>
    </div>
    {opts.run > 1 && (
      <div className="mc-dlg-row"><span>Each candle</span>
        <select className="mc-input" value={opts.runMode} onChange={e => set({ runMode: e.target.value as CndlOpts['runMode'] })}>
          <option value="same">same pattern every time</option>
          <option value="any">any of the picked patterns</option>
        </select>
      </div>
    )}
    <div className="mc-dlg-row"><span>Engulfing rule</span>
      <select className="mc-input" value={opts.engulf} onChange={e => set({ engulf: e.target.value as CndlOpts['engulf'] })}>
        <option value="body">body covers previous body (your BBE rule)</option>
        <option value="classic">classic (opposite colour before)</option>
        <option value="close">closes past previous high / low</option>
      </select>
    </div>
    <div className="mc-hint">NQ candles open near the last close, so 2+ engulfing in a row is rare with the body rules; "closes past previous high / low" catches strong runs.</div>
    <div className="mc-dlg-row"><span>Timeframe</span>
      <select className="mc-input" value={opts.tf} onChange={e => set({ tf: Number(e.target.value) })}>
        {CNDL_TFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
    <div className="mc-hint">A higher timeframe is built from the chart's bars, so it must be a multiple of the chart timeframe. Only finished candles count.</div>
    <div className="mc-dlg-row"><span>Stats: candles after</span><NumBox value={opts.ahead} min={1} max={50} onChange={v => set({ ahead: v })} /></div>
    <div className="mc-dlg-h">Candles</div>
    {CANDLE_TYPES.map(t => (
      <label key={t} className="mc-check"><input type="checkbox" checked={!!opts.types[t]} onChange={e => set({ types: { ...opts.types, [t]: e.target.checked } })} /> {CANDLE_INFO[t].label} <span className="mc-dim">{biasMark(CANDLE_INFO[t].bias)}</span></label>
    ))}
    <div className="mc-hint">At least one candle stays picked: clearing them all goes back to bullish / bearish engulfing.</div>
    <div className="mc-dlg-h">Show</div>
    <label className="mc-check"><input type="checkbox" checked={opts.labels} onChange={e => set({ labels: e.target.checked })} /> Labels on the chart</label>
    <label className="mc-check"><input type="checkbox" checked={opts.stats} onChange={e => set({ stats: e.target.checked })} /> Backtest stats in the legend</label>
    <button className="mc-btn mc-small" onClick={() => onChange(sanitizeCndl(CNDL_DEFAULT))}>Reset to defaults</button>
  </>);
}

// ---------------------------------------------------------------- draggable window
const POS_KEY = 'mc.float.';
function loadPos(id: string): { x: number; y: number } | null {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY + id) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; }
}
/**
 * A window you can drag around by its title bar and close. `children` is the body.
 * Position is kept inside the browser window and remembered (localStorage) per id.
 */
export function Floating({ id, title, children, onClose, initial, width, className, bare }: {
  id: string; title?: React.ReactNode; children: React.ReactNode; onClose?: () => void;
  initial?: { x: number; y: number }; width?: number; className?: string; bare?: boolean;
}) {
  const [pos, setPos] = useState(() => loadPos(id) ?? initial ?? { x: 120, y: 120 });
  const ref = useRef<HTMLDivElement>(null);
  const clamp = (p: { x: number; y: number }) => {
    const el = ref.current, w = el?.offsetWidth ?? 200, h = el?.offsetHeight ?? 40;
    // keep the whole panel on screen when it fits (phones: a position saved on a wide screen would push it off the edge)
    const W = window.innerWidth, H = window.innerHeight;
    const keepW = w <= W ? w : Math.min(w, 80), keepH = h <= H ? Math.min(h, H) : Math.min(h, 32);
    return { x: Math.max(0, Math.min(W - keepW, p.x)), y: Math.max(0, Math.min(H - keepH, p.y)) };
  };
  useEffect(() => {
    setPos(p => clamp(p));
    const onResize = () => setPos(p => clamp(p)); // phone turned / window resized
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Pointer events: one path for mouse, finger and pen (touch drags never fired mouse events)
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const grip = e.currentTarget as HTMLElement, pid = e.pointerId;
    try { grip.setPointerCapture(pid); } catch { /* ignore */ }
    const sx = e.clientX, sy = e.clientY, start = pos;
    let last = start;
    const mv = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      last = clamp({ x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy }); setPos(last);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      try { grip.releasePointerCapture(pid); } catch { /* ignore */ }
      try { localStorage.setItem(POS_KEY + id, JSON.stringify(last)); } catch { /* ignore */ }
    };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  };
  return (
    <div ref={ref} className={`mc-float${bare ? ' bare' : ''}${className ? ` ${className}` : ''}`} style={{ left: pos.x, top: pos.y, width }}
      onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      {bare ? (
        <div className="mc-float-grip" onPointerDown={startDrag} title="Drag to move">⋮⋮</div>
      ) : (
        <div className="mc-float-head" onPointerDown={startDrag}>
          <span className="mc-float-title">{title}</span>
          {onClose && <button className="mc-btn mc-small" onClick={onClose} title="Close"><X size={14} /></button>}
        </div>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- colour picker
const SWATCHES = [
  '#ffffff', '#d1d4dc', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#000000',
  '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7',
  '#9c27b0', '#e91e63', '#f7525f', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#5b9cf6',
];
function parseRgba(c: string): { hex: string; a: number } {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/i.exec(c);
  if (m) return { hex: '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''), a: m[4] === undefined ? 1 : +m[4] };
  const h = c.replace('#', '');
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { hex: '#' + full, a };
}
const toRgba = (hex: string, a: number) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 100) / 100})`;
};
export function ColorPick({ value, onChange, title }: { value: string; onChange: (c: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const { hex, a } = parseRgba(value);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close, true);
    return () => window.removeEventListener('mousedown', close, true);
  }, [open]);
  return (
    <span className="mc-color" ref={box}>
      <button type="button" className="mc-color-btn" title={title ?? value} onClick={() => setOpen(!open)}>
        <span style={{ background: value }} />
      </button>
      {open && (
        <span className="mc-color-pop">
          <span className="mc-color-grid">
            {SWATCHES.map(c => <button type="button" key={c} style={{ background: c }} className={c.toLowerCase() === hex.toLowerCase() ? 'on' : ''} onClick={() => onChange(toRgba(c, a))} />)}
          </span>
          <label className="mc-color-row">Custom <input type="color" value={hex.length === 7 ? hex : '#000000'} onChange={e => onChange(toRgba(e.target.value, a))} /></label>
          <label className="mc-color-row">Opacity <input type="range" min={0} max={100} value={Math.round(a * 100)} onChange={e => onChange(toRgba(hex, Number(e.target.value) / 100))} /><span>{Math.round(a * 100)}%</span></label>
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- indicator settings
export function IndicatorDialog({ k, cfg, look, onChange, onClose }: {
  k: IndKey; cfg: IndCfg; look: 'tv' | 'journal'; onChange: (c: IndCfg) => void; onClose: () => void;
}) {
  const def = INDS[k];
  const [text, setText] = useState(cfg.params.join(', '));
  const bad = def.max > 0 && text.trim() !== '' && parseParams(k, text) === null && !(def.min === 0 && text.trim() === '');
  const commit = () => {
    if (def.max === 0) return;
    if (def.min === 0 && text.trim() === '') { onChange({ ...cfg, params: [] }); return; }
    const p = parseParams(k, text);
    if (p) onChange({ ...cfg, params: p });
  };
  const names = lineNames(k, cfg.params);
  const cols = LINE_COLORS[k] ?? [];
  const lineAt = (i: number) => ({ color: cfg.lines?.[i]?.color ?? cols[i % Math.max(1, cols.length)] ?? '#2962ff', size: cfg.lines?.[i]?.size ?? 1 });
  const setLine = (i: number, patch: Partial<{ color: string; size: number }>) => {
    const lines = names.map((_, j) => (j === i ? { ...lineAt(j), ...patch } : lineAt(j)));
    onChange({ ...cfg, lines });
  };
  const nq: NqStyle = { ...NQ_STYLE_TV, ...(cfg.nq ?? {}) };
  const setNq = (patch: Partial<NqStyle>) => onChange({ ...cfg, nq: { ...nq, ...patch } });
  const NQ_LINES: [keyof NqStyle, string][] = [['ema', 'EMA 21'], ['vwap', 'VWAP'], ['va', 'VAH / VAL'], ['ib', 'IB high / low'], ['pdh', 'Prev. day high'], ['pdl', 'Prev. day low']];
  const bars = cfg.bars ?? VOL_BARS_TV;
  return (
    <Floating id="ind-dialog" title={<>{def.label} <span className="mc-dim">settings</span></>} onClose={onClose} initial={{ x: 320, y: 140 }} width={340}>
      <div className="mc-dlg-body" style={k === 'CPAT' || k === 'CNDL' ? { maxHeight: '70vh', overflowY: 'auto' } : undefined}>
        <label className="mc-check"><input type="checkbox" checked={!cfg.hidden} onChange={e => onChange({ ...cfg, hidden: !e.target.checked })} /> Visible on the chart</label>
        {def.max > 0 && (
          <label className="mc-field mc-wide">Inputs <span className="mc-dim">{def.hint}</span>
            <input className={`mc-input${bad ? ' bad' : ''}`} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
          </label>
        )}
        {names.length > 0 && <div className="mc-dlg-h">Style</div>}
        {names.map((n, i) => (
          <div key={n + i} className="mc-dlg-row">
            <span>{n}</span>
            <ColorPick value={lineAt(i).color} onChange={c => setLine(i, { color: c })} />
            <select className="mc-input mc-w" value={lineAt(i).size} onChange={e => setLine(i, { size: Number(e.target.value) })}>
              {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}
            </select>
          </div>
        ))}
        {k === 'VOL' && (<>
          <div className="mc-dlg-h">Volume bars</div>
          <div className="mc-dlg-row"><span>Up (close ≥ previous)</span><ColorPick value={bars.up} onChange={c => onChange({ ...cfg, bars: { ...bars, up: c } })} /></div>
          <div className="mc-dlg-row"><span>Down</span><ColorPick value={bars.down} onChange={c => onChange({ ...cfg, bars: { ...bars, down: c } })} /></div>
          <div className="mc-hint">{look === 'tv' ? 'Default: your TradingView colours (white 65% / black 75%).' : ''}</div>
        </>)}
        {k === 'NQSYS' && (<>
          <div className="mc-dlg-h">Lines</div>
          {NQ_LINES.map(([key, label]) => {
            const ln = nq[key] as NqLine;
            return (
              <div key={key} className="mc-dlg-row">
                <label className="mc-check"><input type="checkbox" checked={ln.show} onChange={e => setNq({ [key]: { ...ln, show: e.target.checked } } as Partial<NqStyle>)} /> {label}</label>
                <ColorPick value={ln.color} onChange={c => setNq({ [key]: { ...ln, color: c } } as Partial<NqStyle>)} />
                <select className="mc-input mc-w" value={ln.width} onChange={e => setNq({ [key]: { ...ln, width: Number(e.target.value) } } as Partial<NqStyle>)}>
                  {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}
                </select>
              </div>
            );
          })}
          <div className="mc-dlg-h">Show</div>
          {([['signals', 'Signals (S1 / S2 / S3 / ORB)'], ['plan', 'Stop + T1/T2 of the latest signal'], ['card', 'Scorecard'], ['note', '"Run on 5-min chart" note']] as const).map(([key, label]) => (
            <label key={key} className="mc-check"><input type="checkbox" checked={nq[key]} onChange={e => setNq({ [key]: e.target.checked } as Partial<NqStyle>)} /> {label}</label>
          ))}
          <button className="mc-btn mc-small" onClick={() => onChange({ ...cfg, nq: { ...NQ_STYLE_TV } })}>Reset to your TradingView colours</button>
        </>)}
        {k === 'CPAT' && <ChartPatternSettings opts={sanitizeCpat(cfg.opts)} onChange={o => onChange({ ...cfg, opts: o })} />}
        {k === 'CNDL' && <CandlePatternSettings opts={sanitizeCndl(cfg.opts)} onChange={o => onChange({ ...cfg, opts: o })} />}
        {def.max === 0 && k !== 'NQSYS' && k !== 'VOL' && k !== 'CPAT' && k !== 'CNDL' && <div className="mc-hint">{def.hint}</div>}
      </div>
    </Floating>
  );
}

// ---------------------------------------------------------------- chart settings
type Tab = 'symbol' | 'status' | 'scales' | 'canvas';
export function ChartSettingsDialog({ cfg, onChange, onClose }: { cfg: ChartCfg; onChange: (c: ChartCfg) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('symbol');
  const set = (patch: Partial<ChartCfg>) => onChange({ ...cfg, ...patch });
  const chk = (key: keyof ChartCfg, label: string) => (
    <label className="mc-check"><input type="checkbox" checked={cfg[key] as boolean} onChange={e => set({ [key]: e.target.checked } as Partial<ChartCfg>)} /> {label}</label>
  );
  const col = (key: keyof ChartCfg) => <ColorPick value={cfg[key] as string} onChange={c => set({ [key]: c } as Partial<ChartCfg>)} />;
  return (
    <Floating id="chart-settings" title="Chart settings" onClose={onClose} initial={{ x: 380, y: 110 }} width={420}>
      <div className="mc-dlg-tabs">
        {([['symbol', 'Symbol'], ['status', 'Status line'], ['scales', 'Scales'], ['canvas', 'Canvas']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      <div className="mc-dlg-body">
        {tab === 'symbol' && (<>
          <div className="mc-dlg-h">Chart type</div>
          <div className="mc-dlg-row">
            <select className="mc-input" value={cfg.ctype} onChange={e => set({ ctype: e.target.value as ChartType })}>
              {CHART_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
            </select>
          </div>
          <div className="mc-dlg-h">Candles</div>
          <div className="mc-dlg-row">{chk('body', 'Body')}{col('upBody')}{col('downBody')}</div>
          <div className="mc-dlg-row">{chk('borders', 'Borders')}{col('upBorder')}{col('downBorder')}</div>
          <div className="mc-dlg-row">{chk('wicks', 'Wick')}{col('upWick')}{col('downWick')}</div>
          {chk('prevClose', 'Colour bars based on previous close')}
        </>)}
        {tab === 'status' && (<>
          <div className="mc-dlg-h">Symbol</div>
          {chk('legendOHLC', 'Open, high, low, close')}
          {chk('legendChange', 'Bar change')}
          {chk('legendVolume', 'Volume')}
          <div className="mc-dlg-h">Indicators</div>
          {chk('indTitles', 'Titles')}
          {chk('indArgs', 'Inputs (arguments)')}
          {chk('indValues', 'Values')}
        </>)}
        {tab === 'scales' && (<>
          {chk('priceLine', 'Last price line and label')}
          {chk('countdown', 'Countdown to bar close (under the price)')}
          <div className="mc-dlg-row"><span>Text</span>{col('textColor')}
            <select className="mc-input mc-w" value={cfg.fontSize} onChange={e => set({ fontSize: Number(e.target.value) })}>
              {[10, 11, 12, 13, 14].map(f => <option key={f} value={f}>{f}px</option>)}
            </select>
          </div>
          <div className="mc-dlg-row"><span>Scale lines</span>{col('axisColor')}</div>
        </>)}
        {tab === 'canvas' && (<>
          <div className="mc-dlg-row"><span>Background</span>{col('bg')}</div>
          <div className="mc-dlg-row">{chk('grid', 'Grid lines')}{col('gridColor')}</div>
          <div className="mc-dlg-row"><span>Crosshair</span>{col('crossColor')}
            <select className="mc-input mc-w" value={cfg.crossWidth} onChange={e => set({ crossWidth: Number(e.target.value) })}>
              {[1, 2, 3].map(w => <option key={w} value={w}>{w}px</option>)}
            </select>
            <select className="mc-input mc-w" value={cfg.crossStyle} onChange={e => set({ crossStyle: e.target.value as ChartCfg['crossStyle'] })}>
              <option value="solid">Solid</option><option value="dashed">Dashed</option>
            </select>
          </div>
          <div className="mc-dlg-row">{chk('breaks', 'Session breaks')}{col('breaksColor')}
            <select className="mc-input mc-w" value={cfg.breaksWidth ?? 1} onChange={e => set({ breaksWidth: Number(e.target.value) })} aria-label="Session break width">
              {[1, 2, 3].map(w => <option key={w} value={w}>{w}px</option>)}
            </select>
            <select className="mc-input mc-w" value={cfg.breaksStyle ?? 'dashed'} onChange={e => set({ breaksStyle: e.target.value as ChartCfg['breaksStyle'] })} aria-label="Session break style">
              <option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="solid">Solid</option>
            </select>
          </div>
        </>)}
        <div className="mc-row mc-row-end">
          <button className="mc-btn mc-small" onClick={() => onChange({ ...CHART_TV })} title="Your TradingView chart settings">Your TradingView</button>
          <button className="mc-btn mc-small" onClick={() => onChange({ ...CHART_STD })} title="TradingView's standard dark chart">Standard dark</button>
        </div>
      </div>
    </Floating>
  );
}
