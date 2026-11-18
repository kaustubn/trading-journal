import React from 'react';
import { Info } from 'lucide-react';
import { GLOSSARY } from '../utils/glossary';
import '../styles/ui.css';

/** Small (i) next to a metric label. Hover or focus shows what it means and what good looks like. */
export function InfoTip({ term, text, align = 'center' }: { term?: string; text?: string; align?: 'center' | 'left' | 'right' }) {
  const g = term ? GLOSSARY[term] : undefined;
  if (!g && !text) return null;
  return (
    <span className={`info-tip info-tip-${align}`} tabIndex={0} aria-label={g ? `${g.label}: ${g.what} ${g.good}` : text}
      onClick={e => e.stopPropagation()}>
      <Info className="ic-sm" aria-hidden="true" />
      <span className="info-tip-pop" role="tooltip">
        {g ? <>
          <strong>{g.label}</strong>
          <span>{g.what}</span>
          <span className="info-tip-good">Good: {g.good}</span>
        </> : <span>{text}</span>}
      </span>
    </span>
  );
}

/** Title + one-line purpose shown at the top of every page. */
export function PageHeader({ icon: Icon, title, sub, actions, children }: {
  icon?: React.ComponentType<any>; title: string; sub?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1 className="page-title">{Icon && <Icon className="ic-lg page-title-ic" aria-hidden="true" />}{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Friendly empty state that always says what to do next. */
export function EmptyState({ icon: Icon, title, children, action }: {
  icon?: React.ComponentType<any>; title: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {Icon && <span className="empty-state-ic"><Icon className="ic-xl" /></span>}
      <div className="empty-state-title">{title}</div>
      {children && <div className="empty-state-body">{children}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/** Segmented sub-navigation used when two related pages share one nav entry. */
export function SubTabs({ tabs, value, onChange }: { tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="subtabs" role="tablist">
      {tabs.map(t => (
        <button key={t.key} role="tab" aria-selected={value === t.key}
          className={`subtab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}
