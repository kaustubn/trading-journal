import { useEffect, useState } from 'react';
import axios from 'axios';
import { Clock, fmtWall } from '../chart/time';

// Price-data panel on the market chart: range stored, Databento update, CSV upload.

interface Meta { first: number | null; last: number | null; count: number; }
interface Status { configured: boolean; lastAttempt: number | null; lastResult: { ok: boolean; message: string; at: string } | null; }

const readFile = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read that file'));
  r.readAsText(f);
});

export default function DataPanel({ token, meta, clock, onChanged, onClose }: {
  token: string; meta: Meta | null; clock: Clock; onChanged: () => void; onClose: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<'' | 'update' | 'upload'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const loadStatus = () => axios.get<Status>('/api/bars/update', auth).then(r => setStatus(r.data)).catch(() => setStatus(null));
  useEffect(() => { loadStatus(); }, []);

  const update = async () => {
    setBusy('update'); setMsg(null);
    try {
      const r = await axios.post('/api/bars/update', {}, auth);
      setMsg({ ok: true, text: r.data.message });
      if (r.data.inserted > 0) onChanged();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.message || e?.response?.data?.error || 'Update failed — check your connection.' });
    } finally {
      setBusy(''); loadStatus();
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('upload'); setMsg(null);
    try {
      const csv = await readFile(file);
      if (!csv.trim()) throw new Error(`"${file.name}" is empty.`);
      const r = await axios.post('/api/bars/upload', { csv }, auth);
      const d = r.data;
      setMsg({ ok: true, text: `${file.name}: ${d.rows.toLocaleString('en-US')} bars read, ${d.inserted.toLocaleString('en-US')} new, ${d.alreadyStored.toLocaleString('en-US')} already stored${d.bad ? `, ${d.bad} unreadable rows skipped` : ''}.` });
      if (d.inserted > 0) onChanged();
    } catch (e: any) {
      const d = e?.response?.data;
      setMsg({ ok: false, text: d?.error ? `${d.error}${d.firstBad?.length ? ` First problem: ${d.firstBad[0]}` : ''}` : e?.message || 'Upload failed.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mc-panel mc-panel-data">
      <div className="mc-row">
        <div className="mc-panel-title mc-grow">Price data</div>
        <button className="mc-btn mc-small" onClick={onClose} title="Close">✕</button>
      </div>
      {meta?.first && meta?.last ? (
        <div className="mc-hint">
          {meta.count.toLocaleString('en-US')} one-minute NQ bars, {fmtWall(meta.first, clock).slice(0, 10)} → {fmtWall(meta.last, clock)} {clock}
        </div>
      ) : <div className="mc-hint">Loading…</div>}

      <div className="mc-data-section">
        <div className="mc-notes-label">Databento</div>
        {status?.configured ? (
          <>
            <div className="mc-hint">Opening the chart fetches new bars automatically (at most every 30 minutes).</div>
            <button className="mc-btn mc-wide-btn" disabled={!!busy} onClick={update}>{busy === 'update' ? 'Updating…' : 'Update now'}</button>
            {status.lastResult && (
              <div className={`mc-hint${status.lastResult.ok ? '' : ' mc-bad'}`}>Last run {new Date(status.lastResult.at).toLocaleString()}: {status.lastResult.message}</div>
            )}
          </>
        ) : (
          <div className="mc-hint">
            Not set up. To get new bars automatically, add <b>DATABENTO_API_KEY</b> in Render → your service → Environment. About 1¢ a day of Databento credit.
          </div>
        )}
      </div>

      <div className="mc-data-section">
        <div className="mc-notes-label">Upload bars CSV</div>
        <div className="mc-hint">Columns ts_utc, open, high, low, close, volume, symbol (UTC, 1-minute) — or a Databento ohlcv-1m CSV. Minutes already stored are skipped.</div>
        <label className={`mc-btn mc-wide-btn${busy ? ' mc-disabled' : ''}`}>
          {busy === 'upload' ? 'Uploading…' : 'Choose CSV file…'}
          <input type="file" accept=".csv,text/csv" hidden disabled={!!busy}
            onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>

      {msg && <div className={`mc-hint${msg.ok ? '' : ' mc-bad'}`}>{msg.text}</div>}
    </div>
  );
}
