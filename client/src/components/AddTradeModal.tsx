import React, { useState } from 'react';
import axios from 'axios';
import '../styles/AddTradeModal.css';

interface AddTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTradeAdded: () => void;
  token: string;
  accountId?: number;
}

export default function AddTradeModal({
  isOpen,
  onClose,
  onTradeAdded,
  token,
  accountId
}: AddTradeModalProps) {
  const [symbol, setSymbol] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryTime, setEntryTime] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [exitTime, setExitTime] = useState('');
  const [quantity, setQuantity] = useState('');
  const [setupTag, setSetupTag] = useState('TV Paper Trade');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const pnl = exitPrice
        ? (parseFloat(exitPrice) - parseFloat(entryPrice)) * parseInt(quantity)
        : undefined;

      await axios.post(
        '/api/trades',
        {
          symbol,
          entry_price: parseFloat(entryPrice),
          entry_time: new Date(entryTime),
          exit_price: exitPrice ? parseFloat(exitPrice) : null,
          exit_time: exitTime ? new Date(exitTime) : null,
          quantity: parseInt(quantity),
          pnl,
          setup_tag: setupTag,
          notes,
          account_id: accountId,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSymbol('');
      setEntryPrice('');
      setEntryTime('');
      setExitPrice('');
      setExitTime('');
      setQuantity('');
      setNotes('');

      onTradeAdded();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add trade');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Add Trade from TradingView</h2>
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Symbol *</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g., NQ, MNQ, ES"
                required
              />
            </div>
            <div className="form-group">
              <label>Quantity *</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g., 1"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Entry Price *</label>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="e.g., 19500.00"
                required
              />
            </div>
            <div className="form-group">
              <label>Entry Time *</label>
              <input
                type="datetime-local"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Exit Price</label>
              <input
                type="number"
                step="0.01"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="e.g., 19550.00"
              />
            </div>
            <div className="form-group">
              <label>Exit Time</label>
              <input
                type="datetime-local"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Setup Tag</label>
            <input
              type="text"
              value={setupTag}
              onChange={(e) => setSetupTag(e.target.value)}
              placeholder="e.g., TV Paper Trade, S1, S2"
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Trade notes..."
              rows={3}
            />
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-btn">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Adding...' : 'Add Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
