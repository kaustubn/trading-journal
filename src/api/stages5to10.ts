import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireAccountParam } from '../security';
import riskService from '../services/riskService';

// Risk metrics for the Risk & Sizing page.
// (2026-11-19: the unfinished Insights, Social, Automation and Advanced/tax routes that used to live here were
// disconnected; their files remain in src/api and src/services but are no longer mounted.)
const router = Router();

// Errors: log the detail on the server; send the browser only a safe message.
// Database errors (they carry a `code`) and all 500s become generic.
function fail(res: Response, status: number, error: unknown) {
  console.error('[risk]', error);
  const e = error as any;
  const safe = status < 500 && e && typeof e.message === 'string' && !e.code && e.message.length < 120;
  res.status(status).json({ success: false, error: safe ? e.message : status >= 500 ? 'Server error' : 'Request failed' });
}

router.use(verifyToken);

router.get('/risk/metrics/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const metrics = await riskService.getRiskMetrics(parseInt(String(req.params.account_id)));
    res.json({ success: true, data: metrics });
  } catch (error) {
    fail(res, 500, error);
  }
});

router.get('/risk/position-size/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const { riskPercent = 1, stopLossPts = 15 } = req.query;
    const positionSize = await riskService.calculatePositionSize(
      parseInt(String(req.params.account_id)),
      parseFloat(riskPercent as string) || 1,
      parseInt(stopLossPts as string) || 15
    );
    res.json({ success: true, data: positionSize });
  } catch (error) {
    fail(res, 500, error);
  }
});

router.get('/risk/kelly/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const kelly = await riskService.calculateKelly(parseInt(String(req.params.account_id)));
    res.json({ success: true, data: kelly });
  } catch (error) {
    fail(res, 500, error);
  }
});

router.get('/risk/circuit-breaker/:account_id', requireAccountParam, async (req: Request, res: Response) => {
  try {
    const status = await riskService.shouldHaltTrading(parseInt(String(req.params.account_id)));
    res.json({ success: true, data: status });
  } catch (error) {
    fail(res, 500, error);
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
    fail(res, 500, error);
  }
});

export default router;
