import React from 'react';
import '../styles/AccountSelector.css';

interface Account {
  id: number;
  broker: string;
  account_number: string;
  account_name: string;
}

interface AccountSelectorProps {
  accounts: Account[];
  selectedAccount: number | null;
  onSelectAccount: (id: number) => void;
}

export default function AccountSelector({
  accounts,
  selectedAccount,
  onSelectAccount
}: AccountSelectorProps) {
  return (
    <div className="account-selector">
      <h3>Trading Accounts</h3>
      <div className="accounts-list">
        {accounts.map(account => (
          <button
            key={account.id}
            className={`account-item ${selectedAccount === account.id ? 'active' : ''}`}
            onClick={() => onSelectAccount(account.id)}
          >
            <div className="account-broker">{account.broker}</div>
            <div className="account-number">{account.account_name || account.account_number}</div>
          </button>
        ))}
      </div>
      <button className="add-account-btn">+ Add Account</button>
    </div>
  );
}
