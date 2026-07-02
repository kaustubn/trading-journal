import express, { Request, Response } from 'express';
import riskService from '../services/riskService';

const router = express.Router();

// GET risk metrics for account
router.get('/metrics/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const metrics = await riskService.getRiskMetrics(parseInt(account_id));

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET position size recommendation
router.get('/position-size/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { riskPercent = 1, stopLossPts = 15 } = req.query;

    const positionSize = await riskService.calculatePositionSize(
      parseInt(account_id),
      parseFloat(riskPercent as string) || 1,
      parseInt(stopLossPts as string) || 15
    );

    res.json({
      success: true,
      data: positionSize
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET Kelly Criterion calculation
router.get('/kelly/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const kelly = await riskService.calculateKelly(parseInt(account_id));

    res.json({
      success: true,
      data: kelly
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET circuit breaker status
router.get('/circuit-breaker/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const status = await riskService.shouldHaltTrading(parseInt(account_id));

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET account correlation (multi-account risk)
router.get('/correlation/:user_id', async (req: Request, res: Response) => {
  try {
    const user_id = String(req.params.user_id);
    const correlation = await riskService.getAccountCorrelation(parseInt(user_id));

    res.json({
      success: true,
      data: correlation
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
