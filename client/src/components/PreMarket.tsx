import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/PreMarket.css';

interface PreMarketProps { token: string; }

const DAY_TYPES = ['Trend', 'Expansion', 'Range', 'Reversal', 'Unsure'];
const BIASES = ['Long', 'Short', 'Neutral'];
const SETUPS = ['S1', 'S2', 'S3', 'ORB'];

export default function PreMarket({ token }: PreMarketProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayIso);
  const [dayType, setDayType] = useState('');
  const [bias, setBias] = useState('');
  const [levels, setLevels] = useState('');
  const [setups, setSetups] = useState<string[]>([]);
  const [plan, setPlan] = useState('');
  const [review, setReview] = useState('');
  const [followed, setFollowed] = useState<boolean | null>(null);
  const [screenshot, setScreenshot] = useState('');
  const [imgError, setImgError] = useState('');
  const [recent, setRecent] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setImgError('Image too large (max 4MB).'); return; }
    setImgError('');
    const reader = new FileReader();
    reader.onload = () => setScreenshot(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const H = { headers: { Authorization: `Bearer ${token}` } };

  const loadDay = async (d: string) => {
    setSaved(false);
    try {
      const res = await axios.get(`/api/notes/${d}`, H);
      const n = res.data.data;
      setDayType(n?.day_type || '');
      setBias(n?.bias || '');
      setLevels(n?.key_levels || '');
      setSetups(n?.setups ? n.setups.split(',').filter(Boolean) : []);
      setPlan(n?.plan || '');
      setReview(n?.review || '');
      setFollowed(n?.followed_plan ?? null);
      setScreenshot(n?.screenshot || '');
      setImgError('');
    } catch { /* ignore */ }
  };

  const loadRecent = async () => {
    try { setRecent((await axios.get('/api/notes?limit=14', H)).data.data || []); } catch { setRecent([]); }
  };

  useEffect(() => { loadDay(date); }, [date]);
  useEffect(() => { loadRecent(); }, []);

  const toggleSetup = (s: string) => setSetups(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  const save = async () => {
    await axios.put(`/api/notes/${date}`, {
      day_type: dayType, bias, key_levels: levels,
      setups: setups.join(','), plan, review, followed_plan: followed,
      screenshot: screenshot || null,
    }, H);
    setSaved(true);
    loadRecent();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="premarket">
      <div className="pm-head">
        <div>
          <h2>📝 Pre-Market Plan</h2>
          <p>Set the day-type call, bias & live setups before the session — review after.</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="pm-date" />
      </div>

      <div className="pm-card">
        <div className="pm-field">
          <label>Day type <span className="hint">(decides which setups are live)</span></label>
          <div className="pm-chips">
            {DAY_TYPES.map(t => <button key={t} className={`pm-chip ${dayType === t ? 'on' : ''}`} onClick={() => setDayType(dayType === t ? '' : t)}>{t}</button>)}
          </div>
        </div>

        <div className="pm-field">
          <label>Bias</label>
          <div className="pm-chips">
            {BIASES.map(b => <button key={b} className={`pm-chip ${bias === b ? 'on' : ''}`} onClick={() => setBias(bias === b ? '' : b)}>{b}</button>)}
          </div>
        </div>

        <div className="pm-field">
          <label>Setups live today</label>
          <div className="pm-chips">
            {SETUPS.map(s => <button key={s} className={`pm-chip ${setups.includes(s) ? 'on' : ''}`} onClick={() => toggleSetup(s)}>{s}</button>)}
          </div>
        </div>

        <div className="pm-field">
          <label>Key levels (PDH/PDL, VAH/VAL, POC, swings, round #s)</label>
          <input type="text" value={levels} onChange={e => setLevels(e.target.value)} placeholder="e.g., PDH 21540 · VAL 21380 · POC 21460 · O/N high 21600" />
        </div>

        <div className="pm-field">
          <label>Pre-market plan</label>
          <textarea value={plan} onChange={e => setPlan(e.target.value)} rows={4}
            placeholder="What am I watching for? If price does X at level Y, I take setup Z. What would make me stand down?" />
        </div>

        <div className="pm-field">
          <label>Post-session review</label>
          <textarea value={review} onChange={e => setReview(e.target.value)} rows={4}
            placeholder="What happened? Did I follow the plan? Best/worst decision? One thing to fix tomorrow." />
        </div>

        <div className="pm-field">
          <label>Chart screenshot <span className="hint">(day's key chart / plan — image ≤4MB or paste URL)</span></label>
          {screenshot ? (
            <div className="pm-ss-wrap">
              <img src={screenshot} alt="day screenshot" className="pm-ss-img" onClick={() => window.open(screenshot, '_blank')} />
              <button type="button" className="pm-ss-remove" onClick={() => setScreenshot('')}>✕ Remove</button>
            </div>
          ) : (
            <>
              <input type="file" accept="image/*" onChange={handleImage} />
              <input type="text" value={screenshot} onChange={e => setScreenshot(e.target.value)} placeholder="…or paste image URL" style={{ marginTop: 8 }} />
            </>
          )}
          {imgError && <div style={{ color: '#f5a623', fontSize: 12, marginTop: 6 }}>{imgError}</div>}
        </div>

        <div className="pm-field">
          <label>Did I follow my checklist?</label>
          <div className="pm-chips">
            <button className={`pm-chip ok ${followed === true ? 'on' : ''}`} onClick={() => setFollowed(followed === true ? null : true)}>✓ Yes</button>
            <button className={`pm-chip bad ${followed === false ? 'on' : ''}`} onClick={() => setFollowed(followed === false ? null : false)}>✗ No</button>
          </div>
        </div>

        <div className="pm-actions">
          <button className="btn-primary" onClick={save}>Save Plan</button>
          {saved && <span className="pm-saved">✓ Saved</span>}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="pm-recent">
          <h3>Recent days</h3>
          {recent.map(n => (
            <button key={n.note_date} className="pm-recent-row" onClick={() => setDate(n.note_date)}>
              <span className="pm-r-date">{n.note_date}</span>
              {n.day_type && <span className="pm-r-tag">{n.day_type}</span>}
              {n.bias && <span className="pm-r-tag">{n.bias}</span>}
              {n.has_screenshot && <span className="pm-r-tag">📷</span>}
              {n.followed_plan === true && <span className="pm-r-ok">✓ followed</span>}
              {n.followed_plan === false && <span className="pm-r-bad">✗ broke plan</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
