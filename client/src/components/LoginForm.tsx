import React, { useState } from 'react';
import axios from 'axios';
import '../styles/Landing.css';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
});

interface LoginFormProps {
  onLogin: (token: string, userId: number) => void;
}

const FEATURES = [
  { icon: '🧠', title: 'AI Coach', body: 'Ask "why am I losing?" and get a straight answer from your real numbers — not generic tips.' },
  { icon: '🏆', title: 'Prop Challenges', body: 'Track every 25K/50K attempt. See exactly why you passed one and blew the next.' },
  { icon: '🎯', title: 'Prop Rules Live', body: 'Trailing drawdown, daily loss, profit target, and the hidden consistency rule — tracked as you trade.' },
  { icon: '🎭', title: 'Emotions', body: 'Tag revenge, FOMO, tilt in one tap. See the exact dollars each emotion costs you.' },
  { icon: '📊', title: 'Real Analytics', body: 'Win rate, profit factor, expectancy, R-multiple, by setup / hour / weekday. One 0-100 score.' },
  { icon: '📥', title: 'Easy Import', body: 'Drop your Fyers, Tradovate, or TradingView CSV — trades rebuilt automatically. No manual entry.' },
];

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await api.post(endpoint, { email, password });
      onLogin(response.data.token, response.data.user.id);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-logo">📈 Trading Journal</div>
        <a className="lp-nav-cta" href="#auth">Sign in</a>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-kicker">Built for futures & prop-firm traders</div>
          <h1>Stop blowing challenges. <span>Start seeing why.</span></h1>
          <p className="lp-lede">
            A trading journal that reads your real trades, tracks your prop rules live, and coaches you
            with AI — so you fix the leak instead of funding another eval.
          </p>
          <div className="lp-hero-actions">
            <a className="lp-btn primary" href="#auth">Start free</a>
            <a className="lp-btn ghost" href="#pricing">See pricing</a>
          </div>
          <div className="lp-trust">Free plan · no card required · works with Fyers, Tradovate & TradingView</div>
        </div>

        {/* Auth card */}
        <div className="lp-auth" id="auth">
          <div className="lp-auth-tabs">
            <button className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button>
            <button className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
          </div>
          <form onSubmit={handleSubmit} className="lp-form">
            <label>Email</label>
            <input type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            <label>Password</label>
            <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {error && <div className="lp-error">{error}</div>}
            <button type="submit" disabled={loading} className="lp-btn primary full">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create free account'}
            </button>
          </form>
          <div className="lp-auth-foot">
            {mode === 'login'
              ? <>New here? <button onClick={() => { setMode('register'); setError(''); }}>Create a free account</button></>
              : <>Already have one? <button onClick={() => { setMode('login'); setError(''); }}>Sign in</button></>}
          </div>
        </div>
      </section>

      <section className="lp-features">
        <h2>Everything a prop trader actually needs</h2>
        <div className="lp-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="lp-feat">
              <div className="lp-feat-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-pricing" id="pricing">
        <h2>Simple pricing</h2>
        <div className="lp-plans">
          <div className="lp-plan">
            <div className="lp-plan-name">Free</div>
            <div className="lp-plan-price">$0</div>
            <ul>
              <li>1 trading account</li>
              <li>Calendar + core stats</li>
              <li>CSV import</li>
              <li>Prop-firm compare</li>
            </ul>
            <a className="lp-btn ghost full" href="#auth">Start free</a>
          </div>
          <div className="lp-plan featured">
            <div className="lp-plan-badge">Most popular</div>
            <div className="lp-plan-name">Pro</div>
            <div className="lp-plan-price">$7<span>/mo</span></div>
            <ul>
              <li>Everything in Free, plus:</li>
              <li>🧠 AI Coach</li>
              <li>🏆 Challenge tracking</li>
              <li>🎭 Emotion analytics</li>
              <li>📊 Full analytics suite</li>
              <li>♾️ Unlimited accounts & trades</li>
            </ul>
            <a className="lp-btn primary full" href="#auth">Get Pro</a>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <p className="lp-disclaimer">
          <strong>Not financial advice.</strong> Trading Journal is a record-keeping and analytics tool.
          Nothing here is financial, investment, or trading advice. Futures and leveraged trading carry
          substantial risk of loss. Past performance does not guarantee future results. You are solely
          responsible for your own trading decisions. Your data is private to your account.
        </p>
        <div className="lp-foot-links">© {new Date().getFullYear()} Trading Journal</div>
      </footer>
    </div>
  );
}
