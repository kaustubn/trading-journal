import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Target, Flame } from 'lucide-react';
import axios from 'axios';
import type { KLineData } from 'klinecharts';
import type { Workspace } from './ChartPane';
import type { Course, Rule, Strategy } from '../chart/mentorTypes';
import { BUILTIN_COURSES } from '../chart/courses';
import { MentorFeed, FeedMsg, Signal, Step, findSetups, explainBar, DETECTORS } from '../chart/mentor';
import { analyze, phaseAt } from '../chart/patterns';
import { BarsResp, toK, tfLabel } from '../chart/config';
import { barTime, fmtPrice } from '../chart/drawings';
import { Clock, fmtWall, wallToUtc } from '../chart/time';

// ---------------------------------------------------------------- progress (saved per user)
export interface Progress {
  xp: number; streak: number; bestStreak: number; answered: number; correct: number; sprintBest: number;
  byStrategy: Record<string, { seen: number; correct: number }>;
  quizDone: Record<string, boolean>;
}
const EMPTY: Progress = { xp: 0, streak: 0, bestStreak: 0, answered: 0, correct: 0, sprintBest: 0, byStrategy: {}, quizDone: {} };
const levelOf = (xp: number) => Math.floor(Math.sqrt(xp / 50)) + 1;
const xpFor = (lvl: number) => 50 * (lvl - 1) * (lvl - 1);

interface Props {
  ws: Workspace;
  activeIdx: number;
  clock: Clock;
  setPaneTf: (i: number, tf: number) => void;
  startReplay: (t: number) => Promise<void>;
  onPhases: (on: boolean) => void;   // show the smart-money phases layer
  phasesOn: boolean;
  onClose: () => void;
}
type Tab = 'learn' | 'practice' | 'sprint' | 'progress';
type Quiz = { signal: Signal; strategy: Strategy; answer?: 'long' | 'short' | 'wait'; correct?: boolean };
type Sprint = {
  round: number; total: number; score: number; stage: 'loading' | 'ask' | 'reveal' | 'done';
  deadline: number; before: number; atr: number; hint: string; choice?: 'up' | 'down' | 'side' | null; outcome?: 'up' | 'down' | 'side'; move?: number; gained?: number;
};

