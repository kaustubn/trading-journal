import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Day notes beside the market chart: the same notes as the Pre-Market page
// (one per date), following the trading day at the right edge of the chart.

const DAY_TYPES = ['Trend', 'Expansion', 'Range', 'Reversal', 'Unsure'];
const BIASES = ['Long', 'Short', 'Neutral'];

interface Note {
  day_type: string; bias: string; key_levels: string; plan: string; review: string;
  followed_plan: boolean | null; setups: string | null;
}
const EMPTY: Note = { day_type: '', bias: '', key_levels: '', plan: '', review: '', followed_plan: null, setups: null };

const shiftDate = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

export default function DayNotes({ token, chartDate, onClose }: { token: string; chartDate: string | null; onClose: () => void }) {
  const [pinned, setPinned] = useState<string | null>(null); // a date picked here instead of the chart's
  const date = pinned ?? chartDate;
  const [note, setNote] = useState<Note>(EMPTY);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(false);
  const noteRef = useRef<Note>(EMPTY);
  const dateRef = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const save = async (d: string, n: Note) => {
    dirty.current = false;
    setStatus('saving');
    try {
      await axios.put(`/api/notes/${d}`, {
        day_type: n.day_type || null, bias: n.bias || null, key_levels: n.key_levels || null,
        setups: n.setups, plan: n.plan || null, review: n.review || null, followed_plan: n.followed_plan,
      }, auth);
      if (dateRef.current === d) setStatus('saved');
    } catch {
      if (dateRef.current === d) { dirty.current = true; setStatus('error'); }
    }
  };
  const flush = () => {
    window.clearTimeout(timer.current);
    if (dirty.current && dateRef.current) save(dateRef.current, noteRef.current);
  };

  // Load the note when the date changes (saving the previous day's edits first)
  useEffect(() => {
    if (!date) return;
    flush();
    dateRef.current = date;
    let dead = false;
    setStatus('loading');
    axios.get(`/api/notes/${date}`, auth).then(r => {
      if (dead) return;
      const n = r.data?.data;
      const loaded: Note = n ? {
        day_type: n.day_type || '', bias: n.bias || '', key_levels: n.key_levels || '', plan: n.plan || '',
        review: n.review || '', followed_plan: n.followed_plan ?? null, setups: n.setups ?? null,
      } : EMPTY;
      noteRef.current = loaded;
      setNote(loaded);
      setStatus('idle');
    }).catch(() => { if (!dead) setStatus('error'); });
    return () => { dead = true; };
  }, [date]);

  useEffect(() => () => flush(), []); // save on close

  const edit = (patch: Partial<Note>) => {
    const next = { ...noteRef.current, ...patch };
    noteRef.current = next;
    setNote(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    const d = dateRef.current;
    if (d) timer.current = window.setTimeout(() => save(d, noteRef.current), 900);
  };

  const chip = (on: boolean, label: string, click: () => void) =>
    <button key={label} className={`mc-chip${on ? ' on' : ''}`} onClick={click}>{label}</button>;

  return (
    <aside className="mc-notes" aria-label="Day notes">
      <div className="mc-notes-head">
        <button className="mc-btn mc-small" disabled={!date} onClick={() => date && setPinned(shiftDate(date, -1))} title="Previous day">‹</button>
        <div className="mc-notes-date">{date ? <>{weekday(date)} {date}</> : '—'}</div>
        <button className="mc-btn mc-small" disabled={!date} onClick={() => date && setPinned(shiftDate(date, 1))} title="Next day">›</button>
        <span className="mc-grow" />
        <button className="mc-btn mc-small" onClick={onClose} title="Close notes">✕</button>
      </div>
      <div className="mc-notes-sub">
        {pinned
          ? <button className="mc-link" onClick={() => setPinned(null)}>Follow the chart's day</button>
          : <span className="mc-dim">Follows the trading day on the chart</span>}
        <span className="mc-grow" />
        <span className={`mc-dim${status === 'error' ? ' mc-bad' : ''}`}>
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : status === 'error' ? 'Not saved' : status === 'loading' ? 'Loading…' : ''}
        </span>
      </div>
      {!date ? <div className="mc-hint">Waiting for the chart…</div> : (
        <div className="mc-notes-body">
          <div className="mc-notes-label">Bias</div>
          <div className="mc-chips">{BIASES.map(b => chip(note.bias === b, b, () => edit({ bias: note.bias === b ? '' : b })))}</div>
          <div className="mc-notes-label">Day type</div>
          <div className="mc-chips">{DAY_TYPES.map(t => chip(note.day_type === t, t, () => edit({ day_type: note.day_type === t ? '' : t })))}</div>
          <label className="mc-notes-label" htmlFor="mc-n-levels">Key levels</label>
          <textarea id="mc-n-levels" className="mc-textarea" rows={3} value={note.key_levels}
            placeholder="PDH 18,377 · ONL 18,107 · …" onChange={e => edit({ key_levels: e.target.value })} onBlur={flush} />
          <label className="mc-notes-label" htmlFor="mc-n-plan">Pre-market plan</label>
          <textarea id="mc-n-plan" className="mc-textarea" rows={5} value={note.plan}
            placeholder="What would make you take a trade today?" onChange={e => edit({ plan: e.target.value })} onBlur={flush} />
          <label className="mc-notes-label" htmlFor="mc-n-review">Review</label>
          <textarea id="mc-n-review" className="mc-textarea" rows={5} value={note.review}
            placeholder="What happened, what you did, what to repeat or fix" onChange={e => edit({ review: e.target.value })} onBlur={flush} />
          <div className="mc-notes-label">Followed the plan?</div>
          <div className="mc-chips">
            {chip(note.followed_plan === true, 'Yes', () => edit({ followed_plan: note.followed_plan === true ? null : true }))}
            {chip(note.followed_plan === false, 'No', () => edit({ followed_plan: note.followed_plan === false ? null : false }))}
          </div>
          <div className="mc-hint mc-notes-foot">Same notes as the Pre-Market page.</div>
        </div>
      )}
    </aside>
  );
}
