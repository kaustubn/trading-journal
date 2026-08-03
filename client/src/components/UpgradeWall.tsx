import React from 'react';
import './UpgradeWall.css';

interface Props { feature: string; onUpgrade: () => void; }

export default function UpgradeWall({ feature, onUpgrade }: Props) {
  return (
    <div className="wall">
      <div className="wall-card">
        <div className="wall-badge">PRO</div>
        <h2>{feature} is a Pro feature</h2>
        <p className="wall-sub">You're on the Free plan. Upgrade to unlock the full journal.</p>
        <div className="wall-price"><span className="wall-amt">$7</span><span className="wall-per">/month</span></div>
        <ul className="wall-feats">
          <li>🧠 <b>AI Coach</b> — ask why you're losing, get straight answers</li>
          <li>🎭 <b>Emotions</b> — see exactly what revenge & FOMO cost you</li>
          <li>🏆 <b>Challenges</b> — track every prop attempt, compare pass vs blow</li>
          <li>📋 <b>Setup & Breakdown</b> analytics — find your real edge</li>
          <li>♾️ <b>Unlimited</b> accounts & trades</li>
        </ul>
        <button className="wall-btn" onClick={onUpgrade}>Upgrade to Pro</button>
        <p className="wall-note">Cancel anytime · 7-day money-back</p>
      </div>
    </div>
  );
}
