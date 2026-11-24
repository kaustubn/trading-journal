// Drag a floating bar by its grip, remember where it was left, and tell a click on the grip from a drag
// (a click folds the bar, a drag moves it, a double-click puts it back in place).
import { useRef, useState } from 'react';

export interface FloatPos { x: number; y: number }
const read = (key: string): FloatPos => {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v; } catch { /* ignore */ }
  return { x: 0, y: 0 };
};

export function useFloat(key: string, onClick?: () => void) {
  const [pos, setPos] = useState<FloatPos>(() => read(key));
  const boxRef = useRef<HTMLDivElement>(null);
  const save = (p: FloatPos) => { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* ignore */ } };
  /** pointerdown on the grip */
  const startDrag = (ev: React.PointerEvent) => {
    const box = boxRef.current, parent = box?.offsetParent as HTMLElement | null;
    if (!box || !parent) return;
    ev.preventDefault(); ev.stopPropagation();
    const r = box.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    const baseL = r.left - pos.x, baseT = r.top - pos.y;
    const lim = { x0: pr.left - baseL, x1: pr.right - (baseL + r.width), y0: pr.top - baseT, y1: pr.bottom - (baseT + r.height) };
    const sx = ev.clientX, sy = ev.clientY, ox = pos.x, oy = pos.y;
    let last = pos, moved = false;
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      moved = true;
      last = { x: Math.min(lim.x1, Math.max(lim.x0, ox + m.clientX - sx)), y: Math.min(lim.y1, Math.max(lim.y0, oy + m.clientY - sy)) };
      setPos(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (moved) save(last); else onClick?.();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const reset = () => { setPos({ x: 0, y: 0 }); try { localStorage.removeItem(key); } catch { /* ignore */ } };
  return { pos, boxRef, startDrag, reset, moved: pos.x !== 0 || pos.y !== 0 };
}
