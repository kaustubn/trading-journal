# Trading Journal - Multi-Broker Trading Tracker

**Complete trading journal application for Indian intraday traders.**

Trade on Zerodha, Fyres, Lucid, and TradingView - journal all trades in one place with real-time sync, analytics, webhooks, and backtesting.

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js 18+
- PostgreSQL 13+
- npm or yarn

### Setup (5 minutes)

```bash
# Clone and install
git clone <repo>
cd trading-journal
npm install

# Backend setup
cp .env.example .env
# Edit .env with PostgreSQL URL

# Start backend (Terminal 1)
npm run dev

# Frontend setup (Terminal 2)
cd client
npm install
npm run dev

# Login
# Email: demo@example.com
# Password: demo123
```

**Demo data included** - 7 days of sample trades seeded automatically.

---

## 📊 Features

### ✅ Core Features
- **Multi-Account Support**: Zerodha, Fyres, Lucid, TradingView
- **Real-time Sync**: Webhook-based trade updates
- **Trading Ideas**: Capture ideas with symbol, price level, status
- **Calendar View**: Color-coded daily P&L visualization
- **Trade Journaling**: Setup tags, notes, detailed trade analysis

### ✅ Analytics
- **Performance Dashboard**: Win rate, profit factor, best/worst trades
- **Monthly Breakdown**: Month-over-month performance
- **Daily Stats**: 30-day performance tracking
- **Drawdown Analysis**: Peak-to-trough decline tracking

### ✅ Advanced Features
- **CSV Export**: Trades and summaries for Excel analysis
- **Real-time Webhooks**: Live trade sync from brokers
- **Email Alerts**: Daily summaries, weekly reports, P&L thresholds
- **Slack Notifications**: Real-time trade updates
- **Backtesting**: Replay trades, compare strategies
- **Charts**: Interactive performance visualization

### ✅ Production Ready
- Deployed on Railway (backend) + Vercel (frontend)
- PostgreSQL with optimized indexes
- JWT authentication with secure token handling
- CORS configured for security
- Mobile-responsive design

---

## 🏗️ Architecture

```
Frontend (Vite + React + TypeScript)
      ↓ (HTTPS)
API Gateway (Express + Node.js)
      ↓
PostgreSQL Database
      ↓
Broker APIs (Fyres, Zerodha, Lucid, TradingView)
      ↓ (Webhooks)
Real-time Trade Updates
```

---

## 🔧 Configuration

### Adding Fyres Account

```bash
curl -X POST http://localhost:5000/api/accounts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "broker": "fyres",
    "account_number": "FYRES123",
    "account_name": "My Fyres Account",
    "api_key": "your_api_key",
    "api_secret": "your_api_secret"
  }'
```

### Setting Up Webhooks

1. Get webhook URL: `https://yourdomain.com/api/webhooks/fyres`
2. Configure in Fyres dashboard
3. Trades sync automatically as they close

### Email Notifications

1. Go to Settings → Notifications
2. Toggle "Daily Email" or "Weekly Report"
3. Add Slack webhook (optional)
4. Set P&L alert threshold
5. Test to verify

---

## 📱 Responsive Design

| Device | Layout |
|--------|--------|
| Desktop (1024px+) | Sidebar + Calendar + Analytics |
| Tablet (768px-1024px) | Narrower sidebar with content |
| Mobile (480px-768px) | Stacked layout, touch-optimized |
| Small Mobile (<480px) | Minimal padding, scroll-friendly |

---

## 🌐 Deployment

### Automatic Deploy (3 steps)

1. **Backend on Railway**
   ```
   Connect GitHub repo → Select branch → Deploy
   ```
   - Auto-detects Node.js
   - PostgreSQL provisioned automatically
   - Environment variables configured

2. **Frontend on Vercel**
   ```
   Import GitHub → Select /client directory → Deploy
   ```
   - Auto-builds on git push
   - Global CDN cache
   - Automatic HTTPS

3. **Set Environment Variables**
   ```
   Railway: DATABASE_URL, JWT_SECRET
   Vercel: VITE_API_URL=https://api.yourdomain.com
   ```

