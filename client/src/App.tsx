import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Calendar from './components/Calendar';
import AccountSelector from './components/AccountSelector';
import TradeList from './components/TradeList';
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
  const [userId, setUserId] = useState(1); // TODO: Get from auth
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch accounts
  useEffect(() => {
    fetchAccounts();
  }, [userId]);

  // Fetch daily summaries for calendar
  useEffect(() => {
    fetchDailySummaries();
  }, [month, year, userId]);

  // Fetch trades for selected date/account
  useEffect(() => {
    if (selectedDate) {
      fetchTrades();
    }
  }, [selectedDate, selectedAccount, userId]);

  const fetchAccounts = async () => {
    try {
      const response = await axios.get('/api/accounts', { params: { user_id: userId } });
      setAccounts(response.data.data);
      if (response.data.data.length > 0) {
        setSelectedAccount(response.data.data[0].id);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchDailySummaries = async () => {
    try {
      const response = await axios.get('/api/daily-summary', {
        params: { month, year, user_id: userId }
      });
      setDailySummaries(response.data.data);
    } catch (error) {
      console.error('Error fetching daily summaries:', error);
    }
  };

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/trades', {
        params: {
          date: selectedDate,
          account_id: selectedAccount,
          user_id: userId
        }
      });
      setTrades(response.data.data);
    } catch (error) {
      console.error('Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = (date: string) => {
    setSelectedDate(date);
  };

  const handleSync = async () => {
    if (!selectedAccount) return;
    try {
      await axios.post(`/api/accounts/${selectedAccount}/sync`, { user_id: userId });
      fetchDailySummaries();
      if (selectedDate) {
        fetchTrades();
      }
    } catch (error) {
      console.error('Error syncing:', error);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Trading Journal</h1>
        <button onClick={handleSync} className="sync-btn">Sync Now</button>
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
            onDateClick={handleDateClick}
          />

          {selectedDate && (
            <div className="trades-panel">
              <h2>Trades for {selectedDate}</h2>
              <TradeList trades={trades} loading={loading} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
