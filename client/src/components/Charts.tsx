import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Charts.css';

interface ChartData {
  label: string;
  value: number;
  pnl?: number;
}

interface ChartsProps {
  token: string;
  account_id: number | null;
}

export default function Charts({ token, account_id }: ChartsProps) {
  const [dailyPnLData, setDailyPnLData] = useState<ChartData[]>([]);
  const [monthlyPnLData, setMonthlyPnLData] = useState<ChartData[]>([]);
  const [drawdownData, setDrawdownData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeChart, setActiveChart] = useState<'daily' | 'monthly' | 'drawdown'>('daily');

  useEffect(() => {
    if (account_id) {
      fetchChartData();
    }
  }, [account_id, token]);

  const fetchChartData = async () => {
    if (!account_id) return;
    setLoading(true);
    try {
      const [dailyRes, monthlyRes] = await Promise.all([
        axios.get(`/api/analytics/daily/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/analytics/monthly/${account_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      // Process daily P&L
      const dailyChartData = (dailyRes.data.data || []).map((row: any) => ({
        label: row.date,
        value: parseFloat(row.pnl),
        pnl: parseFloat(row.pnl)
      })).reverse();
      setDailyPnLData(dailyChartData);

      // Process monthly P&L
      const monthlyChartData = (monthlyRes.data.data || []).map((row: any) => ({
        label: row.month,
        value: parseFloat(row.pnl),
        pnl: parseFloat(row.pnl)
      })).reverse();
      setMonthlyPnLData(monthlyChartData);

      // Calculate drawdown
      const drawdown = calculateDrawdown(dailyChartData);
      setDrawdownData(drawdown);
    } catch (error) {
      console.error('Error fetching chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateDrawdown = (data: ChartData[]): ChartData[] => {
    let cumulative = 0;
    let peak = 0;

    return data.map((row, idx) => {
      cumulative += row.value;
      peak = Math.max(peak, cumulative);
      const drawdown = cumulative - peak;

      return {
        label: row.label,
        value: drawdown,
        pnl: drawdown
      };
    });
  };

  if (!account_id) {
    return <div className="charts empty">Select an account to view charts</div>;
  }

  if (loading) {
    return <div className="charts loading">Loading charts...</div>;
  }

  return (
    <div className="charts">
      <div className="charts-header">
        <h2>Performance Charts</h2>
        <div className="chart-toggle">
          <button
            className={`chart-btn ${activeChart === 'daily' ? 'active' : ''}`}
            onClick={() => setActiveChart('daily')}
          >
            Daily P&L
          </button>
          <button
            className={`chart-btn ${activeChart === 'monthly' ? 'active' : ''}`}
            onClick={() => setActiveChart('monthly')}
          >
            Monthly P&L
          </button>
          <button
            className={`chart-btn ${activeChart === 'drawdown' ? 'active' : ''}`}
            onClick={() => setActiveChart('drawdown')}
          >
            Drawdown
          </button>
        </div>
      </div>

      <div className="chart-container">
        {activeChart === 'daily' && <SimpleBarChart data={dailyPnLData} />}
        {activeChart === 'monthly' && <SimpleBarChart data={monthlyPnLData} />}
        {activeChart === 'drawdown' && <DrawdownChart data={drawdownData} />}
      </div>
    </div>
  );
}

// Simple bar chart using CSS
function SimpleBarChart({ data }: { data: ChartData[] }) {
  const maxValue = Math.max(...data.map(d => Math.abs(d.value)));
  const minValue = Math.min(...data.map(d => d.value));

  return (
    <div className="bar-chart">
      <div className="chart-bars">
        {data.map((item, idx) => {
          const percentage = maxValue > 0 ? (Math.abs(item.value) / maxValue) * 100 : 0;
          const isPositive = item.value >= 0;

          return (
            <div key={idx} className="bar-item">
              <div className={`bar ${isPositive ? 'positive' : 'negative'}`}
                   style={{ height: `${percentage}%` }}
                   title={`${item.label}: ₹${item.value.toFixed(2)}`}>
              </div>
              <div className="bar-label">{item.label.slice(5)}</div>
            </div>
          );
        })}
      </div>
      <div className="chart-info">
        <span className="total">Total: ₹{data.reduce((sum, d) => sum + d.value, 0).toFixed(2)}</span>
      </div>
    </div>
  );
}

// Drawdown chart
function DrawdownChart({ data }: { data: ChartData[] }) {
  const minDrawdown = Math.min(...data.map(d => d.value));

  return (
    <div className="drawdown-chart">
      <div className="chart-area">
        {data.map((item, idx) => {
          const percentage = minDrawdown !== 0 ? (item.value / minDrawdown) * 100 : 0;

          return (
            <div key={idx} className="drawdown-item" title={`${item.label}: ₹${item.value.toFixed(2)}`}>
              <div className="drawdown-bar" style={{ height: `${percentage}%` }}></div>
              <div className="drawdown-label">{item.label.slice(5)}</div>
            </div>
          );
        })}
      </div>
      <div className="chart-info">
        <span className="max-drawdown">Max Drawdown: ₹{minDrawdown.toFixed(2)}</span>
      </div>
    </div>
  );
}
