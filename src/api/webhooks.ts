import { Router, Request, Response } from 'express';
import { WebhookService, WebhookPayload } from '../services/webhookService';

const router = Router();
const webhookService = new WebhookService();

// Fyres webhook endpoint
router.post('/fyres', async (req: Request, res: Response) => {
  try {
    const { account_id, ...payload } = req.body;

    // Verify webhook signature (implement based on Fyres documentation)
    const signature = req.headers['x-fyres-signature'];
    if (!verifySignature(payload, signature as string)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const webhookPayload: WebhookPayload = {
      ...payload,
      broker: 'fyres'
    };

    await webhookService.processWebhook(webhookPayload, account_id);
    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Fyres webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Zerodha webhook endpoint
router.post('/zerodha', async (req: Request, res: Response) => {
  try {
    const { account_id, ...payload } = req.body;

    const webhookPayload: WebhookPayload = {
      ...payload,
      broker: 'zerodha'
    };

    await webhookService.processWebhook(webhookPayload, account_id);
    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Zerodha webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Lucid webhook endpoint
router.post('/lucid', async (req: Request, res: Response) => {
  try {
    const { account_id, ...payload } = req.body;

    const webhookPayload: WebhookPayload = {
      ...payload,
      broker: 'lucid'
    };

    await webhookService.processWebhook(webhookPayload, account_id);
    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Lucid webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// TradingView webhook endpoint
router.post('/tradingview', async (req: Request, res: Response) => {
  try {
    const { account_id, ...payload } = req.body;

    const webhookPayload: WebhookPayload = {
      ...payload,
      broker: 'tradingview'
    };

    await webhookService.processWebhook(webhookPayload, account_id);
    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('TradingView webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'webhook service healthy' });
});

function verifySignature(payload: any, signature: string): boolean {
  // TODO: Implement signature verification based on Fyres API documentation
  // For now, accept all (implement proper verification in production)
  return true;
}

export default router;
