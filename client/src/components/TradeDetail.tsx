import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/TradeDetail.css';

interface Trade {
  id: number;
  account_id: number;
  symbol: string;
  entry_time: string;
  exit_time?: string;
  entry_price: number;
  exit_price?: number;
  quantity: number;
  pnl?: number;
  setup_tag?: string;
  notes?: string;
  tags?: string[];
  stop_loss?: number;
  target?: number;
  rating?: number;
  grade?: string;
  screenshot?: string;
  has_screenshot?: boolean;
  session?: string;
  test_type?: string;
  timeframe?: string;
  tf_align?: number;
  planned_rr?: string;
}

// Journal dimensions (replaces the Notion template's columns)
export const SESSIONS = ['Asia', 'London', 'NY AM', 'NY PM'];
export const TEST_TYPES = ['Retracement', 'Continuation', 'Reversal', 'Breakout', 'Range'];
export const TIMEFRAMES = ['1m', '2m', '5m', '15m', '1h'];
export const RRS = ['1:1', '1:2', '1:3', '1:5'];

interface TradeDetailProps {
  trade: Trade;
  onClose: () => void;
  onSaved?: () => void;
}

export default function TradeDetail({ trade, onClose, onSaved }: TradeDetailProps) {
  const [setupTag, setSetupTag] = useState(trade.setup_tag || '');
  const [notes, setNotes] = useState(trade.notes || '');
  const [tags, setTags] = useState((trade.tags || []).join(', '));
  const [stopLoss, setStopLoss] = useState(trade.stop_loss != null ? String(trade.stop_loss) : '');
  const [target, setTarget] = useState(trade.target != null ? String(trade.target) : '');
  const [rating, setRating] = useState(trade.rating || 0);
  const [grade, setGrade] = useState(trade.grade || '');
  const [session, setSession] = useState(trade.session || '');
  const [testType, setTestType] = useState(trade.test_type || '');
  const [timeframe, setTimeframe] = useState(trade.timeframe || '');
  const [tfAlign, setTfAlign] = useState(trade.tf_align != null ? String(trade.tf_align) : '');
  const [plannedRr, setPlannedRr] = useState(trade.planned_rr || '');
  // Chips toggle: clicking the active one clears it (saved as '' → NULL)
  const pick = (cur: string, v: string, set: (s: string) => void) => set(cur === v ? '' : v);
  const TFS = ['1m', '5m', '15m'] as const;
  const EMO: [string, string, boolean][] = [
    ['revenge', 'Revenge', true], ['fomo', 'FOMO', true], ['chased', 'Chased', true],
    ['panic', 'Panic exit', true], ['tilt', 'Tilt', true], ['bored', 'Boredom', true],
    ['greedy', 'Greedy', true], ['hesitated', 'Hesitated', true], ['no-plan', 'No plan', true],
    ['moved-stop', 'Moved stop', true], ['disciplined', 'Disciplined', false],
    ['patient', 'Patient', false], ['planned', 'Planned', false],
  ];
  const normTag = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');
  const tagList = () => tags.split(',').map(t => t.trim()).filter(Boolean);
  const hasEmo = (k: string) => tagList().some(t => normTag(t) === k);
  const toggleEmo = (k: string) => {
    const list = tagList();
    const idx = list.findIndex(t => normTag(t) === k);
    if (idx >= 0) list.splice(idx, 1); else list.push(k);
    setTags(list.join(', '));
  };
  const [shots, setShots] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState('');

  // Screenshots aren't in the list payload — fetch lazily when the modal opens
  useEffect(() => {
    if (trade.has_screenshot) {
      axios.get(`/api/trades/${trade.id}`).then(r => {
        const d = r.data.data;
        const s = d?.screenshots || (d?.screenshot ? { '5m': d.screenshot } : {});
        setShots(s || {});
      }).catch(() => {});
    }
  }, [trade.id]);

  const handleImage = (tf: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setImgError(`${tf} image too large (max 4MB).`); return; }
    setImgError('');
    const reader = new FileReader();
    reader.onload = () => setShots(prev => ({ ...prev, [tf]: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };
  const removeShot = (tf: string) => setShots(prev => { const n = { ...prev }; delete n[tf]; return n; });

  // Live R-multiple preview
  const stop = parseFloat(stopLoss);
  const risk = !isNaN(stop) ? Math.abs(Number(trade.entry_price) - stop) * Number(trade.quantity) : 0;
  const rMultiple = risk > 0 && trade.pnl != null ? Number(trade.pnl) / risk : null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`/api/trades/${trade.id}`, {
        setup_tag: setupTag,
        notes,
        tags,
        stop_loss: stopLoss ? parseFloat(stopLoss) : null,
        target: target ? parseFloat(target) : null,
        rating: rating || null,
        grade: grade || null,
        screenshots: shots,
        session, test_type: testType, timeframe, tf_align: tfAlign, planned_rr: plannedRr,
      });
      if (onSaved) onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving trade:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="trade-detail-overlay" onClick={onClose}>
      <div className="trade-detail" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>×</button>

        <h2>{trade.symbol}</h2>

        <div className="trade-info">
          <div className="info-group">
            <label>Entry Time</label>
            <p>{new Date(trade.entry_time).toLocaleString()}</p>
          </div>

          <div className="info-group">
            <label>Exit Time</label>
            <p>{trade.exit_time ? new Date(trade.exit_time).toLocaleString() : 'Open'}</p>
          </div>

          <div className="info-group">
            <label>Entry Price</label>
            <p>${trade.entry_price.toFixed(2)}</p>
          </div>

          <div className="info-group">
            <label>Exit Price</label>
            <p>{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}</p>
          </div>

          <div className="info-group">
            <label>Quantity</label>
            <p>{trade.quantity}</p>
          </div>

          <div className="info-group">
            <label>P&L</label>
            <p className={trade.pnl && trade.pnl > 0 ? 'positive' : 'negative'}>
              ${trade.pnl != null ? Number(trade.pnl).toFixed(2) : '0.00'}
              {rMultiple !== null && (
                <span className={`r-badge ${rMultiple >= 0 ? 'positive' : 'negative'}`}>
                  {rMultiple >= 0 ? '+' : ''}{rMultiple.toFixed(2)}R
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="editable-fields">
          <div className="form-group">
            <label>Setup</label>
            <div className="chip-row">
              {['S1', 'S2', 'S3', 'ORB'].map(s => (
                <button key={s} type="button"
                  className={`chip ${setupTag === s ? 'on' : ''}`}
                  onClick={() => setSetupTag(setupTag === s ? '' : s)}>{s}</button>
              ))}
              <input type="text" value={setupTag} onChange={e => setSetupTag(e.target.value)}
                placeholder="or custom…" style={{ flex: 1, minWidth: 100 }} />
            </div>
          </div>

          <div className="td-row">
            <div className="form-group">
              <label>Grade <span className="hint">(A/B/C from checklist)</span></label>
              <div className="chip-row">
                {['A', 'B', 'C'].map(g => (
                  <button key={g} type="button"
                    className={`chip grade-${g} ${grade === g ? 'on' : ''}`}
                    onClick={() => setGrade(grade === g ? '' : g)}>{g}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Rating</label>
              <div className="star-row">
                {[1, 2, 3, 4, 5].map(n => (
                  <span key={n} className={`star ${n <= rating ? 'on' : ''}`} onClick={() => setRating(n === rating ? 0 : n)}>★</span>
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Session</label>
            <div className="chip-row">
              {SESSIONS.map(s => (
                <button key={s} type="button" className={`chip ${session === s ? 'on' : ''}`}
                  onClick={() => pick(session, s, setSession)}>{s}</button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Testing type</label>
            <div className="chip-row">
              {TEST_TYPES.map(t => (
                <button key={t} type="button" className={`chip ${testType === t ? 'on' : ''}`}
                  onClick={() => pick(testType, t, setTestType)}>{t}</button>
              ))}
            </div>
          </div>

          <div className="td-row">
            <div className="form-group">
              <label>Timeframe</label>
              <div className="chip-row">
                {TIMEFRAMES.map(t => (
                  <button key={t} type="button" className={`chip ${timeframe === t ? 'on' : ''}`}
                    onClick={() => pick(timeframe, t, setTimeframe)}>{t}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>TF Align <span className="hint">(timeframes agreeing)</span></label>
              <div className="chip-row">
                {['1', '2', '3', '4', '5'].map(n => (
                  <button key={n} type="button" className={`chip ${tfAlign === n ? 'on' : ''}`}
                    onClick={() => pick(tfAlign, n, setTfAlign)}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Planned R:R</label>
            <div className="chip-row">
              {RRS.map(r => (
                <button key={r} type="button" className={`chip ${plannedRr === r ? 'on' : ''}`}
                  onClick={() => pick(plannedRr, r, setPlannedRr)}>{r}</button>
              ))}
              <input type="text" value={plannedRr} onChange={e => setPlannedRr(e.target.value)}
                placeholder="or custom…" style={{ flex: 1, minWidth: 90 }} />
            </div>
          </div>

          <div className="td-row">
            <div className="form-group">
              <label>Stop Loss <span className="hint">(enables R)</span></label>
              <input type="number" step="0.01" value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="e.g., 19450" />
            </div>
            <div className="form-group">
              <label>Target</label>
              <input type="number" step="0.01" value={target} onChange={e => setTarget(e.target.value)} placeholder="e.g., 19600" />
            </div>
          </div>

          <div className="form-group">
            <label>How did you feel? <span className="hint">(one tap — feeds the Emotions page)</span></label>
            <div className="emo-chips">
              {EMO.map(([k, label, neg]) => (
                <button key={k} type="button"
                  className={`emo-chip ${neg ? 'neg' : 'pos'} ${hasEmo(k) ? 'on' : ''}`}
                  onClick={() => toggleEmo(k)}>{label}</button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Tags <span className="hint">(comma-separated)</span></label>
            <input type="text" value={tags} onChange={e => setTags(e.target.value)}
              placeholder="e.g., A+, news, revenge, fomo, disciplined" />
          </div>

          <div className="form-group">
            <label>Chart Screenshots <span className="hint">(one per timeframe, image ≤4MB each)</span></label>
            <div className="tf-shots">
              {TFS.map(tf => (
                <div key={tf} className="tf-slot">
                  <div className="tf-label">{tf}</div>
                  {shots[tf] ? (
                    <div className="tf-imgwrap">
                      <img src={shots[tf]} alt={`${tf} chart`} className="tf-img" onClick={() => setLightbox(shots[tf])} />
                      <button type="button" className="tf-remove" onClick={() => removeShot(tf)}>✕</button>
                    </div>
                  ) : (
                    <label className="tf-upload">
                      + Add {tf}
                      <input type="file" accept="image/*" hidden onChange={e => handleImage(tf, e)} />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {imgError && <div style={{ color: '#f5a623', fontSize: 12, marginTop: 6 }}>{imgError}</div>}
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="What was the plan? What did you learn?" rows={4} />
          </div>
        </div>

        <div className="actions">
          <button onClick={handleSave} disabled={saving} className="save-btn">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="cancel-btn">Cancel</button>
        </div>
      </div>

      {lightbox && (
        <div className="td-lightbox" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="chart full size" />
          <button className="td-lightbox-close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>×</button>
        </div>
      )}
    </div>
  );
}
