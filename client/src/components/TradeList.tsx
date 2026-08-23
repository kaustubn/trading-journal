import React, { useState } from 'react';
import axios from 'axios';
import TradeDetail from './TradeDetail';
import { money } from '../utils/format';
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
  grade?: string;
  notes?: string;
  has_screenshot?: boolean;
}

interface TradeListProps {
  trades: Trade[];
  loading: boolean;
  token?: string;
  onTradeSaved?: () => void;
}

const SETUPS = ['S1', 'S2', 'S3', 'ORB'];
const GRADES = ['A', 'B', 'C'];
const SESSIONS = ['Asia', 'London', 'NY AM', 'NY PM'];
const TEST_TYPES = ['Retracement', 'Continuation', 'Reversal', 'Breakout', 'Range'];
const TIMEFRAMES = ['1m', '2m', '5m', '15m', '1h'];

export default function TradeList({ trades, loading, token, onTradeSaved }: TradeListProps) {
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());

  if (loading) return <div className="trade-list loading">Loading trades...</div>;
  if (trades.length === 0) return <div className="trade-list empty">No trades for this date</div>;

  const H = { headers: { Authorization: `Bearer ${token}` } };

  const bulkTag = async (ids: number[], fields: Record<string, string>) => {
    if (!ids.length) return;
    try {
      await axios.post('/api/trades/bulk-tag', { ids, ...fields }, H);
      onTradeSaved?.();
    } catch (e) { console.error(e); }
  };

  const toggle = (id: number) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = sel.size === trades.length;
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(trades.map(t => t.id)));

  return (
    <div className="trade-list">
      {sel.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{sel.size} selected</span>
          <span className="bulk-lbl">Setup:</span>
          {SETUPS.map(s => <button key={s} className="bulk-chip" onClick={() => bulkTag([...sel], { setup_tag: s })}>{s}</button>)}
          <span className="bulk-lbl">Grade:</span>
          {GRADES.map(g => <button key={g} className={`bulk-chip grade-${g}`} onClick={() => bulkTag([...sel], { grade: g })}>{g}</button>)}
          <span className="bulk-lbl">Session:</span>
          {SESSIONS.map(s => <button key={s} className="bulk-chip" onClick={() => bulkTag([...sel], { session: s })}>{s}</button>)}
          <span className="bulk-lbl">Type:</span>
          {TEST_TYPES.map(t => <button key={t} className="bulk-chip" onClick={() => bulkTag([...sel], { test_type: t })}>{t}</button>)}
          <span className="bulk-lbl">TF:</span>
          {TIMEFRAMES.map(t => <button key={t} className="bulk-chip" onClick={() => bulkTag([...sel], { timeframe: t })}>{t}</button>)}
          <button className="bulk-clear" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <table className="trades-table">
        <thead>
          <tr>
            <th className="col-check"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
            <th>Symbol</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Price</th>
            <th>Qty</th>
            <th>P&L</th>
            <th>Setup</th>
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(trade => (
            <tr key={trade.id} className={`trade-row ${trade.pnl && trade.pnl > 0 ? 'win' : 'loss'} ${sel.has(trade.id) ? 'sel' : ''}`}>
              <td className="col-check" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={sel.has(trade.id)} onChange={() => toggle(trade.id)} />
              </td>
              <td onClick={() => setSelectedTrade(trade)}>{trade.symbol}{trade.has_screenshot ? ' 📷' : ''}</td>
              <td onClick={() => setSelectedTrade(trade)}>{new Date(trade.entry_time).toLocaleTimeString()}</td>
              <td onClick={() => setSelectedTrade(trade)}>{trade.exit_time ? new Date(trade.exit_time).toLocaleTimeString() : '-'}</td>
              <td onClick={() => setSelectedTrade(trade)}>{money(trade.entry_price)}{trade.exit_price ? ` → ${money(trade.exit_price)}` : ''}</td>
              <td onClick={() => setSelectedTrade(trade)}>{trade.quantity}</td>
              <td className={trade.pnl && trade.pnl > 0 ? 'positive' : 'negative'} onClick={() => setSelectedTrade(trade)}>
                {money(trade.pnl)}
              </td>
              <td>
                <div className="row-chips">
                  {SETUPS.map(s => (
                    <button key={s} className={`row-chip ${trade.setup_tag === s ? 'on' : ''}`}
                      onClick={() => bulkTag([trade.id], { setup_tag: s })}>{s}</button>
                  ))}
                </div>
              </td>
              <td>
                <div className="row-chips">
                  {GRADES.map(g => (
                    <button key={g} className={`row-chip grade-${g} ${trade.grade === g ? 'on' : ''}`}
                      onClick={() => bulkTag([trade.id], { grade: g })}>{g}</button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedTrade && (
        <TradeDetail trade={selectedTrade} onClose={() => setSelectedTrade(null)} onSaved={onTradeSaved} />
      )}
    </div>
  );
}
