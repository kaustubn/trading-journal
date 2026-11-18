import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Analytics.css';
import { money, num } from '../utils/format';
import { BarChart3 } from 'lucide-react';
import { InfoTip, EmptyState } from './ui';
import FocusPanel from './FocusPanel';

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
  isAdmin?: boolean;
  onNavigate?: (view: string) => void;
}

export default function Analytics({ token, account_id, isAdmin, onNavigate, attempt }: AnalyticsProps & { attempt?: number | null }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [dailyData, setDailyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'stats' | 'monthly' | 'daily'>('stats');

  useEffect(() => {
    if (account_id) {
      fetchAnalytics();
    }
  }, [account_id, token, attempt]);

  const fetchAnalytics = async () => {
    if (!account_id) return;
    setLoading(true);
    try {
      const [statsRes, monthlyRes, dailyRes] = await Promise.all([
        axios.get(`/api/analytics/stats/${account_id}`, { params: { attempt: attempt || undefined }, 
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/analytics/monthly/${account_id}`, { params: { attempt: attempt || undefined }, 
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/analytics/daily/${account_id}`, { params: { attempt: attempt || undefined }, 
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setStats(statsRes.data.data || null);
      setMonthlyData(monthlyRes.data.data || []);
      setDailyData(dailyRes.data.data || []);
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
    return <div className="analytics loading">Loading analytics…</div>;
  }

  const pf = parseFloat(stats?.profit_factor || '0') || 0;
  const aw = Math.abs(num(stats?.avg_win)), al = Math.abs(num(stats?.avg_loss));
  const breakeven = aw + al > 0 ? (al / (aw + al)) * 100 : 0;
  const wr = parseFloat(String(stats?.win_rate || '0')) || 0;

  return (
    <>
      <div className="analytics">
        <div className="analytics-header">
          <span className="scope-note">{attempt ? 'The run selected on the Dashboard · all dates' : 'All trades in this account · every run, all dates'}</span>
          <div className="view-toggle">
            {([['stats', 'Summary'], ['monthly', 'By month'], ['daily', 'By day']] as const).map(([k, l]) => (
              <button key={k} className={`view-btn ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
        </div>

        {view === 'stats' && !stats && (
          <EmptyState icon={BarChart3} title="No closed trades yet">Import a CSV or add a trade, then come back for your numbers.</EmptyState>
        )}

        {view === 'stats' && stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Net P&L<InfoTip term="netPnl" align="left" /></div>
              <div className={`stat-value ${num(stats.total_pnl) >= 0 ? 'positive' : 'negative'}`}>{money(stats.total_pnl, 0)}</div>
              <div className="stat-detail">{num(stats.total_trades).toLocaleString()} trades</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Win rate<InfoTip term="winRate" /></div>
              <div className="stat-value">{stats.win_rate}</div>
              <div className="stat-detail">{num(stats.wins).toLocaleString()} won · {num(stats.losses).toLocaleString()} lost</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Profit factor<InfoTip term="profitFactor" /></div>
              <div className={`stat-value ${pf >= 1 ? 'positive' : 'negative'}`}>{stats.profit_factor}</div>
              <div className="stat-detail">{pf >= 1.5 ? 'Healthy — above 1.5' : pf >= 1 ? 'Profitable but thin' : 'Below 1.0 — losing overall'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Expectancy<InfoTip term="expectancy" /></div>
              <div className={`stat-value ${num(stats.avg_pnl) >= 0 ? 'positive' : 'negative'}`}>{money(stats.avg_pnl)}</div>
              <div className="stat-detail">average per trade</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg win / avg loss<InfoTip term="payoff" /></div>
              <div className="stat-value">{money(aw, 0)} / {money(al, 0)}</div>
              <div className="stat-detail">ratio {al > 0 ? (aw / al).toFixed(2) : '—'} · above 1.0 is good</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Break-even win rate<InfoTip text="The win rate you need just to break even with your current average win and loss sizes: avg loss ÷ (avg win + avg loss). Your real win rate should be comfortably above it." align="right" /></div>
              <div className={`stat-value ${wr >= breakeven ? 'positive' : 'negative'}`}>{breakeven.toFixed(1)}%</div>
              <div className="stat-detail">you win {wr.toFixed(1)}% — {wr >= breakeven ? `${(wr - breakeven).toFixed(1)} pts of margin` : `${(breakeven - wr).toFixed(1)} pts short`}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Best trade<InfoTip term="largest" align="left" /></div>
              <div className="stat-value positive">{money(stats.best_trade)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Worst trade</div>
              <div className="stat-value negative">{money(stats.worst_trade)}</div>
              <div className="stat-detail">{al > 0 ? `${(Math.abs(num(stats.worst_trade)) / al).toFixed(1)}× your average loss` : ''}</div>
            </div>
          </div>
        )}

        {view === 'monthly' && (
          monthlyData.length === 0 ? <EmptyState icon={BarChart3} title="No months to show yet" /> :
          <div className="performance-table">
            <table>
              <thead>
                <tr><th>Month</th><th className="num">Trades</th><th className="num">Won</th><th className="num">Lost</th><th className="num">Win rate</th><th className="num">P&L</th></tr>
              </thead>
              <tbody>
                {monthlyData.map((row, i) => (
                  <tr key={i}>
                    <td>{row.month}</td>
                    <td className="num">{row.trades}</td>
                    <td className="num">{row.wins}</td>
                    <td className="num">{row.losses}</td>
                    <td className="num">{row.win_rate}</td>
                    <td className={`num ${parseFloat(row.pnl) > 0 ? 'positive' : 'negative'}`}>{money(row.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'daily' && (
          dailyData.length === 0 ? <EmptyState icon={BarChart3} title="No days to show yet" /> :
          <div className="performance-table">
            <table>
              <thead>
                <tr><th>Date</th><th className="num">Trades</th><th className="num">Won</th><th className="num">Lost</th><th className="num">Win rate</th><th className="num">P&L</th></tr>
              </thead>
              <tbody>
                {dailyData.map((row, i) => (
                  <tr key={i}>
                    <td>{row.date}</td>
                    <td className="num">{row.trades}</td>
                    <td className="num">{row.wins}</td>
                    <td className="num">{row.losses}</td>
                    <td className="num">{row.win_rate}</td>
                    <td className={`num ${parseFloat(row.pnl) > 0 ? 'positive' : 'negative'}`}>{money(row.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {view === 'stats' && stats && onNavigate && (
        <FocusPanel token={token} account_id={account_id} title="What your numbers say"
          rangeLabel="whole account" isAdmin={isAdmin} onNavigate={onNavigate} />
      )}
    </>
  );
}