See `DEPLOYMENT.md` for detailed steps.

---

## 📊 Database Schema

| Table | Purpose |
|-------|---------|
| users | Authentication |
| accounts | Broker accounts |
| broker_credentials | Encrypted API keys |
| trades | Trade records |
| daily_summaries | Aggregated daily P&L |
| ideas | Trading ideas journal |
| notification_preferences | Alert settings |
| backtest_results | Strategy backtests |

---

## 🔐 Security

- JWT tokens with 7-day expiry
- API keys encrypted in database
- CORS restricted to configured origins
- Password hashing with bcrypt
- SQL injection prevention (parameterized queries)
- Webhook signature verification (ready)

---

## 📈 API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Get JWT token
- `GET /api/auth/me` - Verify token

### Trades
- `GET /api/trades` - Query trades
- `PUT /api/trades/:id` - Update trade notes
- `GET /api/daily-summary` - Calendar data

### Analytics
- `GET /api/analytics/stats/:account_id` - Overall stats
- `GET /api/analytics/monthly/:account_id` - Monthly data
- `GET /api/analytics/daily/:account_id` - Daily data

### Backtesting
- `POST /api/backtest/run` - Execute backtest
- `GET /api/backtest/results/:account_id` - View results
- `POST /api/backtest/compare` - Compare strategies

### Export
- `GET /api/export/trades/csv/:account_id` - Download CSV
- `GET /api/export/summary/csv/:account_id` - Summary CSV

### Real-time
- `POST /api/webhooks/fyres` - Receive trades
- `POST /api/webhooks/zerodha` - Zerodha trades
- `POST /api/webhooks/lucid` - Lucid trades

Full documentation: See `FEATURES_COMPLETE.md`

---

## 📚 Documentation

| File | Purpose |
|------|---------|
| `SETUP.md` | Local development guide |
| `DEPLOYMENT.md` | Production deployment guide |
| `FYRES_SETUP.md` | Fyres API integration |
| `FEATURES_COMPLETE.md` | Complete feature reference |

---

## 🧪 Testing

```bash
# Run demo
npm run seed        # Populate demo data
npm run dev         # Start backend
cd client && npm run dev  # Start frontend

# Login with:
# Email: demo@example.com
# Password: demo123

# Try features:
# - View calendar with 7 days of sample trades
# - Click date to see trade details
# - Filter by account (Zerodha, Lucid)
# - View Analytics dashboard
# - Export trades as CSV
# - Run backtest
```

---

## 💡 Use Cases

### For Intraday Traders
- Track every trade across multiple accounts
- Analyze setups that work
- Identify best trading hours
- Monitor P&L in real-time

### For Prop Traders
- Backtest trading strategies
- Compare performance periods
- Track compliance with risk limits
- Export for tax reporting

### For Swing Traders
- Journal trade ideas before execution
- Track win rate by setup type
- Monitor drawdown curves
- Generate weekly performance reports

---

## 🎯 Next Steps

1. **Local Setup**: Follow SETUP.md for local development
2. **Add Account**: Connect your Fyres/Zerodha account
3. **Enable Webhooks**: Real-time trade sync
4. **Deploy**: Railway + Vercel (5 minutes)
5. **Automate**: Daily emails, Slack alerts, backtests

---

## 📞 Support

**Documentation**: 
- `SETUP.md` - Getting started
- `DEPLOYMENT.md` - Going live
- `FYRES_SETUP.md` - Broker integration
- `FEATURES_COMPLETE.md` - Feature reference

**Issues**:
- Check logs: `npm run dev` shows backend logs
- Verify .env configuration
- Ensure PostgreSQL is running
- Check frontend console (F12)

---

## 📄 License

MIT - Use for personal trading use

---

## ✨ Credits

Built with:
- React, Vite, TypeScript (Frontend)
- Node.js, Express, PostgreSQL (Backend)
- Railway, Vercel (Deployment)
- TradingView, Zerodha, Fyres APIs

---

**Status**: ✅ Production Ready

**Current Version**: 1.0.0 - All 6 Stages Complete

Start trading smarter. Track everything. Trade better.
