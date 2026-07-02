import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Calendar from './components/Calendar';
import AccountSelector from './components/AccountSelector';
import TradeList from './components/TradeList';
import Ideas from './components/Ideas';
import Analytics from './components/Analytics';
import Charts from './components/Charts';
import StrategyBuilder from './components/StrategyBuilder';
import Insights from './components/Insights';
import RiskManagement from './components/RiskManagement';
import Social from './components/Social';
import Automation from './components/Automation';
import Advanced from './components/Advanced';
import LoginForm from './components/LoginForm';
import './App.css';

interface Account {
  id: number;
  broker: string;
  account_number: string;
  account_name: string;
}

interface DailySummary {
  account_id: number;
  trade_date: string;
  daily_pnl?: number;
  trade_count: number;
}

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

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userId, setUserId] = useState<number | null>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) {
      verifyToken();
    }
  }, []);

  useEffect(() => {
    if (userId) {
      fetchAccounts();
    }
  }, [userId, token]);

  useEffect(() => {
    if (userId && month && year) {
      fetchDailySummaries();
    }
  }, [month, year, userId, token]);

  useEffect(() => {
    if (selectedDate && userId) {
      fetchTrades();
    }
  }, [selectedDate, selectedAccount, userId, token]);

  const verifyToken = async () => {
    try {
      const response = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUserId(response.data.user.id);
    } catch (error) {
      console.error('Token invalid:', error);
      setToken(null);
      localStorage.removeItem('token');
    }
  };

  const handleLogin = (newToken: string, newUserId: number) => {
    setToken(newToken);
    setUserId(newUserId);
    localStorage.setItem('token', newToken);
  };

  const handleLogout = () => {
    setToken(null);
    setUserId(null);
    localStorage.removeItem('token');
  };

  const fetchAccounts = async () => {
    try {
      const response = await axios.get('/api/accounts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const accts = response.data.data || [];
      setAccounts(accts);
      if (accts.length > 0 && !selectedAccount) {
        setSelectedAccount(accts[0].id);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchDailySummaries = async () => {
    try {
      const response = await axios.get('/api/daily-summary', {
        headers: { Authorization: `Bearer ${token}` },
        params: { month, year }
      });
      setDailySummaries(response.data.data || []);
    } catch (error) {
      console.error('Error fetching daily summaries:', error);
    }
  };

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/trades', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          date: selectedDate,
          account_id: selectedAccount
        }
      });
      setTrades(response.data.data || []);
    } catch (error) {
      console.error('Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!selectedAccount || !token) return;
    try {
      await axios.post(
        `/api/accounts/${selectedAccount}/sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDailySummaries();
      if (selectedDate) {
        await fetchTrades();
      }
    } catch (error) {
      console.error('Error syncing:', error);
    }
  };

  if (!token || !userId) {
    return <LoginForm onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Trading Journal</h1>
        <div className="header-actions">
          <button onClick={handleSync} className="sync-btn">Sync Now</button>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      <main className="main">
        <div className="sidebar">
          <AccountSelector
            accounts={accounts}
            selectedAccount={selectedAccount}
            onSelectAccount={setSelectedAccount}
          />
        </div>

        <div className="content">
          <Calendar
            month={month}
            year={year}
            onMonthChange={setMonth}
            onYearChange={setYear}
            dailySummaries={dailySummaries}
            selectedDate={selectedDate}
            onDateClick={(date) => setSelectedDate(date)}
          />

          {token && selectedAccount && (
            <>
              <Analytics token={token} account_id={selectedAccount} />
              <Charts token={token} account_id={selectedAccount} />
              <RiskManagement token={token} account_id={selectedAccount} />
              <Insights token={token} account_id={selectedAccount} />
              <StrategyBuilder token={token} account_id={selectedAccount} />
              <Automation token={token} account_id={selectedAccount} />
              <Advanced token={token} user_id={userId || 0} />
              <Social token={token} user_id={userId || 0} />
            </>
          )}

          {selectedDate && (
            <>
              <div className="trades-panel">
                <h2>Trades for {selectedDate}</h2>
                <TradeList trades={trades} loading={loading} />
              </div>

              {token && (
                <Ideas
                  token={token}
                  selectedDate={selectedDate}
                  selectedAccount={selectedAccount || undefined}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
