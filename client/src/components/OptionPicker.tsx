import React, { useState } from 'react';
import { useOptions, addOption, removeOption } from '../utils/options';
import './OptionPicker.css';

interface Props {
  field: string;                 // 'pair' | 'setup' | 'test_type' | 'session' | 'timeframe'
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  allowCustomText?: boolean;     // also expose a free-text box (e.g. R:R)
}

/**
 * Notion-style select: click a chip to pick it, click again to clear.
 * "+ Add" creates a new option, the pencil toggles delete mode.
 * Deleting an option only removes the choice — trades keep the value they already have.
 */
export default function OptionPicker({ field, label, hint, value, onChange, allowCustomText }: Props) {
  const opts = useOptions();
  const list = opts[field] || [];
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = async () => {
    const v = draft.trim();
    if (v) { await addOption(field, v); onChange(v); }
    setDraft(''); setAdding(false);
  };

  return (
    <div className="form-group op-group">
      <label>
        {label} {hint && <span className="hint">{hint}</span>}
        <button type="button" className={`op-manage ${manage ? 'on' : ''}`}
          title={manage ? 'Done editing list' : 'Edit this list'}
          onClick={() => setManage(m => !m)}>{manage ? 'Done' : '✎'}</button>
      </label>

      <div className="chip-row">
        {list.map(o => (
          <span key={o.id} className={`op-chip-wrap ${manage ? 'managing' : ''}`}>
            <button type="button"
              className={`chip ${value === o.value ? 'on' : ''}`}
              onClick={() => manage ? undefined : onChange(value === o.value ? '' : o.value)}>
              {o.value}
            </button>
            {manage && (
              <button type="button" className="op-del" title={`Remove "${o.value}" from the list`}
                onClick={() => removeOption(field, o.id)}>×</button>
            )}
          </span>
        ))}

        {adding ? (
          <span className="op-add-row">
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); }
                                if (e.key === 'Escape') { setDraft(''); setAdding(false); } }}
              placeholder={`New ${label.toLowerCase()}…`} className="op-input" />
            <button type="button" className="op-save" onClick={submit}>Add</button>
            <button type="button" className="op-cancel" onClick={() => { setDraft(''); setAdding(false); }}>✕</button>
          </span>
        ) : (
          <button type="button" className="op-addbtn" onClick={() => setAdding(true)}>+ Add</button>
        )}

        {allowCustomText && !adding && (
          <input type="text" value={value} onChange={e => onChange(e.target.value)}
            placeholder="or type…" className="op-free" />
        )}
      </div>

      {manage && <div className="op-note">Removing an option only takes it off this list — trades already using it keep their value.</div>}
    </div>
  );
}
