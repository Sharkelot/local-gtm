import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './icons';

const nav = [
  ['Overview', '/', 'dashboard'],
  ['Firms & people', '/prospects', 'firms'],
  ['Deals', '/deals', 'deals'],
  ['AI review queue', '/ai', 'ai'],
  ['Matters', '/matters', 'matters'],
  ['Billing & trust', '/billing', 'billing'],
  ['Audit ledger', '/audit', 'audit'],
] as const;

export function AppShell({
  children,
  tenantName,
  email,
}: {
  children: ReactNode;
  tenantName: string;
  email: string;
}) {
  const initials =
    email
      .split('@')[0]
      ?.split(/[._-]/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'EL';
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-name">Eve Legal</div>
            <div className="brand-caption">Operations desk</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map(([label, href, icon], index) => (
            <Link className={`nav-link ${index === 0 ? 'active' : ''}`} href={href} key={href}>
              <Icon name={icon} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <strong>
            <span className="worker-dot" />
            Local AI connected
          </strong>
          <p>Advisory mode · every approved change is recorded.</p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <form action="/search" className="search">
            <input
              name="q"
              aria-label="Search"
              placeholder="Ask: Which firms have security concerns?"
            />
            <button aria-label="Search">
              <Icon name="search" />
            </button>
          </form>
          <div className="top-meta">
            <div className="tenant-pill">
              <strong>{tenantName}</strong>
              <span>Tenant workspace</span>
            </div>
            <div className="avatar" title={email}>
              {initials}
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
