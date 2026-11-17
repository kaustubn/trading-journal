import React, { useState, useEffect } from 'react';
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

export default function AccountSelector({
  accounts,
  selectedAccount,
  onSelectAccount,
  onAddClick,
  onDeleteAccount,
  onRenameAccount,
  onSetTimezone,
}: AccountSelectorProps) {
  const [menu, setMenu] = useState<{ id: number; name: string; x: number; y: number } | null>(null);
  const [tzOpen, setTzOpen] = useState(false);
  useEffect(() => { if (!menu) setTzOpen(false); }, [menu]);
  const menuTz = menu ? (accounts.find(a => a.id === menu.id)?.timezone ?? null) : null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, account: Account) => {
    e.preventDefault();
    const name = account.account_name || account.account_number;
    setMenu({ id: account.id, name, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="account-selector">
      <h3>Trading Accounts</h3>
      <div className="accounts-list">
        {accounts.map(account => (
          <button
            key={account.id}
            className={`account-item ${selectedAccount === account.id ? 'active' : ''}`}
            onClick={() => onSelectAccount(account.id)}
            onContextMenu={e => openMenu(e, account)}
            title="Right-click for options"
          >
            <div className="account-broker">{account.broker}</div>
            <div className="account-number">{account.account_name || account.account_number}</div>
          </button>
        ))}
      </div>
      <button className="add-account-btn" onClick={onAddClick}>+ Add Account</button>

      {menu && (
        <div className="acct-ctx" style={{ top: menu.y, left: menu.x }} onClick={e => e.stopPropagation()}>
          <button className="acct-ctx-item" onClick={() => { onRenameAccount?.(menu.id, menu.name); setMenu(null); }}>
            ✏️ Rename
          </button>
          {onSetTimezone && (
            <button className="acct-ctx-item" onClick={() => setTzOpen(!tzOpen)} title="Clock this account's trade times are recorded in">
              🕐 Time zone {tzOpen ? '▾' : '▸'}
            </button>
          )}
          {tzOpen && TIMEZONES.map(z => (
            <button key={z.label} className="acct-ctx-item acct-ctx-sub" onClick={() => { onSetTimezone?.(menu.id, z.value); setMenu(null); }}>
              {(menuTz || null) === z.value ? '✓ ' : ' '}{z.label}
            </button>
          ))}
          <button className="acct-ctx-item danger" onClick={() => { onDeleteAccount?.(menu.id, menu.name); setMenu(null); }}>
            🗑 Delete account
          </button>
        </div>
      )}
    </div>
  );
}
