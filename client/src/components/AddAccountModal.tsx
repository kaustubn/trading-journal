import React, { useState } from 'react';
import axios from 'axios';
import '../styles/AddAccountModal.css';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountAdded: () => void;
  token: string;
}

export default function AddAccountModal({ isOpen, onClose, onAccountAdded, token }: AddAccountModalProps) {
  const [broker, setBroker] = useState('zerodha');
  const [accountType, setAccountType] = useState('live');
  const [currency, setCurrency] = useState('INR');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await axios.post(
        '/api/accounts',
        {
          broker,
          account_type: accountType,
          currency,
          account_number: accountNumber,
          account_name: accountName || accountNumber,
          api_key: apiKey,
          api_secret: apiSecret,
          access_token: accessToken,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Reset form
      setBroker('zerodha');
      setAccountType('live');
      setCurrency('INR');
      setAccountNumber('');
      setAccountName('');
      setApiKey('');
      setApiSecret('');
      setAccessToken('');

      onAccountAdded();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add account');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Add Trading Account</h2>
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Broker *</label>
              <select value={broker} onChange={(e) => setBroker(e.target.value)} required>
                <option value="zerodha">Zerodha</option>
                <option value="ibkr">Interactive Brokers (IBKR)</option>
                <option value="lucid">Lucid</option>
                <option value="tradovate">Tradovate</option>
                <option value="fyres">Fyres</option>
                <option value="tradingview">TradingView</option>
              </select>
            </div>
            <div className="form-group">
              <label>Account Type *</label>
              <select value={accountType} onChange={(e) => {
                const t = e.target.value;
                setAccountType(t);
                // futures accounts are usually USD, Indian live usually INR
                setCurrency(t === 'live' ? 'INR' : 'USD');
              }} required>
                <option value="live">Live (real money)</option>
                <option value="simulation">Simulation (prop/Lucid)</option>
                <option value="paper">Paper (TradingView)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Currency *</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} required>
              <option value="INR">₹ INR (Indian Rupee)</option>
              <option value="USD">$ USD (US Dollar)</option>
            </select>
          </div>

          <div className="form-group">
            <label>Account Number *</label>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g., ABC123"
              required
            />
          </div>

          <div className="form-group">
            <label>Account Name (Optional)</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g., Main Trading"
            />
          </div>

          <div style={{
            background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)',
            borderRadius: 8, padding: '10px 12px', margin: '4px 0 12px', fontSize: 12.5, color: '#c7d2fe',
          }}>
            💡 No API key needed — you'll load trades by <strong>Import CSV</strong>. API credentials below are optional (only for future auto-sync).
          </div>

          <details style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#9aa0ac', fontSize: 13, fontWeight: 600 }}>
              Optional: API credentials (for auto-sync later)
            </summary>
            <div className="form-group" style={{ marginTop: 10 }}>
              <label>API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>API Secret</label>
              <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Access Token</label>
              <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Optional" />
            </div>
          </details>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-btn">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Adding...' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