const SECTIONS: [keyof Strategy, string][] = [
  ['when', 'When'], ['entry', 'Entry'], ['trigger', 'Trigger'], ['stop', 'Stop'], ['targets', 'Targets'],
  ['manage', 'Manage'], ['scaleIn', 'Scale in'], ['scaleOut', 'Scale out'], ['avoid', 'Avoid'], ['psychology', 'Psychology'],
];
const srcText = (r: Rule) => {
  const s = r.src;
  if (!s) return '';
  return [s.book, s.chapter, s.page && `p.${s.page}`, s.video, s.time].filter(Boolean).join(' · ');
};
function RuleList({ rules }: { rules: Rule[] }) {
  return (
    <ul className="mt-rules">
      {rules.map((r, i) => (
        <li key={i}>{r.text}
          {(r.conf || r.src) && <span className="mt-src" title={srcText(r)}>{r.conf ?? ''}{r.src ? ` · ${srcText(r)}` : ''}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function MentorPanel({ ws, activeIdx, clock, setPaneTf, startReplay, onPhases, phasesOn, onClose }: Props) {
  const auth = () => ws.auth();
  const engine = ws.engine;
  const [tab, setTab] = useState<Tab>('learn');
  const [list, setList] = useState<{ id: string; title: string; mentor: string; kind: string }[]>([]);
  const [loaded, setLoaded] = useState<Record<string, Course>>({});
  const [courseId, setCourseId] = useState(() => { try { return localStorage.getItem('mc.mentor.course') || BUILTIN_COURSES[0].id; } catch { return BUILTIN_COURSES[0].id; } });
  const [stratId, setStratId] = useState<string>('');
  const [feed, setFeed] = useState<FeedMsg[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pauseAtSetups, setPauseAtSetups] = useState(true);
  const [prog, setProg] = useState<Progress>(EMPTY);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [openCh, setOpenCh] = useState<string | null>(null);
  const [bookQuiz, setBookQuiz] = useState<Record<number, number>>({});
  const [, tickNow] = useState(0);
  const feedRef = useRef<MentorFeed | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const progSave = useRef<number | undefined>(undefined);

  // ----- courses: built-in + the ones made from books / videos -----
  useEffect(() => {
    axios.get('/api/mentor/courses', auth()).then(r => setList(r.data.courses || [])).catch(() => setList([]));
    axios.get('/api/mentor/progress', auth()).then(r => setProg({ ...EMPTY, ...(r.data.progress || {}) })).catch(() => {});
  }, []);
  const allCourses = useMemo(() => [
    ...BUILTIN_COURSES.map(c => ({ id: c.id, title: c.title, mentor: c.mentor, kind: c.kind })),
    ...list.filter(c => !BUILTIN_COURSES.some(b => b.id === c.id)),
  ], [list]);
  const course: Course | null = BUILTIN_COURSES.find(c => c.id === courseId) ?? loaded[courseId] ?? null;
  useEffect(() => {
    try { localStorage.setItem('mc.mentor.course', courseId); } catch { /* ignore */ }
    if (course || BUILTIN_COURSES.some(c => c.id === courseId)) return;
    axios.get(`/api/mentor/courses/${encodeURIComponent(courseId)}`, auth())
      .then(r => setLoaded(cur => ({ ...cur, [courseId]: r.data.course })))
      .catch(() => setStatus('Could not load that course.'));
  }, [courseId]);
  const strategy = course?.strategies.find(s => s.id === stratId) ?? course?.strategies[0] ?? null;
  useEffect(() => { if (course && !course.strategies.some(s => s.id === stratId)) setStratId(course.strategies[0]?.id ?? ''); }, [course?.id]);

  // ----- progress -----
  const saveProg = (p: Progress) => {
    setProg(p);
    window.clearTimeout(progSave.current);
    progSave.current = window.setTimeout(() => { axios.put('/api/mentor/progress', { progress: p }, auth()).catch(() => {}); }, 800);
  };
  const award = (xp: number, correct: boolean | null, strategyKey?: string) => {
    const p: Progress = JSON.parse(JSON.stringify(prog));
    p.xp += xp;
    if (correct !== null) {
      p.answered++; if (correct) p.correct++;
      p.streak = correct ? p.streak + 1 : 0; p.bestStreak = Math.max(p.bestStreak, p.streak);
      if (strategyKey) { const b = p.byStrategy[strategyKey] ?? { seen: 0, correct: 0 }; b.seen++; if (correct) b.correct++; p.byStrategy[strategyKey] = b; }
    }
    saveProg(p);
  };

  // ----- the active window's bars -----
  const activePane = () => ws.panes.get(activeIdx) ?? null;
  const paneBars = (): { bars: KLineData[]; tf: number } | null => {
    const p = activePane();
    if (!p) return null;
    return { bars: p.chart.getDataList() as KLineData[], tf: p.tf() };
  };

  // ----- plan lines (mentor's entry / stop / target) on every window -----
  const clearPlan = () => ws.panes.forEach(p => p.chart.removeOverlay({ id: 'mentor_plan' }));
  const drawPlan = (s: Signal, bars: KLineData[]) => {
    clearPlan();
    const t = bars[s.i]?.timestamp;
    if (!t) return;
    const rth = ws.settings().rth;
    ws.panes.forEach(p => {
      const tf = p.tf();
      const t0 = barTime(t, tf, rth), right = t0 + tf * 60000 * 24;
      p.chart.createOverlay({
        id: 'mentor_plan', name: s.side === 'long' ? 'jc_long' : 'jc_short', groupId: 'mentor', paneId: 'candle_pane', lock: true,
        points: [{ timestamp: t0, value: s.entry }, { timestamp: t0, value: s.t1 }, { timestamp: t0, value: s.stop }, { timestamp: right, value: s.entry }],
        extendData: { id: 'mentor_plan', tool: s.side, points: [], color: '#2962ff', width: 1, line: 'solid', qty: 1, contract: 'NQ' },
      } as any);
    });
  };

  // ----- feed: runs whenever replay reveals a bar -----
  const pushMsgs = (msgs: FeedMsg[]) => {
    if (!msgs.length) return;
    setFeed(cur => [...cur.slice(-120), ...msgs]);
  };
  useEffect(() => {
    if (!engine.active) return;
    const pb = paneBars();
    if (!pb) return;
    if (!feedRef.current || feedRef.current.tfMin !== pb.tf || feedRef.current.strategy?.id !== strategy?.id) {
      const keep = feedRef.current?.strategy?.id === strategy?.id ? feedRef.current?.expected ?? null : null;
      feedRef.current = new MentorFeed(strategy, pb.tf);
      feedRef.current.expected = keep;
    }
    const { msgs, signal } = feedRef.current.update(pb.bars);
    setSteps(feedRef.current.steps);
    pushMsgs(msgs);
    if (signal && strategy && pauseAtSetups && !engine.position && !quiz) {
      engine.pause();
      setQuiz({ signal, strategy });
      setTab('practice');
    }
  }, [engine.cursor, engine.active, activeIdx, strategy?.id]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [feed.length, quiz?.answer]);
  useEffect(() => () => clearPlan(), []);

  // ----- practice: find a real setup and replay into it -----
  const randomDay = (): string | null => {
    const m = ws.meta();
    if (!m?.first || !m?.last) return null;
    const DAY = 86400000;
    for (let k = 0; k < 40; k++) {
      const t = m.first + 20 * DAY + Math.random() * (m.last - m.first - 21 * DAY);
      const d = new Date(t).toISOString().slice(0, 10);
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (wd >= 1 && wd <= 5) return d;
    }
    return null;
  };
  const fetchDay = async (day: string, tf: number): Promise<KLineData[]> => {
    const prev = new Date(new Date(`${day}T12:00:00Z`).getTime() - 3 * 86400000).toISOString().slice(0, 10);
    const r = await axios.get<BarsResp>('/api/bars', { ...auth(), params: { symbol: 'NQ', tf, from: wallToUtc(prev, '18:00', 'ET'), to: wallToUtc(day, '16:00', 'ET'), limit: 3000 } });
    return r.data.bars.map(toK);
  };
  const practice = async () => {
    if (!strategy?.detector || !DETECTORS[strategy.detector.key]) { setStatus('This strategy has no detector yet, so it cannot find setups by itself. Use replay and the step list.'); return; }
    const tf = strategy.tf ?? 5;
    setBusy(true); setQuiz(null); setFeed([]); clearPlan();
    setStatus(`Searching past days for a ${strategy.name} setup…`);
    try {
      for (let tries = 0; tries < 25; tries++) {
        const day = randomDay();
        if (!day) break;
        const bars = await fetchDay(day, tf);
        const dayStart = wallToUtc(day, '09:30', 'ET'), dayEnd = wallToUtc(day, '16:00', 'ET');
        const sigs = findSetups(bars, strategy, tf).filter(s => bars[s.i].timestamp >= dayStart && bars[s.i].timestamp < dayEnd && s.i >= 40);
        if (!sigs.length) continue;
        const s = sigs[Math.floor(Math.random() * sigs.length)];
        const startBar = bars[Math.max(30, s.i - 24)];
        if (activePane()?.tf() !== tf) setPaneTf(activeIdx, tf);
        engine.stepMode = 'bar';
        feedRef.current = new MentorFeed(strategy, tf);
        feedRef.current.expected = { ...s, t: bars[s.i].timestamp };
        await startReplay(startBar.timestamp + tf * 60000 - 60000);
        setStatus(`${day} · ${tfLabel(tf)} · a ${strategy.name} setup is coming within ~24 bars. Step forward (→ or ▶) and watch the steps fill in.`);
        setTab('practice');
        return;
      }
      setStatus('No setup found in 25 random days. Try again or pick another strategy.');
    } catch {
      setStatus('Could not load price data.');
    } finally {
      setBusy(false);
    }
  };
  const answer = (a: 'long' | 'short' | 'wait') => {
    if (!quiz || quiz.answer) return;
    const correct = a === quiz.signal.side;
    setQuiz({ ...quiz, answer: a, correct });
    award(correct ? 15 : 2, correct, `${course?.id}/${quiz.strategy.id}`);
    const pb = paneBars();
    if (pb) drawPlan(quiz.signal, pb.bars.slice(0, -1));
  };
  const takeIt = () => {
    if (!quiz) return;
    const s = quiz.signal, risk = Math.abs(s.entry - s.stop);
    const msg = engine.open({ side: s.side, qty: 1, contract: 'NQ', stopPts: Math.max(0.25, Math.round(risk * 4) / 4), target: Math.max(0.25, Math.round(Math.abs(s.t1 - s.entry) * 4) / 4), targetUnit: 'pts', setup: quiz.strategy.name, notes: `Mentor drill · ${course?.title ?? ''}` });
    if (msg) setStatus(msg); else { setQuiz(null); setStatus('In the trade with the mentor plan. Manage it like the card says, then step on.'); }
  };
  const explain = () => {
    const pb = paneBars();
    if (!pb || pb.bars.length < 30) return;
    const bars = engine.active ? pb.bars.slice(0, -1) : pb.bars;
    const a = analyze(bars, pb.tf);
    const i = bars.length - 1;
    const lines = explainBar(bars, i, a);
    pushMsgs([{ id: Date.now(), kind: 'info', t: bars[i].timestamp, title: 'This bar', text: lines.join('\n') }]);
    setTab('practice');
  };

  /** After a replay (re)start the windows reload their bars asynchronously: wait until the active one ends at the cursor. */
  const paneSynced = async (): Promise<{ bars: KLineData[]; tf: number } | null> => {
    for (let k = 0; k < 40; k++) {
      const pb = paneBars();
      const last = pb?.bars[pb.bars.length - 1];
      if (pb && last && engine.cursor && last.timestamp <= engine.cursor && last.timestamp + pb.tf * 60000 > engine.cursor) return pb;
      await new Promise(r => setTimeout(r, 150));
    }
    return null;
  };
  // ----- sprint: 10 fast rounds of "what happens next?" -----
  const sprintRef = useRef<Sprint | null>(null);
  sprintRef.current = sprint;
  const nextRound = async (round: number, score: number) => {
    const total = 10;
    if (round > total) {
      setSprint(s => s && { ...s, stage: 'done' });
      const p: Progress = { ...prog, xp: prog.xp + score, sprintBest: Math.max(prog.sprintBest, score) };
      saveProg(p);
      return;
    }
    setSprint({ round, total, score, stage: 'loading', deadline: 0, before: 0, atr: 0, hint: '' });
    for (let k = 0; k < 10; k++) {
      const day = randomDay();
      if (!day) break;
      const mins = 585 + Math.floor(Math.random() * 330);
      const t = wallToUtc(day, `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`, 'ET');
      engine.stepMode = 'bar';
      await startReplay(t);
      if (!engine.active) continue;
      const pb = await paneSynced();
      if (!pb || pb.bars.length < 40) continue;
      const bars = pb.bars.slice(0, -1);
      const a = analyze(bars, pb.tf);
      const i = bars.length - 1;
      const ph = phaseAt(a, i);
      const lastEv = [...a.events].reverse().find(e => e.i <= i && !['INSIDE', 'DOJI'].includes(e.kind));
      const hint = [ph ? `Phase: ${ph.phase}` : '', a.trend[i] !== 'flat' ? `Trend: ${a.trend[i]}` : 'No clear trend', lastEv ? `Last event: ${lastEv.text} (${i - lastEv.i} bars ago)` : ''].filter(Boolean).join(' · ');
      setSprint({ round, total, score, stage: 'ask', deadline: Date.now() + 12000, before: engine.price ?? bars[i].close, atr: a.atr[i] || 1, hint });
      return;
    }
    setSprint({ round, total, score, stage: 'done', deadline: 0, before: 0, atr: 0, hint: 'Could not load data.' });
  };
  const sprintAnswer = async (choice: 'up' | 'down' | 'side' | null) => {
    const s = sprintRef.current;
    if (!s || s.stage !== 'ask') return;
    const left = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
    setSprint({ ...s, stage: 'loading', choice });
    for (let k = 0; k < 12; k++) { await engine.stepForward(); }
    const after = engine.price ?? s.before;
    const move = (after - s.before) / s.atr;
    const outcome = move > 0.6 ? 'up' : move < -0.6 ? 'down' : 'side';
    const gained = choice === outcome ? 10 + left : 0;
    setSprint({ ...s, stage: 'reveal', choice, outcome, move, score: s.score + gained, gained });
    if (choice !== null) award(0, choice === outcome);
  };
  useEffect(() => {
    if (sprint?.stage !== 'ask') return;
    const t = window.setInterval(() => {
      tickNow(n => n + 1);
      if (sprintRef.current && sprintRef.current.stage === 'ask' && Date.now() > sprintRef.current.deadline) sprintAnswer(null);
    }, 250);
    return () => window.clearInterval(t);
  }, [sprint?.stage, sprint?.round]);

  const lvl = levelOf(prog.xp);
  const lvlPct = Math.min(100, ((prog.xp - xpFor(lvl)) / Math.max(1, xpFor(lvl + 1) - xpFor(lvl))) * 100);

  return (
    <div className="mc-coach mt-panel" onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <div className="mc-coach-head">
        <span className="mc-panel-title">Mentor</span>
        <span className="mt-level" title={`${prog.xp} XP · streak ${prog.streak} (best ${prog.bestStreak})`}>Lv {lvl}<span className="mt-bar"><span style={{ width: `${lvlPct}%` }} /></span><Flame size={12} />{prog.streak}</span>
        <button className="mc-btn mc-small" onClick={onClose} title="Hide the mentor">✕</button>
      </div>
      <div className="mt-course">
        <select className="mc-input" value={courseId} onChange={e => setCourseId(e.target.value)} title="Course: built-in or made from a book / video">
          {allCourses.map(c => <option key={c.id} value={c.id}>{c.title} — {c.mentor}{c.kind !== 'builtin' ? ` (${c.kind})` : ''}</option>)}
        </select>
      </div>
      <div className="mc-seg mt-tabs">
        {(['learn', 'practice', 'sprint', 'progress'] as Tab[]).map(t => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'learn' ? 'Learn' : t === 'practice' ? 'Practice' : t === 'sprint' ? 'Sprint' : 'Progress'}</button>
        ))}
      </div>

      {tab === 'learn' && course && (
        <div className="mt-body">
          <div className="mc-hint">{course.description}</div>
          <div className="mt-h">Chapters</div>
          {course.chapters.map(ch => (
            <div key={ch.id} className="mt-card">
              <button className="mt-card-head" onClick={() => setOpenCh(openCh === ch.id ? null : ch.id)}>{ch.title}<span>{openCh === ch.id ? '▾' : '▸'}</span></button>
              {openCh === ch.id && (<>
                <div className="mt-sum">{ch.summary}</div>
                <RuleList rules={ch.points} />
                {ch.psychology?.length ? <><div className="mt-sub">Psychology</div><RuleList rules={ch.psychology} /></> : null}
              </>)}
            </div>
          ))}
          <div className="mt-h">Strategies</div>
          {course.strategies.map(s => (
            <div key={s.id} className={`mt-card${strategy?.id === s.id ? ' on' : ''}`}>
              <button className="mt-card-head" onClick={() => { setStratId(s.id); setOpenCh(openCh === `s:${s.id}` ? null : `s:${s.id}`); }}>
                {s.name}{s.tf ? <span className="mc-dim"> · {tfLabel(s.tf)}</span> : null}<span>{openCh === `s:${s.id}` ? '▾' : '▸'}</span>
              </button>
              {openCh === `s:${s.id}` && (<>
                <div className="mt-sum">{s.summary}</div>
                {SECTIONS.map(([k, label]) => { const rules = s[k] as Rule[]; return rules?.length ? <div key={k}><div className="mt-sub">{label}</div><RuleList rules={rules} /></div> : null; })}
                <div className="mc-row mc-row-end">
                  <button className="mc-btn mc-primary" disabled={busy} onClick={() => { setStratId(s.id); practice(); }}>Practice on a real setup</button>
                </div>
              </>)}
            </div>
          ))}
          {course.quizzes?.length ? <>
            <div className="mt-h">Quiz</div>
            {course.quizzes.map((q, qi) => {
              const picked = bookQuiz[qi];
              return (
                <div key={qi} className="mt-card">
                  <div className="mt-q">{q.q}</div>
                  <div className="mt-opts">
                    {q.options.map((o, oi) => (
                      <button key={oi} className={`mc-btn mc-small${picked === undefined ? '' : oi === q.answer ? ' mt-good' : oi === picked ? ' mt-bad' : ''}`}
                        disabled={picked !== undefined}
                        onClick={() => { setBookQuiz(cur => ({ ...cur, [qi]: oi })); const key = `${course.id}#${qi}`; const first = !prog.quizDone[key]; const ok = oi === q.answer; const p: Progress = JSON.parse(JSON.stringify(prog)); p.quizDone[key] = true; p.xp += first && ok ? 10 : 0; p.answered++; if (ok) p.correct++; p.streak = ok ? p.streak + 1 : 0; p.bestStreak = Math.max(p.bestStreak, p.streak); saveProg(p); }}>{o}</button>
                    ))}
                  </div>
                  {picked !== undefined && <div className="mc-hint">{q.explain}</div>}
                </div>
              );
            })}
          </> : null}
          {course.glossary?.length ? <>
            <div className="mt-h">Glossary</div>
            <ul className="mt-rules">{course.glossary.map(g => <li key={g.term}><b>{g.term}</b>: {g.meaning}</li>)}</ul>
          </> : null}
        </div>
      )}

      {tab === 'practice' && (
        <div className="mt-body mt-practice">
          <div className="mc-row">
            <select className="mc-input mc-grow" value={strategy?.id ?? ''} onChange={e => setStratId(e.target.value)}>
              {course?.strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="mc-btn mc-primary" disabled={busy || !strategy} onClick={practice}>{busy ? 'Searching…' : 'Find a setup'}</button>
          </div>
          <div className="mc-row">
            <label className="mc-check"><input type="checkbox" checked={pauseAtSetups} onChange={e => setPauseAtSetups(e.target.checked)} /> Pause and quiz me at setups</label>
            <label className="mc-check"><input type="checkbox" checked={phasesOn} onChange={e => onPhases(e.target.checked)} /> Show phases</label>
          </div>
          {status && <div className="mc-hint">{status}</div>}
          {steps.length > 0 && (
            <div className="mt-steps">
              {steps.map((s, k) => <div key={k} className={s.done ? 'done' : ''}>{s.done ? '✓' : '○'} {s.label}</div>)}
            </div>
          )}
          <div className="mc-coach-list mt-feed" ref={listRef}>
            {!feed.length && <div className="mc-hint">Start replay (or press “Find a setup”). As each bar closes, the mentor explains what big players are doing and ticks off the strategy steps.</div>}
            {feed.map(m => (
              <div key={m.id} className={`mc-coach-msg mt-msg-${m.kind}`}>
                <div className="mc-coach-meta">{m.title}<span className="mc-dim">{fmtWall(m.t, clock).slice(5)}</span></div>
                <div className="mc-coach-text">{m.text}</div>
              </div>
            ))}
            {quiz && (
              <div className="mc-coach-stop mt-quiz">
                <div className="mc-coach-stop-title"><Target size={15} /> {quiz.strategy.name}: what would {course?.mentor ?? 'the mentor'} do here?</div>
                {!quiz.answer ? (
                  <div className="mc-row">
                    <button className="mc-btn mc-buy" onClick={() => answer('long')}>Long</button>
                    <button className="mc-btn mc-sell" onClick={() => answer('short')}>Short</button>
                    <button className="mc-btn" onClick={() => answer('wait')}>Wait</button>
                  </div>
                ) : (
                  <>
                    <div className={quiz.correct ? 'mt-good-t' : 'mt-bad-t'}>{quiz.correct ? `Correct! +15 XP · streak ${prog.streak}` : `Mentor goes ${quiz.signal.side.toUpperCase()}.`} {quiz.signal.reason}.</div>
                    <div className="mt-plan">
                      Entry {fmtPrice(quiz.signal.entry)} · Stop {fmtPrice(quiz.signal.stop)} · T1 {fmtPrice(quiz.signal.t1)} · T2 {fmtPrice(quiz.signal.t2)}
                      {' '}({(Math.abs(quiz.signal.t1 - quiz.signal.entry) / Math.max(0.25, Math.abs(quiz.signal.entry - quiz.signal.stop))).toFixed(1)}R to T1)
                    </div>
                    {(['stop', 'targets', 'manage', 'scaleOut', 'psychology'] as (keyof Strategy)[]).map(k => {
                      const rules = quiz.strategy[k] as Rule[];
                      return rules?.length ? <div key={k}><div className="mt-sub">{SECTIONS.find(x => x[0] === k)?.[1]}</div><RuleList rules={rules} /></div> : null;
                    })}
                    <div className="mc-row mc-row-end">
                      <button className="mc-btn" onClick={() => { setQuiz(null); clearPlan(); }}>Skip</button>
                      <button className="mc-btn mc-primary" disabled={!engine.active || !!engine.position} onClick={takeIt}>Take it with this plan</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="mc-row mc-row-end">
            <button className="mc-btn mc-small" onClick={explain} title="Explain the last closed bar: candle, structure, phase, events">Explain this bar</button>
            {feed.length > 0 && <button className="mc-btn mc-small" onClick={() => { setFeed([]); clearPlan(); }}>Clear</button>}
          </div>
        </div>
      )}

      {tab === 'sprint' && (
        <div className="mt-body">
          {!sprint || sprint.stage === 'done' ? (
            <div className="mt-sprint-start">
              <div className="mt-h">Pattern Sprint</div>
              <div className="mc-hint">10 random moments from real NQ history. You have 12 seconds: will the next 12 bars go Up, Down or Sideways (less than 0.6 ATR)? Faster right answers score more. Read the structure, the phase and the last event.</div>
              {sprint?.stage === 'done' && <div className="mt-score">Score {sprint.score} · best {Math.max(prog.sprintBest, sprint.score)}</div>}
              <button className="mc-btn mc-primary" onClick={() => { onPhases(true); nextRound(1, 0); }}>{sprint ? 'Play again' : 'Start sprint'}</button>
            </div>
          ) : (
            <div className="mt-sprint">
              <div className="mt-sprint-top">Round {sprint.round}/{sprint.total}<span>Score {sprint.score}</span>
                {sprint.stage === 'ask' && <span className="mt-timer">{Math.max(0, Math.ceil((sprint.deadline - Date.now()) / 1000))}s</span>}</div>
              {sprint.stage === 'loading' && <div className="mc-hint">…</div>}
              {sprint.stage !== 'loading' && <div className="mc-hint">{sprint.hint}</div>}
              {sprint.stage === 'ask' && (
                <div className="mt-sprint-btns">
                  <button className="mc-btn mc-buy" onClick={() => sprintAnswer('up')}>▲ Up</button>
                  <button className="mc-btn" onClick={() => sprintAnswer('side')}>▬ Sideways</button>
                  <button className="mc-btn mc-sell" onClick={() => sprintAnswer('down')}>▼ Down</button>
                </div>
              )}
              {sprint.stage === 'reveal' && (
                <>
                  <div className={sprint.choice === sprint.outcome ? 'mt-good-t' : 'mt-bad-t'}>
                    {sprint.choice === sprint.outcome ? `Right! +${sprint.gained}` : sprint.choice === null ? 'Time up.' : 'Missed.'} It went {sprint.outcome} ({(sprint.move ?? 0) >= 0 ? '+' : ''}{(sprint.move ?? 0).toFixed(1)} ATR).
                  </div>
                  <button className="mc-btn mc-primary" onClick={() => nextRound(sprint.round + 1, sprint.score)}>{sprint.round >= sprint.total ? 'Finish' : 'Next ▶'}</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'progress' && (
        <div className="mt-body">
          <div className="mt-stats">
            <div><b>{lvl}</b><span>Level</span></div>
            <div><b>{prog.xp}</b><span>XP</span></div>
            <div><b>{prog.answered ? Math.round((prog.correct / prog.answered) * 100) : 0}%</b><span>Accuracy</span></div>
            <div><b>{prog.bestStreak}</b><span>Best streak</span></div>
            <div><b>{prog.sprintBest}</b><span>Best sprint</span></div>
          </div>
          <div className="mt-h">By strategy</div>
          {Object.keys(prog.byStrategy).length === 0 && <div className="mc-hint">Answer setup quizzes in Practice to build this.</div>}
          {Object.entries(prog.byStrategy).map(([k, v]) => (
            <div key={k} className="mt-row"><span>{k.split('/').pop()}</span><span>{v.correct}/{v.seen} · {Math.round((v.correct / Math.max(1, v.seen)) * 100)}%</span></div>
          ))}
          <div className="mt-h">Add a mentor</div>
          <div className="mc-hint">Put the book (PDF/text) or a video transcript in <code>trading-system\mentor\books\</code> and tell Claude Code: <code>/mentor-book &lt;file&gt;</code>. It reads it, writes the course (every rule with chapter/page), and it appears in the course list here.</div>
        </div>
      )}
    </div>
  );
}
