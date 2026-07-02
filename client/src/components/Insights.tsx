import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Insights.css';

interface Pattern {
  pattern: string;
  confidence: number;
  factors: string[];
  matches: number;
  wins: number;
  winRate: number;
}

interface Recommendation {
  title: string;
  description: string;
  type: 'pattern' | 'recommendation' | 'anomaly' | 'opportunity';
  confidence: number;
  metrics: Record<string, any>;
}

interface InsightsProps {
  token: string;
  account_id: number;
}

export default function Insights({ token, account_id }: InsightsProps) {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'patterns' | 'recommendations'>('patterns');

  useEffect(() => {
    fetchInsights();
  }, [account_id]);

  const fetchInsights = async () => {
    try {
      setLoading(true);

      // Fetch patterns
      const patternsRes = await axios.get(
        `/api/insights/patterns/${account_id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPatterns(patternsRes.data.data || []);

      // Fetch recommendations
      const recsRes = await axios.get(
        `/api/insights/recommendations/${account_id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setRecommendations(recsRes.data.data || []);
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'pattern':
        return '📊';
      case 'recommendation':
        return '💡';
      case 'anomaly':
        return '⚠️';
      case 'opportunity':
        return '🎯';
      default:
        return '📌';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return '#00cc66';
    if (confidence >= 60) return '#ffaa00';
    return '#ff4444';
  };

  if (loading) {
    return <div className="insights loading">Loading insights...</div>;
  }

  return (
    <div className="insights">
      <div className="insights-header">
        <h2>🧠 AI Insights</h2>
        <button className="btn-refresh" onClick={fetchInsights}>
          ↻ Refresh
        </button>
      </div>

      <div className="insights-tabs">
        <button
          className={`tab ${activeTab === 'patterns' ? 'active' : ''}`}
          onClick={() => setActiveTab('patterns')}
        >
          📊 Patterns ({patterns.length})
        </button>
        <button
          className={`tab ${activeTab === 'recommendations' ? 'active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          💡 Recommendations ({recommendations.length})
        </button>
      </div>

      {activeTab === 'patterns' && (
        <div className="patterns-section">
          {patterns.length === 0 ? (
            <p className="empty">No patterns found yet. Trade more to build insights.</p>
          ) : (
            patterns.map((pattern, idx) => (
              <div key={idx} className="pattern-card">
                <div className="pattern-header">
                  <div className="pattern-name">{pattern.pattern}</div>
                  <div className="pattern-stats">
                    <span className="stat-badge">
                      {pattern.matches} trades
                    </span>
                    <span className="stat-badge">
                      {pattern.wins} wins
                    </span>
                  </div>
                </div>

                <div className="confidence-bar">
                  <div
                    className="confidence-fill"
                    style={{
                      width: `${pattern.confidence}%`,
                      backgroundColor: getConfidenceColor(pattern.confidence)
                    }}
                  />
                  <span className="confidence-label">
                    {pattern.confidence.toFixed(0)}% confidence
                  </span>
                </div>

                <div className="win-rate">
                  Win Rate: <strong>{pattern.winRate.toFixed(1)}%</strong>
                </div>

                <div className="factors">
                  {pattern.factors.map((factor, i) => (
                    <span key={i} className="factor-tag">
                      {factor}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'recommendations' && (
        <div className="recommendations-section">
          {recommendations.length === 0 ? (
            <p className="empty">No recommendations yet. Check back after more trades.</p>
          ) : (
            recommendations.map((rec, idx) => (
              <div key={idx} className={`recommendation-card rec-${rec.type}`}>
                <div className="rec-header">
                  <span className="rec-icon">{getRecommendationIcon(rec.type)}</span>
                  <h4>{rec.title}</h4>
                </div>

                <p className="rec-description">{rec.description}</p>

                <div className="rec-confidence">
                  <div
                    className="conf-bar"
                    style={{
                      width: `${rec.confidence}%`,
                      backgroundColor: getConfidenceColor(rec.confidence)
                    }}
                  />
                  <span className="conf-value">
                    {rec.confidence.toFixed(0)}%
                  </span>
                </div>

                {rec.metrics && Object.keys(rec.metrics).length > 0 && (
                  <div className="rec-metrics">
                    {Object.entries(rec.metrics).map(([key, value]) => (
                      <div key={key} className="metric">
                        <span className="metric-key">
                          {key.replace(/_/g, ' ')}:
                        </span>
                        <span className="metric-value">
                          {typeof value === 'number'
                            ? value.toFixed(1)
                            : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
