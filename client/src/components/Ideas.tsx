import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Ideas.css';

interface Idea {
  id: number;
  user_id: number;
  account_id?: number;
  title: string;
  description?: string;
  symbol?: string;
  price_level?: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface IdeasProps {
  token: string;
  selectedDate?: string;
  selectedAccount?: number;
}

export default function Ideas({ token, selectedDate, selectedAccount }: IdeasProps) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    symbol: '',
    price_level: '',
  });

  useEffect(() => {
    fetchIdeas();
  }, [selectedDate, selectedAccount, token]);

  const fetchIdeas = async () => {
    try {
      const url = selectedDate
        ? `/api/ideas/date/${selectedDate}`
        : '/api/ideas';

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: selectedAccount ? { account_id: selectedAccount } : {},
      });
      setIdeas(response.data.data);
    } catch (error) {
      console.error('Error fetching ideas:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(
        '/api/ideas',
        {
          account_id: selectedAccount || null,
          ...formData,
          price_level: formData.price_level ? parseFloat(formData.price_level) : null,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setFormData({ title: '', description: '', symbol: '', price_level: '' });
      setShowForm(false);
      fetchIdeas();
    } catch (error) {
      console.error('Error creating idea:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this idea?')) return;

    try {
      await axios.delete(`/api/ideas/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchIdeas();
    } catch (error) {
      console.error('Error deleting idea:', error);
    }
  };

  const handleStatusChange = async (id: number, newStatus: string) => {
    try {
      await axios.put(
        `/api/ideas/${id}`,
        { status: newStatus },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      fetchIdeas();
    } catch (error) {
      console.error('Error updating idea:', error);
    }
  };

  return (
    <div className="ideas-section">
      <div className="ideas-header">
        <h3>Trading Ideas</h3>
        <button
          className="add-idea-btn"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕' : '+ Add Idea'}
        </button>
      </div>

      {showForm && (
        <form className="idea-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Idea title (e.g., 'Breakout setup')"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />

          <input
            type="text"
            placeholder="Symbol (e.g., EURUSD, NQ)"
            value={formData.symbol}
            onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
          />

          <input
            type="number"
            placeholder="Price level"
            step="0.01"
            value={formData.price_level}
            onChange={(e) => setFormData({ ...formData, price_level: e.target.value })}
          />

          <textarea
            placeholder="Idea details, reasoning, entry/exit plan..."
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Saving...' : 'Save Idea'}
          </button>
        </form>
      )}

      <div className="ideas-list">
        {ideas.length === 0 ? (
          <div className="no-ideas">No ideas yet. Add one to track your trading thoughts!</div>
        ) : (
          ideas.map((idea) => (
            <div key={idea.id} className="idea-card">
              <div className="idea-header">
                <h4>{idea.title}</h4>
                <select
                  className={`status-badge ${idea.status}`}
                  value={idea.status}
                  onChange={(e) => handleStatusChange(idea.id, e.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="executed">Executed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              {(idea.symbol || idea.price_level) && (
                <div className="idea-meta">
                  {idea.symbol && <span className="symbol">{idea.symbol}</span>}
                  {idea.price_level && <span className="price">@ {idea.price_level.toFixed(2)}</span>}
                </div>
              )}

              {idea.description && (
                <p className="idea-description">{idea.description}</p>
              )}

              <div className="idea-footer">
                <small>{new Date(idea.created_at).toLocaleString()}</small>
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(idea.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
