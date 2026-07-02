import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/LoginForm.css';

const api = axios.create({
  baseURL: 'http://localhost:5000'
});

interface LoginFormProps {
  onLogin: (token: string, userId: number) => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('demo123');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const autoLogin = async () => {
      try {
        setLoading(true);
        const response = await api.post('/api/auth/login', {
          email: 'demo@example.com',
          password: 'demo123'
        });
        console.log('Auto-login successful:', response.data);
        onLogin(response.data.token, response.data.user.id);
      } catch (err: any) {
        console.error('Auto-login failed:', err);
        setError(err.response?.data?.error || 'Auto-login failed');
        setLoading(false);
      }
    };

    autoLogin();
  }, [onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('Submitting login:', { email, password });
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await api.post(endpoint, { email, password });
      console.log('Login successful:', response.data);

      onLogin(response.data.token, response.data.user.id);
    } catch (err: any) {
      console.error('Login error:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Authentication failed';
      setError(errorMsg);
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Trading Journal</h1>
        <p className="subtitle">Multi-account trade logging & analysis</p>

        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <p>Auto-logging in with demo credentials...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <div className="error-message">{error}</div>}

            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Loading...' : mode === 'login' ? 'Login' : 'Register'}
            </button>
          </form>
        )}

        <div className="toggle-mode">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                Login
              </button>
            </>
          )}
        </div>

        <div className="demo-note">
          <strong>Demo:</strong> email: demo@example.com | password: demo123
        </div>
      </div>
    </div>
  );
}
