# Fyres Account Integration Guide

Fyres is an Indian prop trading firm specializing in intraday NSE/BSE trading. This guide explains how to connect your Fyres account to the Trading Journal.

## Getting Fyres API Credentials

1. **Log in to Fyres Dashboard**
   - Go to https://app.fyres.in
   - Login with your Fyres account credentials

2. **Generate API Key**
   - Navigate to Settings → API Management
   - Click "Generate New API Key"
   - Save the API Key (you'll need this)

3. **Generate API Secret**
   - In the same section, click "Generate New Secret"
   - Save the API Secret (you'll need this)
   - ⚠️ Store these securely - they provide full account access

## Connecting Fyres to Trading Journal

### Using API Endpoint

Send a POST request to `/api/accounts`:

```json
{
  "broker": "fyres",
  "account_number": "YOUR_FYRES_ACCOUNT_ID",
  "account_name": "My Fyres Account",
  "api_key": "YOUR_API_KEY",
  "api_secret": "YOUR_API_SECRET"
}
```

**Example using curl:**

```bash
curl -X POST http://localhost:5000/api/accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "broker": "fyres",
    "account_number": "FYRES123",
    "account_name": "My Fyres Account",
    "api_key": "your_api_key_here",
    "api_secret": "your_api_secret_here"
  }'
```

## What Gets Synced

Once connected, Trading Journal will sync:

- **Closed Trades**: Entry/exit times, prices, quantities, P&L
- **Daily Summary**: Total P&L, number of trades, wins/losses per day
- **Account Balance**: Current balance and margin available
- **Open Positions**: Live position details (if still open)

## Sync Frequency

- **Manual Sync**: Click "Sync Now" button in the app
- **Auto Sync**: Every hour (configurable)
- **Real-time**: Webhook support (requires Fyres webhook endpoint setup)

## Supported Instruments

- NSE Equities (all stocks)
- BSE Equities (all stocks)
- Index Futures (Nifty, Banknifty, Finnifty, Midcpnifty)
- Stock Options
- Intraday Multi-leg strategies

## Troubleshooting

### "Invalid API Key"
- Verify API key is correct (no extra spaces)
- Check API key hasn't been revoked in Fyres dashboard

### "No Trades Found"
- Ensure trades are marked as "Closed" in Fyres
- Check date range (default is last 7 days)
- Verify account has trading activity in that period

### "Connection Timeout"
- Check internet connection
- Fyres API might be temporarily unavailable
- Try manual sync again

## Data Retention

- Trades are stored indefinitely in Trading Journal
- Synced data updates automatically on re-sync
- P&L calculations are real-time from trade data

## API Rate Limits

Fyres API allows:
- 100 requests per minute
- 10,000 trades per sync
- Daily sync for multiple accounts is staggered

## Security Notes

- API credentials are encrypted in database
- Never share API keys or secrets
- Consider using a separate Fyres account for API access with limited permissions if available
- Revoke API keys immediately if compromised

## Support

For Fyres API issues: support@fyres.in
For Trading Journal issues: Open issue in GitHub
