import type { ReactNode } from 'react';
import { AppShell } from './app-shell';
import type { ActiveRequestContext } from '@/lib/request-context';

export function WorkspacePage({
  context,
  eyebrow,
  title,
  lede,
  children,
}: {
  context: ActiveRequestContext;
  eyebrow: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <AppShell tenantName={context.tenantName} email={context.email}>
      <div className="content">
        <section className="hero">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h1 className="page-title">{title}</h1>
            <p className="lede">{lede}</p>
          </div>
        </section>
        {children}
      </div>
    </AppShell>
  );
}
