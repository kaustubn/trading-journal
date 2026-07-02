import React, { useState } from 'react';
import TradeDetail from './TradeDetail';
import '../styles/TradeList.css';

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

interface TradeListProps {
  trades: Trade[];
  loading: boolean;
}

export default function TradeList({ trades, loading }: TradeListProps) {
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  if (loading) {
    return <div className="trade-list loading">Loading trades...</div>;
  }

  if (trades.length === 0) {
    return <div className="trade-list empty">No trades for this date</div>;
  }

  return (
    <div className="trade-list">
      <table className="trades-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Entry Time</th>
            <th>Exit Time</th>
            <th>Entry Price</th>
            <th>Exit Price</th>
            <th>Qty</th>
            <th>P&L</th>
            <th>Setup</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(trade => (
            <tr
              key={trade.id}
              className={`trade-row ${trade.pnl && trade.pnl > 0 ? 'win' : 'loss'}`}
              onClick={() => setSelectedTrade(trade)}
            >
              <td>{trade.symbol}</td>
              <td>{new Date(trade.entry_time).toLocaleTimeString()}</td>
              <td>{trade.exit_time ? new Date(trade.exit_time).toLocaleTimeString() : '-'}</td>
              <td>${trade.entry_price.toFixed(2)}</td>
              <td>{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}</td>
              <td>{trade.quantity}</td>
              <td className={trade.pnl && trade.pnl > 0 ? 'positive' : 'negative'}>
                ${trade.pnl?.toFixed(2) || '0.00'}
              </td>
              <td>{trade.setup_tag || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedTrade && (
        <TradeDetail trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
      )}
    </div>
  );
}
