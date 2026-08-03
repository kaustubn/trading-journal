import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Social.css';

interface RankEntry {
  rank: number;
  user_id: number;
  email: string;
  monthly_pnl: number;
  win_rate: number;
  total_trades: number;
  followers_count: number;
}

interface UserProfile {
  id: number;
  email: string;
  followers: number;
  following: number;
  totalTrades: number;
  winRate: number;
  monthlyPnl: number;
  isFollowing?: boolean;
}

interface SharedTrade {
  id: number;
  user_id: number;
  trade_id: number;
  symbol: string;
  pnl: number;
  caption: string;
  likes: number;
  created_at: string;
}

interface SocialProps {
  token: string;
  user_id: number;
}

export default function Social({ token, user_id }: SocialProps) {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'profile' | 'feed'>('leaderboard');
  const [leaderboard, setLeaderboard] = useState<RankEntry[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [feed, setFeed] = useState<SharedTrade[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    } else if (activeTab === 'feed') {
      fetchFeed();
    }
  }, [activeTab]);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/social/leaderboard?limit=50', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLeaderboard(res.data.data || []);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async (viewUserId: number) => {
    try {
      setLoading(true);
      const res = await axios.get(`/api/social/profile/${viewUserId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProfile(res.data.data);
      setSelectedUserId(viewUserId);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFeed = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/social/feed?limit=50', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFeed(res.data.data || []);
    } catch (error) {
      console.error('Error fetching feed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async (followUserId: number, currentlyFollowing: boolean) => {
    try {
      if (currentlyFollowing) {
        await axios.delete(`/api/social/follow/${followUserId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post(`/api/social/follow/${followUserId}`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      if (profile) {
        setProfile({
          ...profile,
          isFollowing: !currentlyFollowing,
          followers: profile.followers + (currentlyFollowing ? -1 : 1)
        });
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    }
  };

  const handleLike = async (sharedTradeId: number, isLiked: boolean) => {
    try {
      if (isLiked) {
        await axios.delete(`/api/social/like/${sharedTradeId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post(`/api/social/like/${sharedTradeId}`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      // Refresh feed
      if (activeTab === 'feed') {
        fetchFeed();
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  return (
    <div className="social">
      <div className="social-header">
        <h2>🌐 Social</h2>
        <div className="social-tabs">
          <button
            className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            Leaderboard
          </button>
          <button
            className={`tab ${activeTab === 'feed' ? 'active' : ''}`}
            onClick={() => setActiveTab('feed')}
          >
            Feed
          </button>
        </div>
      </div>

      {loading && <div className="social-loading">Loading...</div>}

      {activeTab === 'leaderboard' && (
        <div className="leaderboard">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Trader</th>
                <th>Monthly P&L</th>
                <th>Win Rate</th>
                <th>Trades</th>
                <th>Followers</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry) => (
                <tr key={entry.user_id}>
                  <td className="rank">
                    {entry.rank <= 3 ? (
                      <span className={`medal medal-${entry.rank}`}>
                        {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}
                      </span>
                    ) : (
                      <span className="rank-number">#{entry.rank}</span>
                    )}
                  </td>
                  <td
                    className="email clickable"
                    onClick={() => fetchProfile(entry.user_id)}
                  >
                    {entry.email}
                  </td>
                  <td className={entry.monthly_pnl >= 0 ? 'positive' : 'negative'}>
                    ${entry.monthly_pnl.toFixed(0)}
                  </td>
                  <td>{entry.win_rate.toFixed(1)}%</td>
                  <td>{entry.total_trades}</td>
                  <td>{entry.followers_count}</td>
                  <td>
                    {entry.user_id !== user_id && (
                      <button
                        className="btn-follow"
                        onClick={() => handleFollow(entry.user_id, false)}
                      >
                        Follow
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {profile && selectedUserId !== user_id && (
            <div className="profile-modal">
              <div className="profile-card">
                <h3>{profile.email}</h3>
                <div className="profile-stats">
                  <div className="stat">
                    <span className="label">Followers</span>
                    <span className="value">{profile.followers}</span>
                  </div>
                  <div className="stat">
                    <span className="label">Following</span>
                    <span className="value">{profile.following}</span>
                  </div>
                  <div className="stat">
                    <span className="label">Trades</span>
                    <span className="value">{profile.totalTrades}</span>
                  </div>
                  <div className="stat">
                    <span className="label">Win Rate</span>
                    <span className="value">{profile.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="stat">
                    <span className="label">Monthly P&L</span>
                    <span className={`value ${profile.monthlyPnl >= 0 ? 'positive' : 'negative'}`}>
                      ${profile.monthlyPnl.toFixed(0)}
                    </span>
                  </div>
                </div>
                {profile.isFollowing ? (
                  <button
                    className="btn-unfollow"
                    onClick={() => handleFollow(profile.id, true)}
                  >
                    Unfollow
                  </button>
                ) : (
                  <button
                    className="btn-follow"
                    onClick={() => handleFollow(profile.id, false)}
                  >
                    Follow
                  </button>
                )}
                <button
                  className="btn-close"
                  onClick={() => {
                    setProfile(null);
                    setSelectedUserId(null);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'feed' && (
        <div className="feed">
          {feed.length === 0 ? (
            <p className="empty">No trades shared yet. Follow traders to see their shared trades!</p>
          ) : (
            feed.map((trade) => (
              <div key={trade.id} className="trade-card">
                <div className="trade-header">
                  <h4>{trade.symbol}</h4>
                  <span className={`pnl ${trade.pnl >= 0 ? 'positive' : 'negative'}`}>
                    ${trade.pnl.toFixed(2)}
                  </span>
                </div>
                {trade.caption && <p className="caption">{trade.caption}</p>}
                <div className="trade-meta">
                  <span className="date">
                    {new Date(trade.created_at).toLocaleDateString()}
                  </span>
                  <button
                    className="btn-like"
                    onClick={() => handleLike(trade.id, false)}
                  >
                    👍 {trade.likes}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
