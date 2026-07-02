# Production Deployment Checklist

## Pre-Deployment (Local)

- [ ] `npm run build` compiles without errors
- [ ] `npm run dev` starts backend (port 5000)
- [ ] Frontend loads at `localhost:3000`
- [ ] Auth works (register → login → token)
- [ ] `/api/accounts` endpoint responds with auth
- [ ] Git repository is clean (`git status`)
- [ ] All changes committed (`git log -1`)

## Railway Backend Setup

1. **Create Railway Project**
   - [ ] Visit https://railway.app/new
   - [ ] Connect GitHub repo
   - [ ] Select trading-journal repository

2. **Add PostgreSQL Database**
   - [ ] Click "+ New Service" in Railway
   - [ ] Select "PostgreSQL" plugin
   - [ ] Wait for database provisioning

3. **Set Environment Variables**
   - [ ] DATABASE_URL (auto-provided by Railway PostgreSQL plugin)
   - [ ] JWT_SECRET (generate: `openssl rand -base64 32`)
   - [ ] NODE_ENV=production
   - [ ] PORT=5000

4. **Deploy Backend**
   - [ ] Push code to GitHub: `git push origin main`
   - [ ] Railway auto-deploys
   - [ ] Check Railway logs for errors
   - [ ] Get backend URL from Railway (e.g., `https://trading-journal-prod-xxx.railway.app`)

5. **Initialize Database**
   - [ ] Connect to Railway container
   - [ ] Run seed script if exists: `railway run npm run seed`
   - [ ] Or manually initialize: `railway run npm run build`
   - [ ] Verify 19 tables created in PostgreSQL

## Vercel Frontend Setup

1. **Configure API URL**
   - [ ] Get Railway backend URL from step above
   - [ ] Update `client/.env.production`:
     ```
     VITE_API_URL=https://your-railway-backend.railway.app
     ```

2. **Deploy to Vercel**
   - [ ] Visit https://vercel.com/new
   - [ ] Import trading-journal repo
   - [ ] Framework: "Other" (Vite)
   - [ ] Root Directory: `client`
   - [ ] Build Command: `npm run build`
   - [ ] Output Directory: `dist`

3. **Set Vercel Environment Variables**
   - [ ] VITE_API_URL = Railway backend URL

4. **Deploy**
   - [ ] Click "Deploy"
   - [ ] Wait for build to complete
   - [ ] Get frontend URL (e.g., `https://trading-journal-prod.vercel.app`)

## Post-Deployment Testing

- [ ] Frontend loads at Vercel URL
- [ ] Can register new user
- [ ] Can login with credentials
- [ ] `/api/accounts` returns data with auth token
- [ ] Can create test account
- [ ] Can upload test trade
- [ ] Calendar view loads
- [ ] Analytics dashboard displays

## Working Endpoints to Test First

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/register` | POST | Create account |
| `/api/auth/login` | POST | Get JWT token |
| `/api/accounts` | GET | List accounts |
| `/api/accounts` | POST | Create account |
| `/api/trades` | GET | List trades |
| `/api/trades` | POST | Add trade |

## Known Limitations

- **Insights/Risk/Social/Automation endpoints** return 404 (routing issue)
- See DEPLOYMENT.md "Known Issues" section for workarounds
- Stages 1-4 fully functional: Auth, Accounts, Trades, Strategies
- Stages 5-10 built but need routing debug: Social, Automation, Portfolio, Tax, Webhooks, Dashboard

## Rollback Plan

If deployment fails:

1. **Backend**: Railway → Deployments → Select previous version → "Restart"
2. **Frontend**: Vercel → Deployments → Select previous → Click "Restore"
3. Git: No changes needed, just revert via Railway/Vercel UI

## Monitoring Post-Deploy

1. **Railway**
   - [ ] Dashboard → Logs tab (check for errors)
   - [ ] Monitor database connections
   - [ ] Set up alerts for memory/CPU

2. **Vercel**
   - [ ] Analytics tab (check error rates)
   - [ ] Function logs (runtime errors)

3. **Status Page** (optional)
   - [ ] Set up StatusPage.io
   - [ ] Configure uptime monitoring
   - [ ] Alert on 5xx errors

## Security Post-Deploy

- [ ] CORS whitelist updated to production domain
- [ ] JWT_SECRET is strong (>32 chars)
- [ ] Database password is unique
- [ ] Rate limiting configured (optional)
- [ ] API keys not in git history
- [ ] HTTPS enforced (automatic on Railway/Vercel)
- [ ] Webhook signatures verified (see webhooks.ts)

## Next Steps (Post-Launch)

1. Debug `/api/insights`, `/api/risk`, `/api/social`, `/api/automation` routing issue
2. Add custom domains (api.yourdomain.com, yourdomain.com)
3. Set up automated backups
4. Configure monitoring/alerts
5. Add Google/Apple OAuth (optional)
6. Enable mobile app deployment (Expo)
