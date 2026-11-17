// Drawings on the market chart.
//   DrawingStore      — the user's drawing list (one per symbol), shared by every chart
//                       window: undo/redo history, saving, change notifications.
//   DrawingController — one per chart window: keeps that chart's overlays in sync with
//                       the store, handles placing / dragging / selecting drawings and
//                       the measure tool. React reads state from here and re-renders on `onChange`.
import type { Chart, Overlay, OverlayCreate, Point } from 'klinecharts';
import { Drawing, Tool, TOOLS, OVERLAY_TO_TOOL, DPoint, TICK, barTime, newId, positionPoints } from './drawings';

const toTick = (v: number) => Math.round(v / TICK) * TICK;
const snapPoint = (p: Partial<Point>): Partial<Point> => (typeof p.value === 'number' ? { ...p, value: toTick(p.value) } : p);

export type Magnet = 'off' | 'weak' | 'strong';
export interface DrawView { tf: number; rth: boolean; magnet: Magnet; hidden: boolean; lockAll: boolean; }

const PANE = 'candle_pane';
const GROUP = 'drawings';
const MEASURE_ID = 'jc_measure_live';
const HISTORY = 100;
const MODE = { off: 'normal', weak: 'weak_magnet', strong: 'strong_magnet' } as const;

export class DrawingStore {
  drawings: Drawing[] = [];
  loaded = false;
  private past: Drawing[][] = [];
  private future: Drawing[][] = [];
  private listeners = new Set<() => void>();

  constructor(private save: (list: Drawing[]) => void) {}

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach(fn => fn()); }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** Replace everything with what the server has. Not an undoable change. */
  load(list: Drawing[]) {
    this.drawings = list;
    this.past = []; this.future = [];
    this.loaded = true;
    this.emit();
  }
  commit(next: Drawing[]) {
    this.past.push(this.drawings);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.apply(next);
  }
  private apply(next: Drawing[]) {
    this.drawings = next;
    this.save(next);
    this.emit();
  }
  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.drawings);
    this.apply(prev);
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.drawings);
    this.apply(next);
  }
  update(id: string, patch: Partial<Drawing>) {
    const cur = this.drawings.find(d => d.id === id);
    if (!cur) return;
    const changed = (Object.keys(patch) as (keyof Drawing)[]).some(k => cur[k] !== patch[k]);
    if (changed) this.commit(this.drawings.map(d => (d.id === id ? { ...d, ...patch } : d)));
  }
  remove(id: string) {
    if (this.drawings.some(d => d.id === id)) this.commit(this.drawings.filter(d => d.id !== id));
  }
  clear() {
    if (this.drawings.length) this.commit([]);
  }
}

export class DrawingController {
  selected: string | null = null;
  active: Tool | null = null;        // tool currently being placed
  justCreated: string | null = null; // newest drawing (the text tool opens its editor)
  measuring = false;
  private draftId: string | null = null;
  private measureFrom: Partial<Point> | null = null;
  private unsubscribe: () => void;

  constructor(
    private chart: Chart,
    private view: DrawView,
    private store: DrawingStore,
    private onChange: () => void,
  ) {
    this.unsubscribe = store.subscribe(() => {
      if (this.selected && !store.drawings.some(d => d.id === this.selected)) this.selected = null;
      this.sync();
      this.onChange();
    });
    if (store.loaded) this.sync();
  }
  dispose() { this.unsubscribe(); }

  private create(spec: OverlayCreate<Drawing>) {
    return this.chart.createOverlay(spec as unknown as OverlayCreate);
  }

  // shared list, as the toolbar and edit bar expect it
  get drawings() { return this.store.drawings; }
  get loaded() { return this.store.loaded; }
  get canUndo() { return this.store.canUndo; }
  get canRedo() { return this.store.canRedo; }
  get selectedDrawing() { return this.store.drawings.find(d => d.id === this.selected) ?? null; }

  setView(v: DrawView) {
    const remap = v.tf !== this.view.tf || v.rth !== this.view.rth;
    const other = v.magnet !== this.view.magnet || v.hidden !== this.view.hidden || v.lockAll !== this.view.lockAll;
    this.view = v;
    if (remap || other) this.sync();
    if (v.hidden && this.selected) { this.selected = null; this.onChange(); }
  }

  // ---------- edits (shared by every window) ----------
  undo() { this.cancel(); this.store.undo(); }
  redo() { this.cancel(); this.store.redo(); }
  update(id: string, patch: Partial<Drawing>) { this.store.update(id, patch); }
  remove(id: string) { this.store.remove(id); }
  clear() { this.store.clear(); }
  select(id: string | null) {
    this.selected = id;
    this.onChange();
  }

  // ---------- placing a new drawing ----------
  start(tool: Tool) {
    if (!this.store.loaded) return;
    this.cancel();
    this.clearMeasure();
    const def = TOOLS[tool];
    const draft: Drawing = {
      id: newId(), tool, points: [], color: def.color, width: def.width, line: 'solid',
      ...(tool === 'text' ? { text: 'Text' } : {}),
      ...(tool === 'long' || tool === 'short' ? { qty: 1, contract: 'NQ' as const } : {}),
    };
    const id = this.create({
      ...this.events(),
      id: draft.id, name: def.overlay, groupId: GROUP, paneId: PANE,
      mode: MODE[this.view.magnet], extendData: draft,
      onDrawEnd: ({ overlay }) => this.finishDraft(overlay as Overlay<Drawing>),
    });
    this.draftId = typeof id === 'string' ? id : null;
    this.active = this.draftId ? tool : null;
    this.selected = null;
    this.onChange();
  }

