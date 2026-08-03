import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import insightsService from '../services/insightsService';
import riskService from '../services/riskService';
import socialService from '../services/socialService';
import automationService from '../services/automationService';
import { portfolioService, taxService, webhookService, dashboardService } from '../services/advancedService';

const router = Router();

// Auth middleware
router.use(verifyToken);

// === STAGE 3: INSIGHTS ===
router.get('/insights/patterns/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { days = 30 } = req.query;
    const patterns = await insightsService.analyzePatterns(
      parseInt(account_id),
      parseInt(days as string) || 30
    );
    res.json({ success: true, data: patterns });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/insights/grades/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { days = 30 } = req.query;
    const grades = await insightsService.gradeTradeConfluence(
      parseInt(account_id),
      parseInt(days as string) || 30
    );
    res.json({
      success: true,
      data: grades,
      summary: {
        totalTrades: grades.length,
        aGrades: grades.filter(g => g.grade === 'A').length,
        bGrades: grades.filter(g => g.grade === 'B').length,
        cGrades: grades.filter(g => g.grade === 'C').length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/insights/recommendations/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const recommendations = await insightsService.generateRecommendations(parseInt(account_id));
    for (const rec of recommendations) {
      await insightsService.saveInsight(rec);
    }
    res.json({ success: true, data: recommendations });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/insights/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { limit = 10 } = req.query;
    const insights = await insightsService.getInsights(
      parseInt(account_id),
      parseInt(limit as string) || 10
    );
    res.json({ success: true, data: insights });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/insights/calibration/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { days = 60 } = req.query;
    const calibration = await insightsService.calibrateConfidence(
      parseInt(account_id),
      parseInt(days as string) || 60
    );
    res.json({ success: true, data: calibration });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// === STAGE 4: RISK ===
router.get('/risk/metrics/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const metrics = await riskService.getRiskMetrics(parseInt(account_id));
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/risk/position-size/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { riskPercent = 1, stopLossPts = 15 } = req.query;
    const positionSize = await riskService.calculatePositionSize(
      parseInt(account_id),
      parseFloat(riskPercent as string) || 1,
      parseInt(stopLossPts as string) || 15
    );
    res.json({ success: true, data: positionSize });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/risk/kelly/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const kelly = await riskService.calculateKelly(parseInt(account_id));
    res.json({ success: true, data: kelly });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/risk/circuit-breaker/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const status = await riskService.shouldHaltTrading(parseInt(account_id));
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/risk/correlation/:user_id', async (req: Request, res: Response) => {
  try {
    // Security: ignore the URL param — only ever return the authenticated user's own data (prevents IDOR)
    const user_id = req.userId;
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const correlation = await riskService.getAccountCorrelation(user_id);
    res.json({ success: true, data: correlation });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// === STAGE 5: SOCIAL ===
router.post('/social/follow/:user_id', async (req: Request, res: Response) => {
  try {
    const follower_id = req.userId || 0;
    const following_id = parseInt(String(req.params.user_id));
    if (follower_id === following_id) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    const success = await socialService.followUser(follower_id, following_id);
    res.json({ success, message: success ? 'Following' : 'Already following' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/social/follow/:user_id', async (req: Request, res: Response) => {
  try {
    const follower_id = req.userId || 0;
    const following_id = parseInt(String(req.params.user_id));
    const success = await socialService.unfollowUser(follower_id, following_id);
    res.json({ success, message: success ? 'Unfollowed' : 'Not following' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/social/profile/:user_id', async (req: Request, res: Response) => {
  try {
    const requested = parseInt(String(req.params.user_id));
    // Privacy: only allow viewing your own profile (social sharing is not enabled)
    if (requested !== req.userId) return res.status(403).json({ error: 'Forbidden' });
    const profile = await socialService.getUserProfile(requested);
    res.json({ data: { ...profile, isFollowing: false } });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

router.get('/social/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const leaderboard = await socialService.getLeaderboard(limit);
    res.json({ data: leaderboard });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/social/share/:trade_id', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const trade_id = parseInt(String(req.params.trade_id));
    const { caption } = req.body;
    const sharedTrade = await socialService.shareTrade(user_id, trade_id, caption);
    res.json({ data: sharedTrade });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/social/shared/:user_id', async (req: Request, res: Response) => {
  try {
    const user_id = parseInt(String(req.params.user_id));
    // Privacy: only your own shared trades (social feed is not enabled for other users)
    if (user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const trades = await socialService.getSharedTrades(user_id, limit);
    res.json({ data: trades });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/social/feed', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const feed = await socialService.getUserFeed(user_id, limit);
    res.json({ data: feed });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/social/like/:shared_trade_id', async (req: Request, res: Response) => {
  try {
    const shared_trade_id = parseInt(String(req.params.shared_trade_id));
    const likes = await socialService.likeTrade(shared_trade_id);
    res.json({ data: { likes } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/social/like/:shared_trade_id', async (req: Request, res: Response) => {
  try {
    const shared_trade_id = parseInt(String(req.params.shared_trade_id));
    const likes = await socialService.unlikeTrade(shared_trade_id);
    res.json({ data: { likes } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === STAGE 6: AUTOMATION ===
router.post('/automation/bots', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(req.query.account_id as string);
    const { name, strategy_id, config } = req.body;
    const bot = await automationService.createBot(account_id, name, strategy_id, config);
    res.json({ data: bot });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/automation/bots/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(String(req.params.account_id));
    const bots = await automationService.getBots(account_id);
    res.json({ data: bots });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/automation/positions/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(String(req.params.account_id));
    const positions = await automationService.getOpenPositions(account_id);
    res.json({ data: positions });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === STAGE 7-10: ADVANCED ===
router.get('/advanced/portfolio', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const snapshot = await portfolioService.getPortfolioSnapshot(user_id);
    await portfolioService.saveSnapshot(user_id, snapshot);
    res.json({ data: snapshot });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/advanced/tax/report/:fiscal_year', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const fiscal_year = parseInt(String(req.params.fiscal_year));
    const report = await taxService.generateTaxReport(user_id, fiscal_year);
    res.json({ data: report });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/advanced/tax/records', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const records = await taxService.getTaxRecords(user_id);
    res.json({ data: records });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/advanced/webhooks/subscribe', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const { service, webhook_url, events } = req.body;
    const sub = await webhookService.subscribe(user_id, service, webhook_url, events);
    res.json({ data: sub });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/advanced/webhooks/subscriptions', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const subs = await webhookService.getSubscriptions(user_id);
    res.json({ data: subs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/advanced/dashboard/alerts', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const alerts = await dashboardService.getAlerts(user_id, limit);
    res.json({ data: alerts });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/advanced/dashboard/alerts/:alert_id/read', async (req: Request, res: Response) => {
  try {
    const alert_id = parseInt(String(req.params.alert_id));
    await dashboardService.markAlertRead(alert_id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/advanced/dashboard/metrics', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const metrics = await dashboardService.getLiveMetrics(user_id);
    res.json({ data: metrics });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
