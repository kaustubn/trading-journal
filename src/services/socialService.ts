import pool from '../db';

interface UserProfile {
  id: number;
  email: string;
  followers: number;
  following: number;
  totalTrades: number;
  winRate: number;
  monthlyPnl: number;
}

interface LeaderboardEntry {
  rank: number;
  user_id: number;
  email: string;
  monthly_pnl: number;
  win_rate: number;
  total_trades: number;
  followers_count: number;
}

interface SharedTrade {
  id: number;
  user_id: number;
  trade_id: number;
  symbol: string;
  pnl: number;
  caption: string;
  likes: number;
  created_at: Date;
}

export class SocialService {
  // Follow a user
  async followUser(follower_id: number, following_id: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if already following
      const existing = await client.query(
        'SELECT id FROM followers WHERE follower_id = $1 AND following_id = $2',
        [follower_id, following_id]
      );

      if (existing.rows.length > 0) {
        return false;
      }

      // Add follow relationship
      await client.query(
        'INSERT INTO followers (follower_id, following_id) VALUES ($1, $2)',
        [follower_id, following_id]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Unfollow a user
  async unfollowUser(follower_id: number, following_id: number): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM followers WHERE follower_id = $1 AND following_id = $2',
      [follower_id, following_id]
    );
    return result.rowCount! > 0;
  }

  // Get user profile
  async getUserProfile(user_id: number): Promise<UserProfile> {
    const userRes = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [user_id]
    );

    if (userRes.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userRes.rows[0];

    // Get follower count
    const followersRes = await pool.query(
      'SELECT COUNT(*) as count FROM followers WHERE following_id = $1',
      [user_id]
    );

    // Get following count
    const followingRes = await pool.query(
      'SELECT COUNT(*) as count FROM followers WHERE follower_id = $1',
      [user_id]
    );

    // Get trade stats
    const statsRes = await pool.query(
      `SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)::INT as wins,
        SUM(pnl) as total_pnl
       FROM trades t
       JOIN accounts a ON t.account_id = a.id
       WHERE a.user_id = $1`,
      [user_id]
    );

    const stats = statsRes.rows[0];
    const winRate = stats.total_trades > 0 ? (stats.wins / stats.total_trades) * 100 : 0;

    return {
      id: user.id,
      email: user.email,
      followers: parseInt(followersRes.rows[0].count),
      following: parseInt(followingRes.rows[0].count),
      totalTrades: parseInt(stats.total_trades),
      winRate,
      monthlyPnl: parseFloat(stats.total_pnl) || 0
    };
  }

  // Get leaderboard
  async getLeaderboard(limit: number = 50): Promise<LeaderboardEntry[]> {
    const result = await pool.query(
      `WITH user_stats AS (
        SELECT
          a.user_id,
          u.email,
          SUM(CASE WHEN DATE(t.entry_time) >= CURRENT_DATE - INTERVAL '30 days' THEN t.pnl ELSE 0 END)::DECIMAL(12,2) as monthly_pnl,
          (SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END)::FLOAT / COUNT(t.id) * 100)::DECIMAL(5,2) as win_rate,
          COUNT(t.id)::INT as total_trades,
          (SELECT COUNT(*) FROM followers WHERE following_id = a.user_id)::INT as followers_count
        FROM accounts a
        JOIN users u ON a.user_id = u.id
        LEFT JOIN trades t ON t.account_id = a.id
        GROUP BY a.user_id, u.email
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY monthly_pnl DESC) as rank,
        user_id,
        email,
        monthly_pnl,
        win_rate,
        total_trades,
        followers_count
      FROM user_stats
      WHERE monthly_pnl IS NOT NULL
      LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      rank: row.rank,
      user_id: row.user_id,
      email: row.email,
      monthly_pnl: parseFloat(row.monthly_pnl),
      win_rate: parseFloat(row.win_rate),
      total_trades: row.total_trades,
      followers_count: row.followers_count
    }));
  }

  // Share a trade
  async shareTrade(user_id: number, trade_id: number, caption?: string): Promise<SharedTrade> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify user owns the trade
      const tradeRes = await client.query(
        `SELECT t.*, s.symbol FROM trades t
         JOIN accounts a ON t.account_id = a.id
         WHERE t.id = $1 AND a.user_id = $2`,
        [trade_id, user_id]
      );

      if (tradeRes.rows.length === 0) {
        throw new Error('Trade not found or unauthorized');
      }

      const trade = tradeRes.rows[0];

      // Insert shared trade
      const resultRes = await client.query(
        `INSERT INTO shared_trades (user_id, trade_id, caption, visibility)
         VALUES ($1, $2, $3, 'public')
         RETURNING id, created_at`,
        [user_id, trade_id, caption]
      );

      await client.query('COMMIT');

      return {
        id: resultRes.rows[0].id,
        user_id,
        trade_id,
        symbol: trade.symbol,
        pnl: parseFloat(trade.pnl),
        caption: caption || '',
        likes: 0,
        created_at: resultRes.rows[0].created_at
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user's shared trades
  async getSharedTrades(user_id: number, limit: number = 20): Promise<SharedTrade[]> {
    const result = await pool.query(
      `SELECT
        st.id, st.user_id, st.trade_id, st.caption, st.likes, st.created_at,
        t.symbol, t.pnl
       FROM shared_trades st
       JOIN trades t ON st.trade_id = t.id
       WHERE st.user_id = $1
       ORDER BY st.created_at DESC
       LIMIT $2`,
      [user_id, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      trade_id: row.trade_id,
      symbol: row.symbol,
      pnl: parseFloat(row.pnl),
      caption: row.caption || '',
      likes: row.likes,
      created_at: row.created_at
    }));
  }

  // Get feed (shared trades from users you follow)
  async getUserFeed(user_id: number, limit: number = 50): Promise<SharedTrade[]> {
    const result = await pool.query(
      `SELECT
        st.id, st.user_id, st.trade_id, st.caption, st.likes, st.created_at,
        t.symbol, t.pnl, u.email
       FROM shared_trades st
       JOIN trades t ON st.trade_id = t.id
       JOIN users u ON st.user_id = u.id
       WHERE st.user_id IN (
         SELECT following_id FROM followers WHERE follower_id = $1
       )
       ORDER BY st.created_at DESC
       LIMIT $2`,
      [user_id, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      trade_id: row.trade_id,
      symbol: row.symbol,
      pnl: parseFloat(row.pnl),
      caption: row.caption || '',
      likes: row.likes,
      created_at: row.created_at
    }));
  }

  // Like a shared trade
  async likeTrade(shared_trade_id: number): Promise<number> {
    const result = await pool.query(
      'UPDATE shared_trades SET likes = likes + 1 WHERE id = $1 RETURNING likes',
      [shared_trade_id]
    );
    return result.rows[0]?.likes || 0;
  }

  // Unlike a shared trade
  async unlikeTrade(shared_trade_id: number): Promise<number> {
    const result = await pool.query(
      'UPDATE shared_trades SET likes = GREATEST(likes - 1, 0) WHERE id = $1 RETURNING likes',
      [shared_trade_id]
    );
    return result.rows[0]?.likes || 0;
  }

  // Check if following
  async isFollowing(follower_id: number, following_id: number): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM followers WHERE follower_id = $1 AND following_id = $2',
      [follower_id, following_id]
    );
    return result.rows.length > 0;
  }
}

export default new SocialService();