  /** Abandon a drawing that is still being placed. */
  cancel() {
    if (!this.draftId) return;
    const id = this.draftId;
    this.draftId = null;
    this.active = null;
    this.chart.removeOverlay({ id });
    this.onChange();
  }

  private finishDraft(o: Overlay<Drawing>) {
    const draft = o.extendData;
    this.draftId = null;
    this.active = null;
    let points: DPoint[] = o.points
      .filter(p => typeof p.timestamp === 'number' && typeof p.value === 'number')
      .map(p => ({ t: p.timestamp!, p: toTick(p.value!) }));
    if (!draft || !points.length) { this.chart.removeOverlay({ id: o.id }); this.onChange(); return; }
    if (draft.tool === 'long' || draft.tool === 'short') {
      points = positionPoints(points[0], draft.tool, this.visiblePriceRange(), this.timeAfterBars(points[0].t, 30));
    }
    const d: Drawing = { ...draft, id: o.id, points };
    this.selected = d.id;
    this.justCreated = d.id;
    this.store.commit([...this.store.drawings, d]);
  }

  /** A drawing was dragged: read its new points back, keeping full precision for untouched points. */
  private moved(o: Overlay<Drawing>) {
    const cur = this.store.drawings.find(d => d.id === o.id);
    if (!cur) return;
    const { tf, rth } = this.view;
    const points = o.points.map((p, i): DPoint => {
      const old = cur.points[i];
      const value = typeof p.value === 'number' ? toTick(p.value) : old?.p ?? 0;
      if (old && barTime(old.t, tf, rth) === p.timestamp && old.p === value) return old;
      return { t: p.timestamp ?? old?.t ?? 0, p: value };
    });
    const same = points.length === cur.points.length && points.every((p, i) => p === cur.points[i]);
    if (!same) this.store.commit(this.store.drawings.map(d => (d.id === o.id ? { ...d, points } : d)));
  }

  private events(): Partial<OverlayCreate<Drawing>> {
    return {
      onPressedMoveEnd: ({ overlay }) => this.moved(overlay as Overlay<Drawing>),
      onSelected: ({ overlay }) => { if (overlay.id !== this.draftId) { this.selected = overlay.id; this.onChange(); } },
      onDeselected: ({ overlay }) => { if (this.selected === overlay.id) { this.selected = null; this.onChange(); } },
    };
  }

  // ---------- chart <-> list ----------
  private toOverlay(d: Drawing): OverlayCreate<Drawing> {
    const { tf, rth, magnet, hidden, lockAll } = this.view;
    return {
      id: d.id, name: TOOLS[d.tool].overlay, groupId: GROUP, paneId: PANE,
      points: d.points.map(p => ({ timestamp: barTime(p.t, tf, rth), value: p.p })),
      extendData: d, lock: !!d.locked || lockAll, visible: !hidden, mode: MODE[magnet],
    };
  }

  /** Make this chart's overlays match the shared drawing list. */
  sync() {
    const onChart = new Set(
      this.chart.getOverlays({ groupId: GROUP })
        .filter(o => o.id !== this.draftId && OVERLAY_TO_TOOL[o.name])
        .map(o => o.id));
    for (const d of this.store.drawings) {
      const spec = this.toOverlay(d);
      if (onChart.has(d.id)) {
        this.chart.overrideOverlay(spec as unknown as Partial<OverlayCreate>);
        onChart.delete(d.id);
      } else {
        this.create({ ...spec, ...this.events() });
      }
    }
    onChart.forEach(id => this.chart.removeOverlay({ id }));
  }

  private barMs() { return Math.min(this.view.tf, 1440) * 60000; }
  /** Time of the bar `n` bars after the one at `t` (counting real bars, so weekends are skipped). */
  private timeAfterBars(t: number, n: number): number {
    const data = this.chart.getDataList();
    let lo = 0, hi = data.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (data[m].timestamp < t) lo = m + 1; else hi = m; }
    const i = lo + n;
    if (i < data.length) return data[i].timestamp;
    const last = data.length ? data[data.length - 1].timestamp : t;
    return last + (i - Math.max(0, data.length - 1)) * this.barMs();
  }
  private visiblePriceRange(): number {
    const data = this.chart.getDataList();
    const { from, to } = this.chart.getVisibleRange();
    let hi = -Infinity, lo = Infinity;
    for (let i = Math.max(0, from); i < Math.min(data.length, to); i++) {
      hi = Math.max(hi, data[i].high); lo = Math.min(lo, data[i].low);
    }
    return Number.isFinite(hi - lo) && hi > lo ? hi - lo : 100;
  }

  // ---------- measure (Shift + drag); never saved ----------
  startMeasure(raw: Partial<Point>) {
    const p = snapPoint(raw);
    this.clearMeasure();
    this.measureFrom = p;
    this.measuring = true;
    this.chart.createOverlay({ id: MEASURE_ID, name: 'jc_measure', groupId: 'measure', paneId: PANE, lock: true, points: [p, p] });
    this.onChange();
  }
  moveMeasure(raw: Partial<Point>) {
    const p = snapPoint(raw);
    if (!this.measureFrom) return;
    this.chart.overrideOverlay({ id: MEASURE_ID, points: [this.measureFrom, p] });
  }
  endMeasure() {
    this.measuring = false;
    this.onChange();
  }
  clearMeasure() {
    if (!this.measureFrom) return;
    this.measureFrom = null;
    this.measuring = false;
    this.chart.removeOverlay({ id: MEASURE_ID });
    this.onChange();
  }
  get hasMeasure() { return this.measureFrom !== null; }
}
