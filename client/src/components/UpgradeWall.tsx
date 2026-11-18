import React from 'react';
import { Compass, HeartPulse, Trophy, Layers, Infinity as InfinityIcon } from 'lucide-react';
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
          <li><Compass className="ic-sm" /> <span><b>Coach</b> — plain-English answers on why you're losing and what to fix</span></li>
          <li><HeartPulse className="ic-sm" /> <span><b>Emotions</b> — see exactly what revenge &amp; FOMO cost you</span></li>
          <li><Trophy className="ic-sm" /> <span><b>Challenges</b> — track every prop attempt, compare pass vs blow</span></li>
          <li><Layers className="ic-sm" /> <span><b>Setups &amp; Time</b> analytics — find your real edge</span></li>
          <li><InfinityIcon className="ic-sm" /> <span><b>Unlimited</b> accounts &amp; trades</span></li>
        </ul>
        <button className="wall-btn" onClick={onUpgrade}>Upgrade to Pro</button>
        <p className="wall-note">Cancel anytime · 7-day money-back</p>
      </div>
    </div>
  );
}
