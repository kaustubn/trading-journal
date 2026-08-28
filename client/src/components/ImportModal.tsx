import React, { useState } from 'react';
import axios from 'axios';
import { money } from '../utils/format';
import '../styles/AddAccountModal.css';

// Promise wrapper so we can await the read (and catch failures) instead of
// relying on state being set by the time Import is clicked.
const readFile = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read that file'));
  r.readAsText(f);
});

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  token: string;
  accountId?: number;
  accountName?: string;
}

export default function ImportModal({ isOpen, onClose, onImported, token, accountId, accountName }: ImportModalProps) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const rowCount = csv.trim() ? csv.trim().split(/\r?\n/).length : 0;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setFileName(f.name); setError(''); setCsv(''); setReading(true);
    try {
      const text = await readFile(f);
      setCsv(text);
      if (!text.trim()) {
        setError(`"${f.name}" is empty — there's nothing in it to import. In TradingView export **Order history** (not Orders), and make sure the date range covers your trades.`);
      }
    } catch {
      setError(`Could not read "${f.name}". Try re-downloading it, or open it and paste the text below.`);
    } finally {
      setReading(false);
    }
  };

  const handleImport = async () => {
    if (!accountId) { setError('Select an account first'); return; }
    // Read on demand if the file is picked but its text hasn't landed yet
    let text = csv;
    if (!text.trim() && file) {
      try { text = await readFile(file); setCsv(text); } catch { /* handled below */ }
    }
    if (!text.trim()) {
      setError(file
        ? `"${file.name}" appears to be empty — nothing to import. In TradingView use **Order history** (not Orders), or paste the CSV text below.`
        : 'Choose a CSV file or paste CSV text');
      return;
    }
    setError(''); setLoading(true); setResult(null);
    try {
      const res = await axios.post('/api/import/csv',
        { account_id: accountId, csv: text },
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(res.data);
      if (res.data.inserted > 0) onImported();
    } catch (err: any) {
      const d = err.response?.data;
      let msg = d?.error || err.message || 'Import failed';
      if (d?.headers) msg += ` (found columns: ${d.headers.join(', ')})`;
      if (err.response?.status === 413) msg = 'File too large for the server — tell your dev to raise the limit.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setCsv(''); setFileName(''); setFile(null); setResult(null); setError(''); };

  const handleClear = async () => {
    if (!accountId) return;
    if (!window.confirm(`Delete ALL trades in "${accountName || 'this account'}"? This cannot be undone.`)) return;
    setLoading(true); setError('');
    try {
      const res = await axios.delete(`/api/accounts/${accountId}/trades`, { headers: { Authorization: `Bearer ${token}` } });
      setResult({ inserted: 0, skipped: 0, cleared: res.data.deleted });
      onImported();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to clear trades');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Import Trades from CSV</h2>
        <p style={{ color: '#9aa0ac', fontSize: 13, marginBottom: 16 }}>
          Export your trade history from Fyers, Tradovate, Lucid, or any broker and drop the CSV here.
          Columns are auto-detected (symbol, side, qty, entry/exit price, times, P&L).
          {accountName && <> Importing into <strong style={{ color: '#c7d2fe' }}>{accountName}</strong>.</>}
        </p>

        {error && <div className="error-message">{error}</div>}

        {!result && (
          <>
            <div className="form-group">
              <label>CSV File</label>
              <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} />
              {reading && <div style={{ color: '#9aa0ac', fontSize: 12, marginTop: 6 }}>Reading {fileName}…</div>}
              {!reading && fileName && rowCount > 0 && (
                <div style={{ color: '#22c55e', fontSize: 12, marginTop: 6 }}>
                  ✓ {fileName} — {rowCount} line{rowCount === 1 ? '' : 's'} ready
                </div>
              )}
              {!reading && fileName && rowCount === 0 && (
                <div style={{ color: '#f5a623', fontSize: 12, marginTop: 6 }}>⚠ {fileName} is empty</div>
              )}
            </div>

            <div className="form-group">
              <label>…or paste CSV</label>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder="symbol,side,quantity,entry_price,exit_price,entry_time,pnl&#10;NQ,LONG,2,19500,19560,2026-07-02 14:30,120"
                rows={6}
              />
            </div>

            <div className="form-actions">
              <button type="button" onClick={onClose} className="cancel-btn">Cancel</button>
              <button type="button" onClick={handleImport} disabled={loading || reading || rowCount === 0} className="submit-btn">
                {loading ? 'Importing…' : reading ? 'Reading file…' : rowCount > 0 ? `Import ${rowCount} lines` : 'Import'}
              </button>
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #2a2e3a', textAlign: 'center' }}>
              <button type="button" onClick={handleClear} disabled={loading}
                style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 }}>
                ⚠ Clear all trades in this account (wipe & re-import)
              </button>
            </div>
          </>
        )}

        {result && (
          <div>
            <div style={{
              background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)',
              borderRadius: 8, padding: 16, color: '#e6e8ec',
            }}>
              {result.cleared !== undefined ? (
                <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>🧹 Cleared {result.cleared} trades</div>
              ) : (
                <>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>✓ {result.inserted} trades imported</div>
                  <div style={{ color: '#9aa0ac', fontSize: 13, marginTop: 6 }}>
                    {result.mode === 'orderbook-aggregated'
                      ? `Built from ${result.executedFills} executed fills · ${result.ignoredRows} rejected/cancelled ignored · total P&L ${money(result.totalPnl, 2)}`
                      : `${result.skipped} skipped (duplicates/blank) · ${result.totalRows} rows read`}
                  </div>
                  {result.errors?.length > 0 && (
                    <div style={{ color: '#f5a623', fontSize: 12, marginTop: 8 }}>
                      {result.errors.length} row error(s): {result.errors[0]}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="form-actions">
              <button type="button" onClick={reset} className="cancel-btn">Import Another</button>
              <button type="button" onClick={onClose} className="submit-btn">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
