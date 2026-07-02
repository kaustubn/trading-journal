import { Router, Request, Response } from 'express';
import { portfolioService, taxService, webhookService, dashboardService } from '../services/advancedService';

const router = Router();

// STAGE 7: Portfolio
router.get('/portfolio', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const snapshot = await portfolioService.getPortfolioSnapshot(user_id);
    await portfolioService.saveSnapshot(user_id, snapshot);
    res.json({ data: snapshot });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// STAGE 8: Tax
router.post('/tax/report/:fiscal_year', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const fiscal_year = parseInt(String(req.params.fiscal_year));
    const report = await taxService.generateTaxReport(user_id, fiscal_year);
    res.json({ data: report });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/tax/records', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const records = await taxService.getTaxRecords(user_id);
    res.json({ data: records });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// STAGE 9: Webhooks
router.post('/webhooks/subscribe', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const { service, webhook_url, events } = req.body;
    const sub = await webhookService.subscribe(user_id, service, webhook_url, events);
    res.json({ data: sub });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/webhooks/subscriptions', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const subs = await webhookService.getSubscriptions(user_id);
    res.json({ data: subs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// STAGE 10: Dashboard
router.get('/dashboard/alerts', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const alerts = await dashboardService.getAlerts(user_id, limit);
    res.json({ data: alerts });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/dashboard/alerts/:alert_id/read', async (req: Request, res: Response) => {
  try {
    const alert_id = parseInt(String(req.params.alert_id));
    await dashboardService.markAlertRead(alert_id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/dashboard/metrics', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const metrics = await dashboardService.getLiveMetrics(user_id);
    res.json({ data: metrics });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
