import express, { Request, Response } from 'express';
import insightsService from '../services/insightsService';

const router = express.Router();

// GET pattern analysis (before catch-all /:account_id)
router.get('/patterns/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { days = 30 } = req.query;

    const patterns = await insightsService.analyzePatterns(
      parseInt(account_id),
      parseInt(days as string) || 30
    );

    res.json({
      success: true,
      data: patterns
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET trade grades (confluence scoring)
router.get('/grades/:account_id', async (req: Request, res: Response) => {
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

// GET smart recommendations
router.get('/recommendations/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);

    const recommendations = await insightsService.generateRecommendations(parseInt(account_id));

    // Save insights to DB
    for (const rec of recommendations) {
      await insightsService.saveInsight(rec);
    }

    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET insights from DB
router.get('/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { limit = 10 } = req.query;

    const insights = await insightsService.getInsights(
      parseInt(account_id),
      parseInt(limit as string) || 10
    );

    res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET confidence calibration
router.get('/calibration/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = String(req.params.account_id);
    const { days = 60 } = req.query;

    const calibration = await insightsService.calibrateConfidence(
      parseInt(account_id),
      parseInt(days as string) || 60
    );

    res.json({
      success: true,
      data: calibration
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
