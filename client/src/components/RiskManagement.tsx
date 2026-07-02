import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/RiskManagement.css';

interface RiskProps {
  token: string;
  account_id: number;
}

export default function RiskManagement({ token, account_id }: RiskProps) {
  const [metrics, setMetrics] = useState<any>(null);
  const [kelly, setKelly] = useState<any>(null);
  const [positionSize, setPositionSize] = useState<any>(null);
  const [circuitBreaker, setCircuitBreaker] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [riskPercent, setRiskPercent] = useState(1);
  const [stopPts, setStopPts] = useState(15);

  useEffect(() => {
    fetchRiskData();
  }, [account_id]);

  const fetchRiskData = async () => {
    try {
      setLoading(true);

      const [metricsRes, kellyRes, cbRes] = await Promise.all([
        axios.get(`/api/risk/metrics/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/risk/kelly/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/risk/circuit-breaker/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setMetrics(metricsRes.data.data);
      setKelly(kellyRes.data.data);
      setCircuitBreaker(cbRes.data.data);

      // Calculate position size
      const sizeRes = await axios.get(
        `/api/risk/position-size/${account_id}?riskPercent=${riskPercent}&stopLossPts=${stopPts}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPositionSize(sizeRes.data.data);
    } catch (error) {
      console.error('Error fetching risk data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePositionSizeUpdate = async () => {
    try {
      const sizeRes = await axios.get(
        `/api/risk/position-size/${account_id}?riskPercent=${riskPercent}&stopLossPts=${stopPts}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPositionSize(sizeRes.data.data);
    } catch (error) {
      console.error('Error calculating position size:', error);
    }
  };

  if (loading || !metrics) {
    return <div className="risk-management loading">Loading risk metrics...</div>;
  }

  const getCircuitColor = () => {
    if (circuitBreaker?.shouldHalt) return '#ff4444';
    if (metrics.circuitBreakerStatus === 'yellow') return '#ffaa00';
    return '#00cc66';
  };

  return (
    <div className="risk-management">
      <div className="risk-header">
        <h2>🛡️ Risk Management</h2>
        <button className="btn-refresh" onClick={fetchRiskData}>
          ↻ Refresh
        </button>
      </div>

      {circuitBreaker?.shouldHalt && (
        <div className="circuit-breaker-alert">
          <strong>⚠️ TRADING HALTED</strong>
          <p>{circuitBreaker.reason}</p>
        </div>
      )}

      <div className="risk-grid">
        {/* Account Equity */}
        <div className="metric-card">
          <div className="metric-label">Account Equity</div>
          <div className="metric-value">
            ${metrics.accountEquity.toFixed(0)}
          </div>
          <div className="metric-sub">Peak: ${metrics.peakEquity.toFixed(0)}</div>
        </div>

        {/* Daily P&L */}
        <div className="metric-card">
          <div className="metric-label">Daily P&L</div>
          <div
            className="metric-value"
            style={{
              color: metrics.dailyPnl >= 0 ? '#00cc66' : '#ff4444'
            }}
          >
            ${metrics.dailyPnl.toFixed(0)}
          </div>
          <div className="metric-sub">Max Daily Loss: ${metrics.maxDailyLoss.toFixed(0)}</div>
        </div>

        {/* Drawdown */}
        <div className="metric-card">
          <div className="metric-label">Daily Drawdown</div>
          <div className="metric-value">{metrics.dailyDrawdown.toFixed(2)}%</div>
          <div className="metric-sub">Monthly: {metrics.monthlyDrawdown.toFixed(2)}%</div>
        </div>

        {/* Circuit Breaker */}
        <div className="metric-card">
          <div className="metric-label">Circuit Breaker</div>
          <div
            className="circuit-status"
            style={{
              backgroundColor: getCircuitColor(),
              color: 'white'
            }}
          >
            {circuitBreaker?.shouldHalt ? '🛑 HALT' : metrics.circuitBreakerStatus.toUpperCase()}
          </div>
          <div className="metric-sub">Risk per Trade: {metrics.riskPerTrade.toFixed(2)}%</div>
        </div>
      </div>

      {/* Kelly Criterion */}
      {kelly && (
        <div className="kelly-section">
          <h3>📊 Kelly Criterion Analysis</h3>
          <div className="kelly-grid">
            <div className="kelly-card">
              <div className="kelly-label">Win Rate</div>
              <div className="kelly-value">{(kelly.winRate * 100).toFixed(1)}%</div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Avg Win / Loss Ratio</div>
              <div className="kelly-value">
                {kelly.avgLoss > 0 ? (kelly.avgWin / kelly.avgLoss).toFixed(2) : 'N/A'}
              </div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Kelly %</div>
              <div className="kelly-value">{kelly.kellyPercent.toFixed(2)}%</div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Recommended Size</div>
              <div className="kelly-value">{(kelly.recommendedSize * 100).toFixed(1)}%</div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Safe Fraction (1/4 Kelly)</div>
              <div className="kelly-value">{(kelly.safeFraction * 100).toFixed(2)}%</div>
            </div>
          </div>
          <div className="kelly-note">
            💡 <strong>Safe approach:</strong> Use 1/4 Kelly ({(kelly.safeFraction * 100).toFixed(2)}%) to reduce volatility
          </div>
        </div>
      )}

      {/* Position Size Calculator */}
      <div className="position-size-section">
        <h3>📏 Position Size Calculator</h3>
        <div className="calc-inputs">
          <div className="input-group">
            <label>Risk % per trade:</label>
            <input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={riskPercent}
              onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
            />
            <span className="unit">%</span>
          </div>
          <div className="input-group">
            <label>Stop Loss (pts):</label>
            <input
              type="number"
              min="5"
              max="100"
              step="1"
              value={stopPts}
              onChange={(e) => setStopPts(parseInt(e.target.value))}
            />
            <span className="unit">pts</span>
          </div>
          <button className="btn-calculate" onClick={handlePositionSizeUpdate}>
            Calculate
          </button>
        </div>

        {positionSize && (
          <div className="position-result">
            <div className="result-item">
              <span>Risk Amount:</span>
              <strong>${positionSize.riskDollars.toFixed(0)}</strong>
            </div>
            <div className="result-item">
              <span>Recommended Contracts:</span>
              <strong>{positionSize.contracts}</strong>
            </div>
            {positionSize.warningMsg && (
              <div className="warning">{positionSize.warningMsg}</div>
            )}
          </div>
        )}
      </div>

      {/* Risk Rules Summary */}
      <div className="risk-rules">
        <h3>📋 Risk Rules (Hardcoded)</h3>
        <ul>
          <li>✅ Max daily loss: <strong>2%</strong> of account</li>
          <li>✅ Max drawdown for halt: <strong>15%</strong></li>
          <li>✅ Yellow alert at: <strong>10%</strong> drawdown</li>
          <li>✅ Max risk per trade: <strong>1-2%</strong></li>
          <li>✅ Position size: Kelly × {kelly ? (kelly.safeFraction * 100).toFixed(0) : 'N/A'}% (safe)</li>
          <li>✅ Multiple accounts: max <strong>3 simultaneous positions</strong></li>
        </ul>
      </div>
    </div>
  );
}
