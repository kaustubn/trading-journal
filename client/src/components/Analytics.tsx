import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Analytics.css';

interface Stats {
  total_trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: string;
  total_pnl: string;
  avg_pnl: string;
  best_trade: string;
  worst_trade: string;
  profit_factor: string;
  avg_win: string;
  avg_loss: string;
}

interface AnalyticsProps {
  token: string;
  account_id: number | null;
}

export default function Analytics({ token, account_id }: AnalyticsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [dailyData, setDailyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'stats' | 'monthly' | 'daily'>('stats');

  useEffect(() => {
    if (account_id) {
      fetchAnalytics();
    }
  }, [account_id, token]);

  const fetchAnalytics = async () => {
    if (!account_id) return;
    setLoading(true);
    try {
      const [statsRes, monthlyRes, dailyRes] = await Promise.all([
        axios.get(`/api/analytics/stats/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/analytics/monthly/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/analytics/daily/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setStats(statsRes.data.data);
      setMonthlyData(monthlyRes.data.data);
      setDailyData(dailyRes.data.data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!account_id) {
    return <div className="analytics empty">Select an account to view analytics</div>;
  }

  if (loading) {
    return <div className="analytics loading">Loading analytics...</div>;
  }

  return (
    <div className="analytics">
      <div className="analytics-header">
        <h2>Performance Analytics</h2>
        <div className="view-toggle">
          <button
            className={`view-btn ${view === 'stats' ? 'active' : ''}`}
            onClick={() => setView('stats')}
          >
            Overview
          </button>
          <button
            className={`view-btn ${view === 'monthly' ? 'active' : ''}`}
            onClick={() => setView('monthly')}
          >
            Monthly
          </button>
          <button
            className={`view-btn ${view === 'daily' ? 'active' : ''}`}
            onClick={() => setView('daily')}
          >
            Daily
          </button>
        </div>
      </div>

      {view === 'stats' && stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Trades</div>
            <div className="stat-value">{stats.total_trades}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Win Rate</div>
            <div className="stat-value">{stats.win_rate}</div>
            <div className="stat-detail">
              {stats.wins}W / {stats.losses}L
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Total P&L</div>
            <div className={`stat-value ${parseFloat(stats.total_pnl) > 0 ? 'positive' : 'negative'}`}>
              ₹{stats.total_pnl}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Profit Factor</div>
            <div className="stat-value">{stats.profit_factor}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Avg P&L</div>
            <div className={`stat-value ${parseFloat(stats.avg_pnl) > 0 ? 'positive' : 'negative'}`}>
              ₹{stats.avg_pnl}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Best Trade</div>
            <div className="stat-value positive">₹{stats.best_trade}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Worst Trade</div>
            <div className="stat-value negative">₹{stats.worst_trade}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Avg Win</div>
            <div className="stat-value positive">₹{stats.avg_win}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Avg Loss</div>
            <div className="stat-value negative">₹{stats.avg_loss}</div>
          </div>
        </div>
      )}

      {view === 'monthly' && (
        <div className="performance-table">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Trades</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Win Rate</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map((row, i) => (
                <tr key={i}>
                  <td>{row.month}</td>
                  <td>{row.trades}</td>
                  <td className="win">{row.wins}</td>
                  <td className="loss">{row.losses}</td>
                  <td>{row.win_rate}</td>
                  <td className={parseFloat(row.pnl) > 0 ? 'positive' : 'negative'}>
                    ₹{row.pnl}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'daily' && (
        <div className="performance-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Trades</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Win Rate</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {dailyData.map((row, i) => (
                <tr key={i}>
                  <td>{row.date}</td>
                  <td>{row.trades}</td>
                  <td className="win">{row.wins}</td>
                  <td className="loss">{row.losses}</td>
                  <td>{row.win_rate}</td>
                  <td className={parseFloat(row.pnl) > 0 ? 'positive' : 'negative'}>
                    ₹{row.pnl}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
