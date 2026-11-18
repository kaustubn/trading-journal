import React from 'react';
import axios from 'axios';
import { CircleDot, CheckCircle2, Flame, Trophy, Plus } from 'lucide-react';
import './AttemptBar.css';

export interface AttemptLite {
  id: number;
  seq: number;
  label: string;
  status: 'active' | 'passed' | 'blown';
}

interface Props {
  account_id: number;
  attempts: AttemptLite[];
  selectedAttempt: number | null;      // null = All attempts
  onSelect: (id: number | null) => void;
  onChanged: () => void;               // reload attempts + dashboard
  onOpenChallenges: () => void;
}

const STATUS: Record<string, { icon: React.ComponentType<any>; label: string; cls: string }> = {
  active: { icon: CircleDot, label: 'Active', cls: 'ab-active' },
  passed: { icon: CheckCircle2, label: 'Passed', cls: 'ab-passed' },
  blown: { icon: Flame, label: 'Blown', cls: 'ab-blown' },
};

export default function AttemptBar({ account_id, attempts, selectedAttempt, onSelect, onChanged, onOpenChallenges }: Props) {
  if (!attempts || attempts.length === 0) return null;
  const current = attempts[attempts.length - 1]; // latest run
  const st = STATUS[current.status] || STATUS.active;

  const setStatus = async (status: string) => {
    await axios.put(`/api/attempts/${current.id}`, { status });
    onChanged();
  };

  const newAttempt = async () => {
    if (!window.confirm('Start a NEW challenge run? Your current record is kept; new imports go into the fresh attempt.')) return;
    const r = await axios.post(`/api/accounts/${account_id}/attempts`, {});
    onChanged();
    if (r.data?.data?.id) onSelect(r.data.data.id);
  };

  return (
    <div className="attempt-bar">
      <div className="ab-left">
        <span className="ab-cur">Current run</span>
        <span className="ab-label">{current.label}</span>
        <span className={`ab-badge ${st.cls}`}><st.icon className="ic-sm" /> {st.label}</span>
      </div>

      <div className="ab-mid">
        <label className="ab-view">Viewing</label>
        <select
          value={selectedAttempt ?? 'all'}
          onChange={e => onSelect(e.target.value === 'all' ? null : Number(e.target.value))}
        >
          <option value="all">All attempts</option>
          {attempts.map(a => (
            <option key={a.id} value={a.id}>{a.label} · {STATUS[a.status]?.label}</option>
          ))}
        </select>
      </div>

      <div className="ab-actions">
        <button className="ab-btn ab-pass" onClick={() => setStatus('passed')} title="Mark the current run as passed"><CheckCircle2 className="ic-sm" /> Passed</button>
        <button className="ab-btn ab-blow" onClick={() => setStatus('blown')} title="Mark the current run as blown"><Flame className="ic-sm" /> Blown</button>
        <button className="ab-btn ab-new" onClick={newAttempt} title="Start a fresh challenge run"><Plus className="ic-sm" /> New run</button>
        <button className="ab-btn ab-link" onClick={onOpenChallenges} title="Compare all runs on the Challenges page"><Trophy className="ic-sm" /> Compare</button>
      </div>
    </div>
  );
}
