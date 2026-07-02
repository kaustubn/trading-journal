import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-signature'] as string;
  const timestamp = req.headers['x-timestamp'] as string;
  const service = req.headers['x-service'] as string;

  if (!signature || !timestamp || !service) {
    return res.status(401).json({ error: 'Missing webhook headers' });
  }

  // Prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const signTime = parseInt(timestamp);
  if (Math.abs(now - signTime) > 300) { // 5 minute window
    return res.status(401).json({ error: 'Webhook timestamp expired' });
  }

  // Get webhook secret from environment
  const secret = process.env[`WEBHOOK_SECRET_${service.toUpperCase()}`];
  if (!secret) {
    console.warn(`No webhook secret for service: ${service}`);
    return res.status(401).json({ error: 'Invalid service' });
  }

  // Reconstruct signature
  const body = JSON.stringify(req.body);
  const message = `${timestamp}.${body}`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  if (signature !== computed) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

export function generateWebhookSignature(body: any, secret: string): { signature: string; timestamp: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.${JSON.stringify(body)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return { signature, timestamp };
}

export default verifyWebhookSignature;
