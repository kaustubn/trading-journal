import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './Coach.css';

interface Props {
  token: string;
  account_id: number;
  attempt?: number | null;
}

interface Msg { role: 'user' | 'assistant'; content: string; }

const SUGGESTIONS = [
  'Why am I losing money?',
  "What's my single biggest leak?",
  'Which setup should I cut?',
  'What time of day should I avoid?',
  'Am I overtrading?',
  'What would help me pass a prop challenge?',
];

export default function Coach({ token, account_id, attempt }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  // Reset the conversation when the account or attempt changes
  useEffect(() => { setMessages([]); setError(''); }, [account_id, attempt]);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    setError('');
    const history = messages.slice(-8);
    setMessages(m => [...m, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const r = await axios.post('/api/coach', {
        account_id, attempt: attempt || undefined, question, history,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setMessages(m => [...m, { role: 'assistant', content: r.data.answer || 'No response.' }]);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Coach failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="coach">
      <div className="coach-head">
        <h2>🧠 AI Coach</h2>
        <p>Ask about your real trades. The coach reads your stats for the {attempt ? 'selected run' : 'whole account'} and answers straight.</p>
      </div>

      <div className="coach-body">
        {messages.length === 0 && (
          <div className="coach-empty">
            <p>Ask me anything about your trading. Try:</p>
            <div className="coach-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="coach-chip" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`coach-msg ${m.role}`}>
            <div className="coach-avatar">{m.role === 'user' ? '🧑' : '🧠'}</div>
            <div className="coach-bubble">{m.content.split('\n').map((line, j) => <p key={j}>{line}</p>)}</div>
          </div>
        ))}

        {loading && (
          <div className="coach-msg assistant">
            <div className="coach-avatar">🧠</div>
            <div className="coach-bubble coach-typing"><span></span><span></span><span></span></div>
          </div>
        )}
        {error && <div className="coach-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <form className="coach-input" onSubmit={e => { e.preventDefault(); ask(input); }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask your coach…"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
