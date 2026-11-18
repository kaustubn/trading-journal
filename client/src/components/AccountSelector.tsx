import React, { useState, useEffect, useRef } from 'react';
import { ChevronsUpDown, Check, Plus, MoreHorizontal, Pencil, Clock, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import '../styles/AccountSelector.css';

interface Account {
  id: number;
  broker: string;
  account_number: string;
  account_name: string;
  timezone?: string | null;
}

// Clock the account's trade times are recorded in (used to place journal trades on the market chart)
const TIMEZONES: { value: string | null; label: string }[] = [
  { value: null, label: 'New York (ET) — default' },
  { value: 'BC', label: 'BC (UTC-7, no DST since Mar 2026)' },
  { value: 'America/Vancouver', label: 'Vancouver (Pacific)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'UTC', label: 'UTC' },
];

interface AccountSelectorProps {
  accounts: Account[];
  selectedAccount: number | null;
  onSelectAccount: (id: number) => void;
  onAddClick: () => void;
  onDeleteAccount?: (id: number, name: string) => void;
  onRenameAccount?: (id: number, name: string) => void;
  onSetTimezone?: (id: number, timezone: string | null) => void;
}

const nameOf = (a: Account) => a.account_name || a.account_number;

/**
 * Compact account switcher: one row shows the active account; click to open
 * the list. Each account has a "…" menu (rename, time zone, delete) — the old
 * right-click menu still works too.
 */
export default function AccountSelector({
  accounts,
  selectedAccount,
  onSelectAccount,
  onAddClick,
  onDeleteAccount,
  onRenameAccount,
  onSetTimezone,
}: AccountSelectorProps) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: number; name: string; x: number; y: number } | null>(null);
  const [tzOpen, setTzOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!menu) setTzOpen(false); }, [menu]);
  const menuTz = menu ? (accounts.find(a => a.id === menu.id)?.timezone ?? null) : null;
  const current = accounts.find(a => a.id === selectedAccount);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  // Close the list when clicking outside it
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openMenuAt = (x: number, y: number, account: Account) => setMenu({ id: account.id, name: nameOf(account), x, y });

  return (
    <div className="account-selector" ref={rootRef}>
      <div className="acct-label">Account</div>
      <button className={`acct-current ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open} title="Switch trading account">
        <span className="acct-avatar">{(current ? nameOf(current) : '?').slice(0, 1).toUpperCase()}</span>
        <span className="acct-text">
          <span className="account-number">{current ? nameOf(current) : 'Choose an account'}</span>
          <span className="account-broker">{current ? current.broker : `${accounts.length} accounts`}</span>
        </span>
        <ChevronsUpDown className="acct-caret" />
      </button>

      {open && (
        <div className="acct-pop" role="listbox">
          <div className="accounts-list">
            {accounts.map(account => (
              <div key={account.id} className={`account-item ${selectedAccount === account.id ? 'active' : ''}`}
                onContextMenu={e => { e.preventDefault(); openMenuAt(e.clientX, e.clientY, account); }}>
                <button className="account-pick" role="option" aria-selected={selectedAccount === account.id}
                  onClick={() => { onSelectAccount(account.id); setOpen(false); }}>
                  <span className="acct-check">{selectedAccount === account.id && <Check />}</span>
                  <span className="acct-text">
                    <span className="account-number">{nameOf(account)}</span>
                    <span className="account-broker">{account.broker}</span>
                  </span>
                </button>
                <button className="acct-more" title="Rename, time zone, delete" aria-label={`Options for ${nameOf(account)}`}
                  onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenuAt(r.right + 4, r.top, account); }}>
                  <MoreHorizontal />
                </button>
              </div>
            ))}
          </div>
          <button className="add-account-btn" onClick={() => { setOpen(false); onAddClick(); }}>
            <Plus /> Add account
          </button>
        </div>
      )}

      {menu && (
        <div className="acct-ctx" style={{ top: menu.y, left: Math.min(menu.x, window.innerWidth - 240) }} onClick={e => e.stopPropagation()}>
          <button className="acct-ctx-item" onClick={() => { onRenameAccount?.(menu.id, menu.name); setMenu(null); }}>
            <Pencil /> Rename
          </button>
          {onSetTimezone && (
            <button className="acct-ctx-item" onClick={() => setTzOpen(!tzOpen)} title="Clock this account's trade times are recorded in">
              <Clock /> Time zone {tzOpen ? <ChevronDown className="ic-sm" /> : <ChevronRight className="ic-sm" />}
            </button>
          )}
          {tzOpen && TIMEZONES.map(z => (
            <button key={z.label} className="acct-ctx-item acct-ctx-sub" onClick={() => { onSetTimezone?.(menu.id, z.value); setMenu(null); }}>
              <span className="acct-check">{(menuTz || null) === z.value && <Check className="ic-sm" />}</span>{z.label}
            </button>
          ))}
          <button className="acct-ctx-item danger" onClick={() => { onDeleteAccount?.(menu.id, menu.name); setMenu(null); }}>
            <Trash2 /> Delete account
          </button>
        </div>
      )}
    </div>
  );
}
