import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import automationService from '../services/automationService';

const router = Router();

// Apply auth to all routes (except webhooks which have their own auth)
router.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/webhook')) {
    next();
  } else {
    verifyToken(req, res, next);
  }
});

// Create bot
router.post('/bots', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(req.query.account_id as string);
    const { name, strategy_id, config } = req.body;

    const bot = await automationService.createBot(account_id, name, strategy_id, config);
    res.json({ data: bot });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Get bots
router.get('/bots', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(req.query.account_id as string);
    const bots = await automationService.getBots(account_id);
    res.json({ data: bots });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get bot details
router.get('/bots/:bot_id', async (req: Request, res: Response) => {
  try {
    const bot_id = parseInt(String(req.params.bot_id));
    const bot = await automationService.getBot(bot_id);
    res.json({ data: bot });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

// Update bot status
router.patch('/bots/:bot_id/status', async (req: Request, res: Response) => {
  try {
    const bot_id = parseInt(String(req.params.bot_id));
    const { enabled } = req.body;

    const bot = await automationService.updateBotStatus(bot_id, enabled);
    res.json({ data: bot });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Get open positions
router.get('/positions', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(req.query.account_id as string);
    const positions = await automationService.getOpenPositions(account_id);
    res.json({ data: positions });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Close position
router.post('/positions/:position_id/close', async (req: Request, res: Response) => {
  try {
    const position_id = parseInt(String(req.params.position_id));
    const position = await automationService.closePosition(position_id);
    res.json({ data: position });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Webhook: process trading signal (no auth required for webhook)
router.post('/webhook/signal', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-webhook-signature'] as string;
    const botWebhookId = req.headers['x-bot-id'] as string;

    if (!signature || !botWebhookId) {
      return res.status(401).json({ error: 'Missing webhook headers' });
    }

    // Get bot by webhook ID
    const bots = await automationService.getBots(1); // Placeholder
    const bot = bots.find(b => b.webhook_url.includes(botWebhookId));

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Verify signature
    const payload = JSON.stringify(req.body);
    if (!automationService.verifyWebhookSignature(payload, signature, bot.webhook_secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Process signal
    const order = await automationService.createOrder(bot.id, req.body.signal);
    res.json({ success: true, order });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
