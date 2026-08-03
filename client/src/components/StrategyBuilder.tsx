import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/StrategyBuilder.css';

interface Rule {
  id: string;
  type: 'entry' | 'exit' | 'stop';
  condition: 'price_above' | 'price_below' | 'rsi_above' | 'rsi_below' | 'macd_cross' | 'ema_cross';
  value: number;
}

interface Strategy {
  id?: number;
  name: string;
  description: string;
  rules: Rule[];
  account_id: number;
  enabled: boolean;
}

interface StrategyBuilderProps {
  token: string;
  account_id: number;
}

export default function StrategyBuilder({ token, account_id }: StrategyBuilderProps) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [formData, setFormData] = useState<Strategy>({
    name: '',
    description: '',
    rules: [],
    account_id: account_id || 1,
    enabled: true
  });
  const [loading, setLoading] = useState(true);
  const [backtestResult, setBacktestResult] = useState<any>(null);

  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    try {
      const response = await axios.get('/api/strategies', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStrategies(response.data.data || []);
    } catch (error) {
      console.error('Error fetching strategies:', error);
    } finally {
      setLoading(false);
    }
  };

  const addRule = () => {
    setFormData({
      ...formData,
      rules: [
        ...formData.rules,
        {
          id: Math.random().toString(),
          type: 'entry',
          condition: 'price_above',
          value: 0
        }
      ]
    });
  };

  const updateRule = (index: number, field: string, value: any) => {
    const newRules = [...formData.rules];
    (newRules[index] as any)[field] = value;
    setFormData({ ...formData, rules: newRules });
  };

  const removeRule = (index: number) => {
    setFormData({
      ...formData,
      rules: formData.rules.filter((_, i) => i !== index)
    });
  };

  const saveStrategy = async () => {
    try {
      if (selectedStrategy?.id) {
        await axios.put(`/api/strategies/${selectedStrategy.id}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post('/api/strategies', formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      fetchStrategies();
      setShowForm(false);
      setFormData({
        name: '',
        description: '',
        rules: [],
        account_id: account_id || 1,
        enabled: true
      });
    } catch (error) {
      console.error('Error saving strategy:', error);
    }
  };

  const backtest = async (strategyId: number) => {
    try {
      const response = await axios.post(`/api/strategies/${strategyId}/backtest`, {
        account_id: account_id || 1,
        from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to_date: new Date().toISOString().split('T')[0]
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBacktestResult(response.data.data);
    } catch (error) {
      console.error('Error backtesting:', error);
    }
  };

  const deleteStrategy = async (strategyId: number) => {
    try {
      await axios.delete(`/api/strategies/${strategyId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchStrategies();
    } catch (error) {
      console.error('Error deleting strategy:', error);
    }
  };

  if (loading) {
    return <div className="strategy-builder loading">Loading strategies...</div>;
  }

  return (
    <div className="strategy-builder">
      <div className="strategy-header">
        <h2>Strategy Builder</h2>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Strategy
        </button>
      </div>

      {showForm && (
        <div className="strategy-form">
          <h3>{selectedStrategy ? 'Edit Strategy' : 'Create New Strategy'}</h3>

          <div className="form-group">
            <label>Strategy Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Breakout Strategy"
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your strategy..."
              rows={3}
            />
          </div>

          <div className="rules-section">
            <h4>Rules</h4>
            {formData.rules.map((rule, index) => (
              <div key={rule.id} className="rule-editor">
                <select
                  value={rule.type}
                  onChange={(e) => updateRule(index, 'type', e.target.value)}
                >
                  <option value="entry">Entry</option>
                  <option value="exit">Exit</option>
                  <option value="stop">Stop Loss</option>
                </select>

                <select
                  value={rule.condition}
                  onChange={(e) => updateRule(index, 'condition', e.target.value)}
                >
                  <option value="price_above">Price Above</option>
                  <option value="price_below">Price Below</option>
                  <option value="rsi_above">RSI Above</option>
                  <option value="rsi_below">RSI Below</option>
                  <option value="macd_cross">MACD Crossover</option>
                  <option value="ema_cross">EMA Crossover</option>
                </select>

                <input
                  type="number"
                  value={rule.value}
                  onChange={(e) => updateRule(index, 'value', parseFloat(e.target.value))}
                  placeholder="Value"
                />

                <button
                  className="btn-danger"
                  onClick={() => removeRule(index)}
                >
                  Remove
                </button>
              </div>
            ))}

            <button className="btn-secondary" onClick={addRule}>
              + Add Rule
            </button>
          </div>

          <div className="form-actions">
            <button className="btn-primary" onClick={saveStrategy}>
              Save Strategy
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setShowForm(false);
                setSelectedStrategy(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="strategies-list">
        {strategies.length === 0 ? (
          <p className="empty">No strategies yet. Create one to get started!</p>
        ) : (
          strategies.map((strategy) => (
            <div key={strategy.id} className="strategy-card">
              <div className="strategy-info">
                <h4>{strategy.name}</h4>
                <p>{strategy.description}</p>
                <div className="strategy-stats">
                  <span className="stat">{(strategy.rules || []).length} rules</span>
                  <span className={`status ${strategy.enabled ? 'enabled' : 'disabled'}`}>
                    {strategy.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div className="strategy-actions">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setSelectedStrategy(strategy);
                    setFormData(strategy);
                    setShowForm(true);
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => backtest(strategy.id!)}
                >
                  Backtest
                </button>
                <button
                  className="btn-danger"
                  onClick={() => deleteStrategy(strategy.id!)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {backtestResult && (
        <div className="backtest-results">
          <h3>Backtest Results</h3>
          <div className="results-grid">
            <div className="result-item">
              <span>Total Trades</span>
              <strong>{backtestResult.total_trades}</strong>
            </div>
            <div className="result-item">
              <span>Win Rate</span>
              <strong>{backtestResult.win_rate.toFixed(2)}%</strong>
            </div>
            <div className="result-item">
              <span>Total P&L</span>
              <strong style={{ color: backtestResult.total_pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                ₹{backtestResult.total_pnl.toFixed(2)}
              </strong>
            </div>
            <div className="result-item">
              <span>Matched Trades</span>
              <strong>{backtestResult.matched_trades?.length || 0}</strong>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => setBacktestResult(null)}>
            Close Results
          </button>
        </div>
      )}
    </div>
  );
}
