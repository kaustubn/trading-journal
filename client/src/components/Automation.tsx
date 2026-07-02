import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Automation.css';

interface Bot {
  id: number;
  account_id: number;
  name: string;
  enabled: boolean;
  status: string;
  webhook_url: string;
  webhook_secret: string;
  active_positions: number;
  total_executed: number;
}

interface Position {
  id: number;
  account_id: number;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl_points: number;
  pnl_percent: number;
  stop_loss: number;
  take_profit: number;
}

interface AutomationProps {
  token: string;
  account_id: number;
}

export default function Automation({ token, account_id }: AutomationProps) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [showNewBotForm, setShowNewBotForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newBotName, setNewBotName] = useState('');

  useEffect(() => {
    fetchBots();
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000); // Update positions every 5s
    return () => clearInterval(interval);
  }, [account_id]);

  const fetchBots = async () => {
    try {
      const res = await axios.get(`/api/automation/bots?account_id=${account_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBots(res.data.data);
    } catch (error) {
      console.error('Error fetching bots:', error);
    }
  };

  const fetchPositions = async () => {
    try {
      const res = await axios.get(`/api/automation/positions?account_id=${account_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPositions(res.data.data);
    } catch (error) {
      console.error('Error fetching positions:', error);
    }
  };

  const handleCreateBot = async () => {
    if (!newBotName.trim()) return;

    try {
      setLoading(true);
      await axios.post(
        `/api/automation/bots?account_id=${account_id}`,
        {
          name: newBotName,
          config: {
            enabled: false,
            maxPositions: 3,
            riskPerTrade: 1,
            tradeSize: 1
          }
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNewBotName('');
      setShowNewBotForm(false);
      fetchBots();
    } catch (error) {
      console.error('Error creating bot:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBot = async (botId: number, currentEnabled: boolean) => {
    try {
      await axios.patch(
        `/api/automation/bots/${botId}/status`,
        { enabled: !currentEnabled },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchBots();
    } catch (error) {
      console.error('Error toggling bot:', error);
    }
  };

  const handleClosePosition = async (positionId: number) => {
    try {
      await axios.post(
        `/api/automation/positions/${positionId}/close`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchPositions();
    } catch (error) {
      console.error('Error closing position:', error);
    }
  };

  return (
    <div className="automation">
      <div className="automation-header">
        <h2>🤖 Trading Automation</h2>
        <button
          className="btn-create"
          onClick={() => setShowNewBotForm(!showNewBotForm)}
        >
          + New Bot
        </button>
      </div>

      {showNewBotForm && (
        <div className="form-new-bot">
          <input
            type="text"
            placeholder="Bot name..."
            value={newBotName}
            onChange={(e) => setNewBotName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCreateBot()}
          />
          <button onClick={handleCreateBot} disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </button>
          <button onClick={() => setShowNewBotForm(false)} className="btn-cancel">
            Cancel
          </button>
        </div>
      )}

      <div className="bots-grid">
        {bots.map((bot) => (
          <div key={bot.id} className="bot-card">
            <div className="bot-header">
              <h3>{bot.name}</h3>
              <div className="bot-status">
                <span className={`badge ${bot.enabled ? 'active' : 'inactive'}`}>
                  {bot.enabled ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
            </div>

            <div className="bot-stats">
              <div className="stat">
                <span className="label">Active Positions</span>
                <span className="value">{bot.active_positions}</span>
              </div>
              <div className="stat">
                <span className="label">Total Executed</span>
                <span className="value">{bot.total_executed}</span>
              </div>
            </div>

            <div className="bot-actions">
              <button
                className={`btn-toggle ${bot.enabled ? 'stop' : 'start'}`}
                onClick={() => handleToggleBot(bot.id, bot.enabled)}
              >
                {bot.enabled ? 'Stop' : 'Start'}
              </button>
              <button className="btn-settings">⚙️ Settings</button>
            </div>

            <div className="webhook-info">
              <details>
                <summary>Webhook URL</summary>
                <code>{bot.webhook_url}</code>
              </details>
            </div>
          </div>
        ))}
      </div>

      <div className="positions-section">
        <h3>📈 Live Positions ({positions.length})</h3>

        {positions.length === 0 ? (
          <p className="empty">No open positions</p>
        ) : (
          <table className="positions-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Current</th>
                <th>P&L</th>
                <th>P&L %</th>
                <th>SL</th>
                <th>TP</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.id}>
                  <td className="symbol">{pos.symbol}</td>
                  <td className={`side ${pos.side.toLowerCase()}`}>{pos.side}</td>
                  <td>{pos.quantity}</td>
                  <td>${pos.entry_price.toFixed(2)}</td>
                  <td>${pos.current_price.toFixed(2)}</td>
                  <td className={pos.pnl_points >= 0 ? 'positive' : 'negative'}>
                    ${pos.pnl_points.toFixed(2)}
                  </td>
                  <td className={pos.pnl_percent >= 0 ? 'positive' : 'negative'}>
                    {pos.pnl_percent.toFixed(2)}%
                  </td>
                  <td>${pos.stop_loss.toFixed(2)}</td>
                  <td>${pos.take_profit.toFixed(2)}</td>
                  <td>
                    <button
                      className="btn-close-position"
                      onClick={() => handleClosePosition(pos.id)}
                    >
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
