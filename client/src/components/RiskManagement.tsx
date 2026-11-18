import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw, OctagonX, Calculator, Lightbulb, Ruler, ListChecks } from 'lucide-react';
import { InfoTip } from './ui';
import { money } from '../utils/format';
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
    if (circuitBreaker?.shouldHalt) return '#ef4444';
    if (metrics.circuitBreakerStatus === 'yellow') return '#ffaa00';
    return '#22c55e';
  };

  return (
    <div className="risk-management">
      <div className="risk-header">
        <span className="scope-note">Estimated from this account's trades and the rule set below</span>
        <button className="btn-refresh" onClick={fetchRiskData}>
          <RefreshCw className="ic-sm" /> Refresh
        </button>
      </div>

      {circuitBreaker?.shouldHalt && (
        <div className="circuit-breaker-alert">
          <strong><OctagonX className="ic-sm" /> Trading halted — stop for today</strong>
          <p>{circuitBreaker.reason}</p>
        </div>
      )}

      <div className="risk-grid">
        {/* Account Equity */}
        <div className="metric-card">
          <div className="metric-label">Account equity<InfoTip text="Starting balance plus your closed P&L, as the risk engine estimates it." align="left" /></div>
          <div className="metric-value">{money(metrics.accountEquity, 0)}</div>
          <div className="metric-sub">Peak {money(metrics.peakEquity, 0)}</div>
        </div>

        {/* Daily P&L */}
        <div className="metric-card">
          <div className="metric-label">Today's P&L</div>
          <div className={`metric-value ${metrics.dailyPnl >= 0 ? 'positive' : 'negative'}`}>{money(metrics.dailyPnl, 0)}</div>
          <div className="metric-sub">Stop for the day at {money(-Math.abs(metrics.maxDailyLoss), 0)}</div>
        </div>

        {/* Drawdown */}
        <div className="metric-card">
          <div className="metric-label">Drawdown today<InfoTip term="maxDrawdown" /></div>
          <div className="metric-value">{metrics.dailyDrawdown.toFixed(2)}%</div>
          <div className="metric-sub">This month {metrics.monthlyDrawdown.toFixed(2)}%</div>
        </div>

        {/* Circuit Breaker */}
        <div className="metric-card">
          <div className="metric-label">Circuit breaker<InfoTip term="circuitBreaker" align="right" /></div>
          <div
            className="circuit-status"
            style={{
              backgroundColor: getCircuitColor(),
              color: '#0b0d12'
            }}
          >
            {circuitBreaker?.shouldHalt ? 'HALT' : metrics.circuitBreakerStatus.toUpperCase()}
          </div>
          <div className="metric-sub">Risk per trade {metrics.riskPerTrade.toFixed(2)}%</div>
        </div>
      </div>

      {/* Kelly Criterion */}
      {kelly && (
        <div className="kelly-section">
          <h3><Calculator className="ic-sm" /> How much to risk (Kelly)<InfoTip term="kelly" /></h3>
          <p className="risk-explain">Kelly suggests a risk size from your win rate and win/loss size. Most pros use a quarter of it or less.</p>
          <div className="kelly-grid">
            <div className="kelly-card">
              <div className="kelly-label">Win Rate</div>
              <div className="kelly-value">{(kelly.winRate * 100).toFixed(1)}%</div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Avg win ÷ avg loss</div>
              <div className="kelly-value">
                {kelly.avgLoss > 0 ? (kelly.avgWin / kelly.avgLoss).toFixed(2) : 'N/A'}
              </div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Kelly %</div>
              <div className="kelly-value">{kelly.kellyPercent.toFixed(2)}%</div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Full Kelly size</div>
              <div className="kelly-value">{(kelly.recommendedSize * 100).toFixed(1)}%</div>
            </div>
            <div className="kelly-card">
              <div className="kelly-label">Safer: ¼ Kelly</div>
              <div className="kelly-value">{(kelly.safeFraction * 100).toFixed(2)}%</div>
            </div>
          </div>
          <div className="kelly-note">
            <Lightbulb className="ic-sm" /> {kelly.kellyPercent > 0
              ? <><strong>Suggested:</strong> risk about {(kelly.safeFraction * 100).toFixed(2)}% of the account per trade (¼ Kelly) to keep swings survivable.</>
              : <><strong>No edge yet:</strong> Kelly is zero or negative, so the maths says not to size up. Trade the minimum until your numbers improve.</>}
          </div>
        </div>
      )}

      {/* Position Size Calculator */}
      <div className="position-size-section">
        <h3><Ruler className="ic-sm" /> Contracts calculator</h3>
        <p className="risk-explain">Enter how much of the account to risk and how far your stop is. It tells you how many contracts keep the loss inside that amount.</p>
        <div className="calc-inputs">
          <div className="input-group">
            <label>Risk per trade (% of account)</label>
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
            <label>Stop distance (points)</label>
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
              <span>Money at risk</span>
              <strong>{money(positionSize.riskDollars, 0)}</strong>
            </div>
            <div className="result-item">
              <span>Contracts to trade</span>
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
        <h3><ListChecks className="ic-sm" /> Built-in risk rules</h3>
        <p className="risk-explain">These limits drive the circuit breaker above. They are fixed for now.</p>
        <ul>
          <li>Max daily loss: <strong>2%</strong> of account</li>
          <li>Stop trading (halt) at drawdown: <strong>15%</strong></li>
          <li>Yellow warning at: <strong>10%</strong> drawdown</li>
          <li>Max risk per trade: <strong>1-2%</strong></li>
          <li>Position size: Kelly × {kelly ? (kelly.safeFraction * 100).toFixed(0) : 'N/A'}% (safe)</li>
          <li>Across accounts: max <strong>3 simultaneous positions</strong></li>
        </ul>
      </div>
    </div>
  );
}
