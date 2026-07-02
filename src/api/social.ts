import { Router, Request, Response } from 'express';
import socialService from '../services/socialService';

const router = Router();

// Follow user
router.post('/follow/:user_id', async (req: Request, res: Response) => {
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

// Unfollow user
router.delete('/follow/:user_id', async (req: Request, res: Response) => {
  try {
    const follower_id = req.userId || 0;
    const following_id = parseInt(String(req.params.user_id));

    const success = await socialService.unfollowUser(follower_id, following_id);
    res.json({ success, message: success ? 'Unfollowed' : 'Not following' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get user profile
router.get('/profile/:user_id', async (req: Request, res: Response) => {
  try {
    const user_id = parseInt(String(req.params.user_id));
    const profile = await socialService.getUserProfile(user_id);

    // Check if current user is following this user
    const isFollowing = req.userId
      ? await socialService.isFollowing(req.userId, user_id)
      : false;

    res.json({ data: { ...profile, isFollowing } });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

// Get leaderboard
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const leaderboard = await socialService.getLeaderboard(limit);
    res.json({ data: leaderboard });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Share trade
router.post('/share/:trade_id', async (req: Request, res: Response) => {
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

// Get user's shared trades
router.get('/shared/:user_id', async (req: Request, res: Response) => {
  try {
    const user_id = parseInt(String(req.params.user_id));
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const trades = await socialService.getSharedTrades(user_id, limit);
    res.json({ data: trades });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get user feed
router.get('/feed', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const feed = await socialService.getUserFeed(user_id, limit);
    res.json({ data: feed });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Like trade
router.post('/like/:shared_trade_id', async (req: Request, res: Response) => {
  try {
    const shared_trade_id = parseInt(String(req.params.shared_trade_id));
    const likes = await socialService.likeTrade(shared_trade_id);
    res.json({ data: { likes } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Unlike trade
router.delete('/like/:shared_trade_id', async (req: Request, res: Response) => {
  try {
    const shared_trade_id = parseInt(String(req.params.shared_trade_id));
    const likes = await socialService.unlikeTrade(shared_trade_id);
    res.json({ data: { likes } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
