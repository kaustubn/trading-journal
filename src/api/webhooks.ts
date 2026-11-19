import { Router, Request, Response } from 'express';
import { WebhookService, WebhookPayload } from '../services/webhookService';
import { verifyHmac } from '../security/webhookSignature';

// Broker webhooks (Fyers / Zerodha / Lucid / TradingView relays).
//
// Security: these routes have no login token (a broker can't log in), so every request must be signed:
//   header  X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the exact raw body>
//   secret  env <BROKER>_WEBHOOK_SECRET (e.g. LUCID_WEBHOOK_SECRET), or BROKER_WEBHOOK_SECRET for all brokers.
// With no secret configured the endpoint is switched off (503). Unsigned or badly signed requests get 401.
// (Before 2026-11-19 the signature check was a stub that accepted everything.)

const router = Router();
const webhookService = new WebhookService();

type Broker = WebhookPayload['broker'];

function secretFor(broker: Broker): string | undefined {
  return process.env[`${broker.toUpperCase()}_WEBHOOK_SECRET`] || process.env.BROKER_WEBHOOK_SECRET || undefined;
}

function brokerHook(broker: Broker) {
  return async (req: Request, res: Response) => {
    const secret = secretFor(broker);
    if (!secret) return res.status(503).json({ error: 'Broker webhooks are disabled' });

    const signature = req.headers['x-webhook-signature'] || req.headers[`x-${broker}-signature`];
    if (!verifyHmac((req as any).rawBody, signature as string | string[] | undefined, secret)) {
      console.warn(`[webhook] rejected unsigned/invalid ${broker} webhook from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || typeof body.account_id !== 'string' || !body.data || typeof body.data !== 'object'
      || !['trade_closed', 'trade_opened', 'position_update'].includes(body.event)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    try {
      const { account_id, ...payload } = body;
      await webhookService.processWebhook({ ...payload, broker } as WebhookPayload, account_id);
      res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      console.error(`${broker} webhook error:`, error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  };
}

router.post('/fyres', brokerHook('fyres'));
router.post('/zerodha', brokerHook('zerodha'));
router.post('/lucid', brokerHook('lucid'));
router.post('/tradingview', brokerHook('tradingview'));

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'webhook service healthy' });
});

export default router;
