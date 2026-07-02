# Deployment Guide

Deploy Trading Journal to production using Railway (backend) and Vercel (frontend).

## Prerequisites

- Railway account (https://railway.app)
- Vercel account (https://vercel.com)
- PostgreSQL database (Railway provides this)
- Git repository (GitHub/GitLab/Bitbucket)

## Backend Deployment (Railway)

### Step 1: Connect Repository to Railway

1. Go to https://railway.app/new
2. Select "GitHub" and authorize Railway
3. Select your trading-journal repository
4. Railway will auto-detect Node.js project

### Step 2: Add PostgreSQL Plugin

1. In Railway dashboard, click "+ New Service"
2. Select "PostgreSQL"
3. Railway will provision a database

### Step 3: Configure Environment Variables

1. In Railway project settings, go to "Environment"
2. Add variables:

```
DATABASE_URL=postgresql://postgres:password@host:5432/trading_journal
JWT_SECRET=generate_a_long_random_string_here
NODE_ENV=production
PORT=5000
```

### Step 4: Deploy

1. Push code to GitHub
2. Railway auto-deploys on push
3. Check logs: Railway dashboard → Deployments → View logs

### Step 5: Initialize Database

Once backend is running:

```bash
# SSH into Railway container
railway run npm run seed

# Or manually execute DB init
railway run npm run build
```

## Frontend Deployment (Vercel)

### Step 1: Configure API URL

Update `client/src/main.tsx`:

```typescript
axios.defaults.baseURL = process.env.VITE_API_URL || 'https://your-railway-backend.railway.app'
```

### Step 2: Connect to Vercel

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Select "Other" for framework (Vite)
4. Build command: `npm run build`
5. Output directory: `client/dist`
6. Root directory: `client`

### Step 3: Set Environment Variables

In Vercel project settings → Environment Variables:

```
VITE_API_URL=https://your-railway-backend.railway.app
```

### Step 4: Deploy

1. Click "Deploy"
2. Vercel will build and deploy automatically
3. Your app is live at `your-project.vercel.app`

## Domain Setup

### Custom Domain for Backend (Railway)

1. In Railway project settings → Networking
2. Add custom domain: `api.yourdomain.com`
3. Update DNS CNAME to Railway-provided endpoint

### Custom Domain for Frontend (Vercel)

1. In Vercel project settings → Domains
2. Add custom domain: `yourdomain.com`
3. Follow DNS setup instructions

## Database Migrations

If you need to run migrations in production:

```bash
# SSH into Railway
railway run psql $DATABASE_URL < migration.sql
```

## Monitoring

### Railway Logs

- Dashboard → Deployments → Logs tab
- Check for errors in real-time
- Monitor database connections

### Vercel Logs

- Vercel dashboard → Function logs
- Check build logs for compilation errors

## Backup & Restore

### PostgreSQL Backup (Railway)

```bash
# Backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

## Performance Optimization

1. **Enable Caching**: Set cache headers in Express
2. **Database Indexing**: Indexes already created in schema
3. **CDN**: Vercel includes global CDN
4. **Database Connection Pooling**: Configured in pg pool

## Troubleshooting

### "Database connection failed"
- Check DATABASE_URL is set correctly
- Verify PostgreSQL is running
- Check network connectivity in Railway

### "Frontend can't reach backend"
- Verify VITE_API_URL points to correct Railway URL
- Check CORS configuration in Express
- Ensure webhooks endpoint is open (no auth required)

### "Build fails"
- Check build logs in Railway/Vercel
- Ensure all dependencies are installed
- Run `npm run build` locally to test

## Security Checklist

- [ ] JWT_SECRET is long random string (>32 chars)
- [ ] Database password is strong
- [ ] Environment variables are not in git history
- [ ] CORS is restricted to your domains
- [ ] Rate limiting is configured (optional)
- [ ] API keys are encrypted
- [ ] Webhooks verify signatures (see webhooks.ts)

## Next Steps

1. Set up automated backups (Railway → Backup)
2. Configure monitoring/alerts
3. Set up CI/CD for automatic deployments
4. Add custom domain
5. Enable HTTPS (automatic on Railway/Vercel)
