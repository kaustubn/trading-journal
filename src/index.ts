import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import cors from 'cors';
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
import exportRouter from './api/export';
import webhooksRouter from './api/webhooks';
import notificationsRouter from './api/notifications';
import backtestRouter from './api/backtest';
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

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5000'],
  credentials: true
}));
app.use(express.json({ limit: '25mb' })); // CSV imports can be several MB
app.use(express.text({ type: 'text/*', limit: '25mb' })); // TradingView alerts often POST text/plain
app.use('/api', rateLimit(100, 60 * 1000)); // 100 requests per minute

// Serve frontend static files
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
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
app.use('/api/export', verifyToken, exportRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/notifications', verifyToken, notificationsRouter);
app.use('/api/backtest', verifyToken, backtestRouter);
app.use('/api/strategies', verifyToken, strategiesRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
