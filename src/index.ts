import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDB } from './db';
import tradesRouter from './api/trades';
import accountsRouter from './api/accounts';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', tradesRouter);
app.use('/api', accountsRouter);

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
