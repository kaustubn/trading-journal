import React, { useState } from 'react';
import axios from 'axios';
import '../styles/AddAccountModal.css';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!accountId) { setError('Select an account first'); return; }
    if (!csv.trim()) { setError('Choose a CSV file or paste CSV text'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      const res = await axios.post('/api/import/csv',
        { account_id: accountId, csv },
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

  const reset = () => { setCsv(''); setFileName(''); setResult(null); setError(''); };

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
              <input type="file" accept=".csv,text/csv" onChange={handleFile} />
              {fileName && <div style={{ color: '#22c55e', fontSize: 12, marginTop: 6 }}>✓ {fileName} loaded</div>}
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
              <button type="button" onClick={handleImport} disabled={loading} className="submit-btn">
                {loading ? 'Importing…' : 'Import'}
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
                      ? `Built from ${result.executedFills} executed fills · ${result.ignoredRows} rejected/cancelled ignored · total P&L ₹${result.totalPnl}`
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
