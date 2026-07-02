import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initializeDB } from './db';
import { verifyToken } from './middleware/auth';
import authRouter from './api/auth';
import tradesRouter from './api/trades';
import accountsRouter from './api/accounts';
import ideasRouter from './api/ideas';
import analyticsRouter from './api/analytics';
import exportRouter from './api/export';
import webhooksRouter from './api/webhooks';
import notificationsRouter from './api/notifications';
import backtestRouter from './api/backtest';
import strategiesRouter from './api/strategies';
import insightsRouter from './api/insights';
import riskRouter from './api/risk';
import socialRouter from './api/social';
import automationRouter from './api/automation';
import advancedRouter from './api/advanced';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5000'],
  credentials: true
}));
app.use(express.json());

// Routes - auth middleware moved into individual routers
app.use('/api/auth', authRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/risk', riskRouter);
app.use('/api/analytics', verifyToken, analyticsRouter);
app.use('/api/export', verifyToken, exportRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/notifications', verifyToken, notificationsRouter);
app.use('/api/backtest', verifyToken, backtestRouter);
app.use('/api/strategies', verifyToken, strategiesRouter);
app.use('/api/social', socialRouter);
app.use('/api/automation', automationRouter);
app.use('/api/webhook', automationRouter);
app.use('/api/advanced', advancedRouter);
app.use('/api', verifyToken, tradesRouter);
app.use('/api', verifyToken, accountsRouter);
app.use('/api', ideasRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
