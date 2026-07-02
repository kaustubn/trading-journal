import React, { useState } from 'react';
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
}

interface TradeDetailProps {
  trade: Trade;
  onClose: () => void;
}

export default function TradeDetail({ trade, onClose }: TradeDetailProps) {
  const [setupTag, setSetupTag] = useState(trade.setup_tag || '');
  const [notes, setNotes] = useState(trade.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`/api/trades/${trade.id}`, {
        setup_tag: setupTag,
        notes: notes,
        user_id: 1 // TODO: Get from auth
      });
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
              ${trade.pnl?.toFixed(2) || '0.00'}
            </p>
          </div>
        </div>

        <div className="editable-fields">
          <div className="form-group">
            <label>Setup Tag</label>
            <input
              type="text"
              value={setupTag}
              onChange={e => setSetupTag(e.target.value)}
              placeholder="e.g., 1st pullback, breakout, etc."
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Trade notes, observation, what you learned..."
              rows={5}
            />
          </div>
        </div>

        <div className="actions">
          <button onClick={handleSave} disabled={saving} className="save-btn">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  );
}
