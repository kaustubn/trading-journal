import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { initializeDB } from './db';
import { verifyToken } from './middleware/auth';
import rateLimit from './middleware/rateLimit';
import authRouter from './api/auth';
import tradesRouter from './api/trades';
import accountsRouter from './api/accounts';
import attemptsRouter from './api/attempts';
import coachRouter from './api/coach';
import emotionsRouter from './api/emotions';
import optionsRouter from './api/options';
import ideasRouter from './api/ideas';
import analyticsRouter from './api/analytics';
import strategiesRouter from './api/strategies';
import stages5to10Router from './api/stages5to10';
import adminRouter from './api/admin';
import tradingViewRouter from './api/tradingview';
import importRouter from './api/import';
import setupsRouter from './api/setups';
import overviewRouter from './api/overview';
import breakdownRouter from './api/breakdown';
import notesRouter from './api/notes';
import diagnosisRouter from './api/diagnosis';
import disciplineRouter from './api/discipline';
import barsRouter from './api/bars';
import coachReplayRouter from './api/coachReplay';
import chartSettingsRouter from './api/chartSettings';
import chartDrawingsRouter from './api/chartDrawings';
import mentorRouter from './api/mentor';
import replayRouter from './api/replay';
import patternsRouter from './api/patterns';
import chartTradesRouter from './api/chartTrades';
import btSessionsRouter from './api/btSessions';

// Fail fast: never run with a missing or weak token-signing secret
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET is missing or shorter than 32 characters. Refusing to start.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;
app.disable('x-powered-by');

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5000'],
  credentials: true
}));
// Security headers (CSP, HSTS, no sniffing, no framing by other sites, ...)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://s3.tradingview.com'], // TradingView chart widget loader
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://*.tradingview.com', 'https://*.tradingview-widget.com'],
      workerSrc: ["'self'", 'blob:'],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 15552000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Gzip responses (the trade list for a big backtest account is ~18 MB of JSON uncompressed)
app.use(compression({ threshold: 1024 }));

// Request bodies: small by default; large only where files are uploaded.
app.use('/api/import', express.json({ limit: '25mb' })); // CSV imports can be several MB
app.use('/api/bars/upload', express.json({ limit: '25mb' })); // bar CSV uploads (admin)
app.use('/api/notes', express.json({ limit: '12mb' })); // daily notes carry a screenshot
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/*', limit: '256kb' })); // TradingView alerts often POST text/plain
// Render sits in front of the app: trust its proxy so req.ip is the visitor, not the proxy
// (otherwise every visitor shares one rate-limit bucket)
app.set('trust proxy', 1);
// 600 requests per minute per visitor: one dashboard load alone makes ~60-90 requests
app.use('/api', rateLimit(600, 60 * 1000));

// Serve frontend static files
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// Public health check (no login needed)
app.get('/api/health', (req, res) => { res.json({ status: 'ok' }); });

// Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/bt-sessions', btSessionsRouter); // own auth (beacon carries its token in the body); keep above the '/api' mounts
app.use('/api/bars', barsRouter); // own auth (admin only); keep above the '/api' mounts
app.use('/api/coach/replay', coachReplayRouter); // own auth (admin only)
app.use('/api/chart/settings', chartSettingsRouter);
app.use('/api/chart/drawings', chartDrawingsRouter);
app.use('/api/mentor', mentorRouter); // own auth (admin only); keep above the '/api' mounts
app.use('/api/replay', replayRouter);
app.use('/api/patterns', patternsRouter);
app.use('/api/chart/trade', chartTradesRouter);
app.use('/api', tradingViewRouter);
app.use('/api', verifyToken, tradesRouter);
app.use('/api', verifyToken, accountsRouter);
app.use('/api', verifyToken, attemptsRouter);
app.use('/api', verifyToken, coachRouter);
app.use('/api', verifyToken, emotionsRouter);
app.use('/api', verifyToken, optionsRouter);
app.use('/api', ideasRouter); // ideas router has own verifyToken on routes
app.use('/api', verifyToken, importRouter);
app.use('/api', verifyToken, setupsRouter);
app.use('/api', verifyToken, overviewRouter);
app.use('/api', verifyToken, breakdownRouter);
app.use('/api', verifyToken, notesRouter);
app.use('/api', verifyToken, diagnosisRouter);
app.use('/api', verifyToken, disciplineRouter);
app.use('/api', stages5to10Router);
app.use('/api/analytics', verifyToken, analyticsRouter);
app.use('/api/strategies', verifyToken, strategiesRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Unknown API paths: a real 404, not the app page
app.use('/api', (req, res) => { res.status(404).json({ error: 'Not found' }); });

// Last-resort error handler: log the detail, never send it to the browser
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error('[error]', req.method, req.path, err);
  res.status(500).json({ error: 'Server error' });
});

// SPA fallback - serve index.html for all non-API routes
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Initialize and start
async function start() {
  try {
    await initializeDB();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
