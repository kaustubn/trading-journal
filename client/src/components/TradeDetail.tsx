import React, { useState, useEffect } from 'react';
import { canOpenOnChart, openOnChart } from '../utils/chartLink';
import axios from 'axios';
import OptionPicker from './OptionPicker';
import { CandlestickChart, X, CheckCircle2, Circle, Star, ImagePlus } from 'lucide-react';
import { num, signedMoney } from '../utils/format';
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
  const [symbol, setSymbol] = useState(trade.symbol || '');
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
        symbol,
      });
      if (onSaved) onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving trade:', error);
    } finally {
      setSaving(false);
    }
  };

  // Escape closes the popup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lightbox) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, onClose]);

  // Review completeness — the four things the coach learns from
  const checks = [
    { ok: !!setupTag, label: 'Setup tagged', tip: 'Pick the setup so the Setups page can tell which ones make money.' },
    { ok: !!grade, label: 'Graded A/B/C', tip: 'Grade it against your Entry Checklist: A and B are trades, C is "should not have taken it".' },
    { ok: EMO.some(([k]) => hasEmo(k)), label: 'Feeling logged', tip: 'Tap how you felt — it feeds the Emotions page.' },
    { ok: !!stopLoss, label: 'Stop saved', tip: 'Add the stop price to see this trade in R (risk units).' },
  ];
  const done = checks.filter(c => c.ok).length;
  const nextTip = checks.find(c => !c.ok)?.tip;
  const pnl = trade.pnl != null ? Number(trade.pnl) : 0;
  const fmtTime = (s?: string) => s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Open';

  return (
    <div className="trade-detail-overlay" onClick={onClose}>
      <div className="trade-detail" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Review ${trade.symbol} trade`}>
        <div className="td-head">
          <div className="td-head-main">
            <div className="td-sym">{trade.symbol} <span className="td-qty">× {trade.quantity}</span></div>
            <div className={`td-pnl ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`}>
              {trade.pnl != null ? signedMoney(pnl, 2) : '—'}
              {rMultiple !== null && (
                <span className={`r-badge ${rMultiple >= 0 ? 'positive' : 'negative'}`} title="Result in R: P&L ÷ money risked to the stop">
                  {rMultiple >= 0 ? '+' : ''}{rMultiple.toFixed(2)}R
                </span>
              )}
            </div>
          </div>
          <div className="td-head-actions">
            {canOpenOnChart(trade.symbol) && (
              <button className="td-chart-btn" onClick={() => { onClose(); openOnChart(trade.id); }}><CandlestickChart className="ic-sm" /> Open on chart</button>
            )}
            <button className="close-btn" onClick={onClose} aria-label="Close"><X className="ic-lg" /></button>
          </div>
        </div>

        <div className="trade-info">
          <div className="info-group"><label>Entry</label><p>{num(trade.entry_price).toFixed(2)}<span className="td-when">{fmtTime(trade.entry_time)}</span></p></div>
          <div className="info-group"><label>Exit</label><p>{trade.exit_price ? num(trade.exit_price).toFixed(2) : '—'}<span className="td-when">{fmtTime(trade.exit_time)}</span></p></div>
        </div>

        <div className="td-review">
          <div className="td-review-top">
            <span className="td-review-title">Review {done}/4</span>
            <div className="td-review-bar"><div style={{ width: `${done * 25}%` }} /></div>
          </div>
          <div className="td-checks">
            {checks.map(c => (
              <span key={c.label} className={`td-check ${c.ok ? 'ok' : ''}`}>
                {c.ok ? <CheckCircle2 className="ic-sm" /> : <Circle className="ic-sm" />} {c.label}
              </span>
            ))}
          </div>
          {nextTip && <div className="td-next">Next: {nextTip}</div>}
        </div>

        <div className="editable-fields">
          <div className="td-sec">1 · What did you trade?</div>
          <OptionPicker field="pair" label="Pair" value={symbol} onChange={setSymbol}
            hint="(instrument on this trade)" allowCustomText />

          <OptionPicker field="setup" label="Setup" value={setupTag} onChange={setSetupTag} allowCustomText />

          <OptionPicker field="session" label="Session" value={session} onChange={setSession} />

          <OptionPicker field="test_type" label="Entry type" value={testType} onChange={setTestType} />

          <div className="td-row">
            <OptionPicker field="timeframe" label="Entry timeframe" value={timeframe} onChange={setTimeframe} />
            <div className="form-group">
              <label>Timeframes agreeing <span className="hint">(how many TFs pointed the same way)</span></label>
              <div className="chip-row">
                {['1', '2', '3', '4', '5'].map(n => (
                  <button key={n} type="button" className={`chip ${tfAlign === n ? 'on' : ''}`}
                    onClick={() => pick(tfAlign, n, setTfAlign)}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="td-sec">2 · Was it a good trade?</div>
          <div className="td-row">
            <div className="form-group">
              <label>Grade <span className="hint">(from your Entry Checklist)</span></label>
              <div className="chip-row">
                {['A', 'B', 'C'].map(g => (
                  <button key={g} type="button"
                    className={`chip grade-${g} ${grade === g ? 'on' : ''}`}
                    onClick={() => setGrade(grade === g ? '' : g)}>{g}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Execution rating <span className="hint">(how well you executed)</span></label>
              <div className="star-row">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" className={`star ${n <= rating ? 'on' : ''}`} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    onClick={() => setRating(n === rating ? 0 : n)}><Star className="ic-lg" /></button>
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Planned reward : risk</label>
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
              <label>Stop loss <span className="hint">(price — enables R)</span></label>
              <input type="number" step="0.01" value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="e.g., 19450" />
            </div>
            <div className="form-group">
              <label>Target <span className="hint">(price)</span></label>
              <input type="number" step="0.01" value={target} onChange={e => setTarget(e.target.value)} placeholder="e.g., 19600" />
            </div>
          </div>

          <div className="td-sec">3 · How did you feel?</div>
          <div className="form-group">
            <label>Feelings <span className="hint">(one tap each — feeds the Emotions page)</span></label>
            <div className="emo-chips">
              {EMO.map(([k, label, neg]) => (
                <button key={k} type="button"
                  className={`emo-chip ${neg ? 'neg' : 'pos'} ${hasEmo(k) ? 'on' : ''}`}
                  onClick={() => toggleEmo(k)}>{label}</button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Tags <span className="hint">(comma-separated — e.g. "rule break", news, A+)</span></label>
            <input type="text" value={tags} onChange={e => setTags(e.target.value)}
              placeholder="e.g., rule break, news, A+" />
          </div>

          <div className="td-sec">4 · Evidence and lesson</div>
          <div className="form-group">
            <label>Chart screenshots <span className="hint">(one per timeframe, image up to 4MB each)</span></label>
            <div className="tf-shots">
              {TFS.map(tf => (
                <div key={tf} className="tf-slot">
                  <div className="tf-label">{tf}</div>
                  {shots[tf] ? (
                    <div className="tf-imgwrap">
                      <img src={shots[tf]} alt={`${tf} chart`} className="tf-img" onClick={() => setLightbox(shots[tf])} />
                      <button type="button" className="tf-remove" onClick={() => removeShot(tf)} aria-label={`Remove ${tf} screenshot`}><X className="ic-sm" /></button>
                    </div>
                  ) : (
                    <label className="tf-upload">
                      <ImagePlus className="ic-sm" /> Add {tf}
                      <input type="file" accept="image/*" hidden onChange={e => handleImage(tf, e)} />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {imgError && <div style={{ color: 'var(--warning)', fontSize: 12, marginTop: 6 }}>{imgError}</div>}
          </div>

          <div className="form-group">
            <label>Notes and lesson</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="What was the plan? What happened? What will you do the same or differently next time?" rows={4} />
          </div>
        </div>

        <div className="actions">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="save-btn">
            {saving ? 'Saving…' : 'Save review'}
          </button>
        </div>
      </div>

      {lightbox && (
        <div className="td-lightbox" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="chart full size" />
          <button className="td-lightbox-close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }} aria-label="Close"><X className="ic-lg" /></button>
        </div>
      )}
    </div>
  );
}
