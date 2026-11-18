// Drawings on the market chart.
//   DrawingStore      — the user's drawing list (one per symbol), shared by every chart
//                       window: undo/redo history, saving, change notifications.
//   DrawingController — one per chart window: keeps that chart's overlays in sync with
//                       the store, handles placing / dragging / selecting drawings and
//                       the measure tool. React reads state from here and re-renders on `onChange`.
import type { Chart, Overlay, OverlayCreate, Point } from 'klinecharts';
import { Drawing, Tool, TOOLS, OVERLAY_TO_TOOL, DPoint, TICK, barTime, newId, positionPoints, FREEHAND } from './drawings';
import { TEMPLATES, tplPatch } from './templates';

const toTick = (v: number) => Math.round(v / TICK) * TICK;
const snapPoint = (p: Partial<Point>): Partial<Point> => (typeof p.value === 'number' ? { ...p, value: toTick(p.value) } : p);

export type Magnet = 'off' | 'weak' | 'strong';
export interface DrawView {
  tf: number; rth: boolean; magnet: Magnet; hidden: boolean; lockAll: boolean;
  tpl?: Partial<Record<Tool, string>>;   // template each tool's new drawings start from
}

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
  // path / brush / highlighter: placed by the chart window's mouse handlers through manual*()
  private manual: { tool: Tool; draft: Drawing; pts: DPoint[]; stroking: boolean } | null = null;
  /** Stay in drawing mode: after a drawing is placed the same tool starts again (TradingView's lock). */
  stayDrawing = false;
  /** Number of points placed so far on a path that is being drawn (for the hint). */
  get pathPoints(): number { return this.manual && this.manual.tool === 'path' ? Math.max(0, this.manual.pts.length - 1) : 0; }
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
      ...this.tplStyle(tool),
    };
    if (def.manual) {
      this.manual = { tool, draft, pts: [], stroking: false };
      this.active = tool;
      this.selected = null;
      this.onChange();
      return;
    }
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

  /** Style of the tool's chosen template (if any), as a Drawing patch. */
  private tplStyle(tool: Tool): Partial<Drawing> {
    const t = TEMPLATES[tool]?.find(x => x.name === this.view.tpl?.[tool]);
    return t ? tplPatch(t.style) : {};
  }

  // ---------- path (clicks) and brush / highlighter (drag) ----------
  get manualTool(): Tool | null { return this.manual?.tool ?? null; }
  private toDP(p: Partial<Point>, tick: boolean): DPoint | null {
    if (typeof p.value !== 'number') return null;
    let t = p.timestamp;
    if (typeof t !== 'number' && typeof p.dataIndex === 'number') {
      const data = this.chart.getDataList();
      if (!data.length) return null;
      const last = data.length - 1;
      t = p.dataIndex <= last ? data[Math.max(0, p.dataIndex)].timestamp : data[last].timestamp + (p.dataIndex - last) * this.barMs();
    }
    if (typeof t !== 'number') return null;
    return { t, p: tick ? toTick(p.value) : p.value };
  }
  private drawManual() {
    const m = this.manual;
    if (!m || !m.pts.length) return;
    const free = FREEHAND.includes(m.tool);
    const { tf, rth } = this.view;
    const pts = free ? [m.pts[0], m.pts[m.pts.length - 1]] : m.pts;
    const points = pts.map(p => ({ timestamp: free ? p.t : barTime(p.t, tf, rth), value: p.p }));
    const extendData = { ...m.draft, points: m.pts, anchor: m.pts[0] } as Drawing;
    if (this.chart.getOverlays({ id: m.draft.id }).length) {
      this.chart.overrideOverlay({ id: m.draft.id, points, extendData } as unknown as Partial<OverlayCreate>);
    } else {
      this.create({ id: m.draft.id, name: TOOLS[m.tool].overlay, groupId: 'draft', paneId: PANE, lock: true, points, extendData });
    }
  }
  /** Mouse down on the chart while a manual tool is active. */
  manualDown(p: Partial<Point>) {
    const m = this.manual;
    if (!m) return;
    const free = FREEHAND.includes(m.tool);
    const dp = this.toDP(p, !free);
    if (!dp) return;
    if (free) { m.pts = [dp]; m.stroking = true; }
    else if (!m.pts.length) m.pts = [dp, { ...dp }];      // second point follows the mouse
    else { m.pts[m.pts.length - 1] = dp; m.pts.push({ ...dp }); }
    this.drawManual();
    if (m.tool === 'path') this.onChange();
  }
  manualMove(p: Partial<Point>) {
    const m = this.manual;
    if (!m || !m.pts.length) return;
    const free = FREEHAND.includes(m.tool);
    if (free && !m.stroking) return;
    const dp = this.toDP(p, !free);
    if (!dp) return;
    if (free) {
      const last = m.pts[m.pts.length - 1];
      if (last.t === dp.t && last.p === dp.p) return;
      if (m.pts.length >= 2000) return;
      m.pts.push(dp);
    } else m.pts[m.pts.length - 1] = dp;
    this.drawManual();
  }
  /** Mouse up: a brush stroke ends here. */
  manualUp() {
    const m = this.manual;
    if (m && FREEHAND.includes(m.tool) && m.stroking) this.manualFinish();
  }
  /** Double-click / Enter: a path ends here (the point following the mouse is dropped). */
  manualFinish() {
    const m = this.manual;
    if (!m) return;
    let pts = m.pts;
    if (!FREEHAND.includes(m.tool)) {
      pts = pts.slice(0, -1).filter((p, i, a) => i === 0 || p.t !== a[i - 1].t || p.p !== a[i - 1].p);
    }
    this.chart.removeOverlay({ id: m.draft.id });
    this.manual = null;
    this.active = null;
    if (pts.length < 2) { this.onChange(); return; }
    const d: Drawing = { ...m.draft, points: pts };
    this.selected = this.stayDrawing ? null : d.id;
    this.store.commit([...this.store.drawings, d]);
    if (this.stayDrawing) this.start(m.tool);
  }

  /**
   * Right-click / Esc on the chart, like TradingView: a path with at least two points is
   * finished; anything else being placed is dropped and the tool switches back to the cursor.
   */
  release() {
    const m = this.manual;
    if (m && m.tool === 'path' && m.pts.length >= 3) { const keep = this.stayDrawing; this.stayDrawing = false; this.manualFinish(); this.stayDrawing = keep; return; }
    this.cancel();
  }

  /** Abandon a drawing that is still being placed. */
  cancel() {
    if (this.manual) {
      this.chart.removeOverlay({ id: this.manual.draft.id });
      this.manual = null;
      this.active = null;
      this.onChange();
      return;
    }
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
      const tpl = TEMPLATES[draft.tool]?.find(x => x.name === this.view.tpl?.[draft.tool])?.style;
      if (tpl?.stopPts && tpl?.targetPts) {
        const dir = draft.tool === 'long' ? 1 : -1, e = points[0];
        points = [e, { t: e.t, p: e.p + dir * tpl.targetPts }, { t: e.t, p: e.p - dir * tpl.stopPts }, points[3]];
      }
    }
    const d: Drawing = { ...draft, id: o.id, points };
    this.selected = this.stayDrawing ? null : d.id;
    this.justCreated = d.id;
    this.store.commit([...this.store.drawings, d]);
    if (this.stayDrawing && d.tool !== 'text') window.setTimeout(() => { if (!this.active) this.start(d.tool); }, 0);
  }

  /** A drawing was dragged: read its new points back, keeping full precision for untouched points. */
  private moved(o: Overlay<Drawing>) {
    const cur = this.store.drawings.find(d => d.id === o.id);
    if (!cur) return;
    const { tf, rth } = this.view;
    if (FREEHAND.includes(cur.tool)) {
      // the whole stroke moves by how far its first point moved
      const p0 = o.points[0];
      const a = (o.extendData as Drawing & { anchor?: DPoint })?.anchor ?? cur.points[0];
      if (typeof p0?.timestamp !== 'number' || typeof p0.value !== 'number') return;
      const dt = p0.timestamp - a.t, dp = p0.value - a.p;
      if (!dt && !dp) return;
      this.store.commit(this.store.drawings.map(d => (d.id === o.id ? { ...d, points: d.points.map(p => ({ t: p.t + dt, p: p.p + dp })) } : d)));
      return;
    }
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
    if (FREEHAND.includes(d.tool)) {
      // brush / highlighter: the overlay holds the first and last point (snapped to bars);
      // the stroke itself is drawn from the drawing's raw points
      const ends = [d.points[0], d.points[d.points.length - 1]];
      const points = ends.map(p => ({ timestamp: barTime(p.t, tf, rth), value: p.p }));
      return {
        id: d.id, name: TOOLS[d.tool].overlay, groupId: GROUP, paneId: PANE, points,
        extendData: { ...d, anchor: { t: points[0].timestamp, p: points[0].value } } as Drawing,
        lock: !!d.locked || lockAll, visible: !hidden && !d.hidden, mode: 'normal',
      };
    }
    return {
      id: d.id, name: TOOLS[d.tool].overlay, groupId: GROUP, paneId: PANE,
      points: d.points.map(p => ({ timestamp: barTime(p.t, tf, rth), value: p.p })),
      extendData: d, lock: !!d.locked || lockAll, visible: !hidden && !d.hidden, mode: MODE[magnet],
    };
  }

  // what each overlay on this chart was last built from (drawing object + view), so a sync
  // only touches drawings that changed — with hundreds of drawings this keeps tools fast
  private built = new Map<string, { d: Drawing; view: string }>();
  private viewKey() { const v = this.view; return `${v.tf}|${v.rth}|${v.magnet}|${v.hidden}|${v.lockAll}`; }

  /** Make this chart's overlays match the shared drawing list. */
  sync() {
    const onChart = new Set(
      this.chart.getOverlays({ groupId: GROUP })
        .filter(o => o.id !== this.draftId && OVERLAY_TO_TOOL[o.name])
        .map(o => o.id));
    const vk = this.viewKey();
    for (const d of this.store.drawings) {
      if (onChart.has(d.id)) {
        onChart.delete(d.id);
        const b = this.built.get(d.id);
        if (b && b.d === d && b.view === vk) continue;          // unchanged: leave it alone
        this.chart.overrideOverlay(this.toOverlay(d) as unknown as Partial<OverlayCreate>);
      } else {
        this.create({ ...this.toOverlay(d), ...this.events() });
      }
      this.built.set(d.id, { d, view: vk });
    }
    onChart.forEach(id => { this.chart.removeOverlay({ id }); this.built.delete(id); });
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
