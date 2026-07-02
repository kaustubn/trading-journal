# Trading Journal - Setup Guide

Multi-account trading journal with real-time sync from Zerodha Kite and Lucid prop firms.

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
- `GET /api/accounts?user_id=1` - List user accounts
- `POST /api/accounts` - Link new broker account
- `POST /api/accounts/:id/sync` - Manual sync trigger
- `GET /api/accounts/:id/stats` - Get account statistics

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
     "user_id": 1,
     "broker": "lucid",
     "account_number": "lucid_account_id",
     "account_name": "My Lucid",
     "api_key": "your_lucid_api_key"
   }
   ```

## Architecture

- **Backend**: Express + TypeScript, PostgreSQL
- **Frontend**: React + Vite, TanStack Query
- **Real-time Sync**: Adapter pattern for pluggable brokers
- **Calendar**: Color-coded daily P&L view
- **Trade Detail**: Notes, setup tags, full trade history

## Features

✅ Multi-account support (Zerodha, Lucid)
✅ Real-time trade sync from brokers
✅ Calendar view with daily P&L
✅ Trade detail panel (entry/exit/P&L)
✅ Manual trade entry
✅ Trade journaling (setup tags, notes)
✅ Account statistics

## To-Do

- [ ] Auth system (register, login, JWT)
- [ ] CSV export
- [ ] Advanced analytics (win rate, profit factor)
- [ ] Trade replay/charts
- [ ] Webhook real-time updates
- [ ] Mobile app

## Development

Backend auto-compiles with TypeScript. Frontend hot-reloads with Vite.

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend (in client/)
npm run dev
```

Visit `http://localhost:3000`
