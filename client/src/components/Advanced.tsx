import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Advanced.css';

interface PortfolioSnapshot {
  total_equity: number;
  cash_balance: number;
  open_pnl: number;
  realized_pnl: number;
  allocation: Record<string, number>;
}

interface TaxRecord {
  fiscal_year: number;
  short_term_gains: number;
  long_term_gains: number;
  total_loss: number;
  tax_due: number;
}

interface Alert {
  id: number;
  alert_type: string;
  message: string;
  severity: string;
  read: boolean;
}

interface Metrics {
  totalPnL: number;
  totalTrades: number;
  winRate: number;
  timestamp: string;
}

interface AdvancedProps {
  token: string;
  user_id: number;
}

export default function Advanced({ token, user_id }: AdvancedProps) {
  const [activeTab, setActiveTab] = useState<'portfolio' | 'tax' | 'webhooks' | 'dashboard'>('portfolio');
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'portfolio') fetchPortfolio();
    else if (activeTab === 'tax') fetchTaxRecords();
    else if (activeTab === 'dashboard') {
      fetchAlerts();
      fetchMetrics();
    }
  }, [activeTab]);

  const fetchPortfolio = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/advanced/portfolio', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPortfolio(res.data.data);
    } catch (error) {
      console.error('Error fetching portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTaxRecords = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/advanced/tax/records', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTaxRecords(res.data.data || []);
    } catch (error) {
      console.error('Error fetching tax records:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get('/api/advanced/dashboard/alerts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(res.data.data || []);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await axios.get('/api/advanced/dashboard/metrics', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMetrics(res.data.data);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    }
  };

  const markAlertRead = async (alertId: number) => {
    try {
      await axios.post(`/api/advanced/dashboard/alerts/${alertId}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchAlerts();
    } catch (error) {
      console.error('Error marking alert read:', error);
    }
  };

  const generateTaxReport = async (year: number) => {
    try {
      setLoading(true);
      await axios.post(`/api/advanced/tax/report/${year}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchTaxRecords();
    } catch (error) {
      console.error('Error generating tax report:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="advanced">
      <div className="advanced-header">
        <h2>📊 Advanced Analytics</h2>
        <div className="tabs">
          <button className={`tab ${activeTab === 'portfolio' ? 'active' : ''}`} onClick={() => setActiveTab('portfolio')}>
            Portfolio
          </button>
          <button className={`tab ${activeTab === 'tax' ? 'active' : ''}`} onClick={() => setActiveTab('tax')}>
            Tax
          </button>
          <button className={`tab ${activeTab === 'webhooks' ? 'active' : ''}`} onClick={() => setActiveTab('webhooks')}>
            Webhooks
          </button>
          <button className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </button>
        </div>
      </div>

      {loading && <div className="loading">Loading...</div>}

      {activeTab === 'portfolio' && portfolio && (
        <div className="portfolio-section">
          <div className="metric-grid">
            <div className="card">
              <div className="label">Total Equity</div>
              <div className="value">${portfolio.total_equity.toFixed(0)}</div>
            </div>
            <div className="card">
              <div className="label">Cash Balance</div>
              <div className="value">${portfolio.cash_balance.toFixed(0)}</div>
            </div>
            <div className="card">
              <div className="label">Open P&L</div>
              <div className={`value ${portfolio.open_pnl >= 0 ? 'positive' : 'negative'}`}>
                ${portfolio.open_pnl.toFixed(0)}
              </div>
            </div>
            <div className="card">
              <div className="label">Realized P&L</div>
              <div className={`value ${portfolio.realized_pnl >= 0 ? 'positive' : 'negative'}`}>
                ${portfolio.realized_pnl.toFixed(0)}
              </div>
            </div>
          </div>

          <div className="allocation">
            <h3>Account Allocation</h3>
            {Object.entries(portfolio.allocation || {}).map(([account, pct]) => (
              <div key={account} className="allocation-bar">
                <span className="label">{account}: {pct.toFixed(1)}%</span>
                <div className="bar">
                  <div className="fill" style={{ width: `${pct}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'tax' && (
        <div className="tax-section">
          <div className="tax-controls">
            <button onClick={() => generateTaxReport(new Date().getFullYear())} className="btn-generate">
              Generate {new Date().getFullYear()} Report
            </button>
          </div>

          <table className="tax-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Short-Term Gains</th>
                <th>Long-Term Gains</th>
                <th>Loss</th>
                <th>Est. Tax Due</th>
              </tr>
            </thead>
            <tbody>
              {taxRecords.map((record) => (
                <tr key={record.fiscal_year}>
                  <td>{record.fiscal_year}</td>
                  <td className="positive">${record.short_term_gains.toFixed(0)}</td>
                  <td className="positive">${record.long_term_gains.toFixed(0)}</td>
                  <td className="negative">-${record.total_loss.toFixed(0)}</td>
                  <td className="highlight">${record.tax_due.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="webhooks-section">
          <p>Webhook integrations (Discord, Telegram, etc.)</p>
          <p className="note">Configure webhooks to receive real-time trading alerts</p>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <div className="dashboard-section">
          {metrics && (
            <div className="live-metrics">
              <div className="metric">
                <span className="label">Today's P&L</span>
                <span className={`value ${metrics.totalPnL >= 0 ? 'positive' : 'negative'}`}>
                  ${metrics.totalPnL.toFixed(0)}
                </span>
              </div>
              <div className="metric">
                <span className="label">Trades</span>
                <span className="value">{metrics.totalTrades}</span>
              </div>
              <div className="metric">
                <span className="label">Win Rate</span>
                <span className="value">{metrics.winRate.toFixed(1)}%</span>
              </div>
            </div>
          )}

          <div className="alerts">
            <h3>Live Alerts</h3>
            {alerts.length === 0 ? (
              <p className="empty">No alerts</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className={`alert alert-${alert.severity}`}>
                  <div className="alert-header">
                    <span className="type">{alert.alert_type}</span>
                    <button onClick={() => markAlertRead(alert.id)} className="btn-dismiss">✕</button>
                  </div>
                  <p>{alert.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
