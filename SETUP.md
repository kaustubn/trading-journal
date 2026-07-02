# Trading Journal - Setup Guide

Multi-account trading journal with real-time sync from Zerodha Kite, Lucid prop firms, and TradingView paper trading. Track trades, journal ideas, and analyze performance.

## Requirements

- Node.js 18+
- PostgreSQL 13+
- npm or yarn

## Backend Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your database URL and JWT secret.

3. **Initialize database**
   ```bash
   npm run dev
   ```
   The server will auto-create tables on first run.

4. **Start server**
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:5000`

## Frontend Setup

1. **Install dependencies**
   ```bash
   cd client
   npm install
   ```

2. **Start dev server**
   ```bash
   npm run dev
   ```
   Frontend runs on `http://localhost:3000`

## API Endpoints

### Trades
- `GET /api/trades?date=2026-07-01&account_id=1&user_id=1` - Get trades by date/account
- `GET /api/daily-summary?month=7&year=2026&user_id=1` - Get daily P&L for calendar
- `POST /api/trades` - Create manual trade entry
- `PUT /api/trades/:id` - Update trade notes/setup_tag

### Accounts
- `GET /api/accounts` - List user accounts
- `POST /api/accounts` - Link new broker account
- `POST /api/accounts/:id/sync` - Manual sync trigger
- `GET /api/accounts/:id/stats` - Get account statistics

### Ideas
- `GET /api/ideas` - Get all user ideas
- `GET /api/ideas/date/:date` - Get ideas for specific date
- `POST /api/ideas` - Create new idea
- `PUT /api/ideas/:id` - Update idea
- `DELETE /api/ideas/:id` - Delete idea

## Quick Start with Demo Data

```bash
npm run seed
```

This creates a demo user with sample trades from Zerodha and Lucid accounts.
- **Email:** demo@example.com
- **Password:** demo123

Then run the frontend and you'll see calendar filled with demo trades.

## Linking Broker Accounts

### Zerodha Kite
1. Get API credentials from Zerodha Console
2. POST to `/api/accounts` with:
   ```json
   {
     "user_id": 1,
     "broker": "zerodha",
     "account_number": "XX1234",
     "account_name": "My Zerodha",
     "api_key": "your_api_key",
     "api_secret": "your_api_secret",
     "access_token": "your_access_token"
   }
   ```

### Lucid
1. Get API key from Lucid Trading dashboard
2. POST to `/api/accounts` with:
   ```json
   {
     "broker": "lucid",
     "account_number": "lucid_account_id",
     "account_name": "My Lucid",
     "api_key": "your_lucid_api_key"
   }
   ```

### TradingView Paper Trading
1. Get API token from TradingView
2. Find your paper account ID in the dashboard
3. POST to `/api/accounts` with:
   ```json
   {
     "broker": "tradingview",
     "account_number": "your_paper_account_id",
     "account_name": "My TradingView Paper",
     "api_key": "your_tradingview_token",
     "api_secret": "your_paper_account_id"
   }
   ```

## Architecture

- **Backend**: Express + TypeScript, PostgreSQL
- **Frontend**: React + Vite, TanStack Query
- **Real-time Sync**: Adapter pattern for pluggable brokers
- **Calendar**: Color-coded daily P&L view
- **Trade Detail**: Notes, setup tags, full trade history

## Features

✅ Multi-account support (Zerodha, Lucid, TradingView)
✅ Real-time trade sync from brokers
✅ Calendar view with color-coded daily P&L
✅ Trade detail panel (entry/exit/P&L)
✅ Manual trade entry
✅ Trade journaling (setup tags, notes)
✅ **Ideas section** — capture trading ideas with symbol, price level, status tracking
✅ Account statistics
✅ User auth (register/login)
✅ Demo data seeding for testing

## To-Do

- [x] Auth system (register, login, JWT)
- [x] Ideas tracking section
- [x] TradingView paper trading support
- [ ] CSV export
- [ ] Advanced analytics (win rate, profit factor, Sharpe ratio)
- [ ] Trade replay/charts
- [ ] Webhook real-time updates
- [ ] Mobile app
- [ ] Email notifications for ideas
- [ ] Backtesting module

## Development

Backend auto-compiles with TypeScript. Frontend hot-reloads with Vite.

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend (in client/)
npm run dev
```

Visit `http://localhost:3000`
