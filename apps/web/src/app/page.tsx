import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { SuggestionActions } from '@/components/suggestion-actions';
import { getDashboardData } from '@/lib/dashboard-data';
import { getActiveRequestContext } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

const money = (cents: number | null) =>
  cents == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(cents / 100);
const statusClass = (status: string) =>
  status === 'COMPLETED'
    ? 'completed'
    : status.includes('WAITING')
      ? 'waiting'
      : status.includes('FAILED')
        ? 'failed'
        : status.toLowerCase();

export default async function DashboardPage() {
  const context = await getActiveRequestContext();
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let databaseError = false;
  try {
    data = await getDashboardData(context);
  } catch {
    databaseError = true;
  }
  return (
    <AppShell tenantName={context.tenantName} email={context.email}>
      <div className="content">
        {databaseError || !data ? (
          <section className="setup">
            <div className="eyebrow">Foundation ready</div>
            <h1 className="page-title">Connect the evidence store.</h1>
            <p className="lede">
              The application compiled, but PostgreSQL is not reachable or has not been seeded.
              Start the development stack, deploy migrations, and run{' '}
              <code>pnpm --filter @local-gtm/db db:seed</code>. No fallback data is written because
              PostgreSQL is authoritative.
            </p>
          </section>
        ) : (
          <>
            <section className="hero">
              <div>
                <div className="eyebrow">Friday · Operating brief</div>
                <h1 className="page-title">The firm, at a glance.</h1>
                <p className="lede">
                  Pipeline, matters, local intelligence, and evidence—one private operating record.
                  AI observations stay pending until someone accountable approves them.
                </p>
              </div>
              <div className="hero-stamp">Private · tenant isolated</div>
            </section>
            <section className="metrics">
              <div className="metric">
                <span className="metric-label">Active firms</span>
                <strong className="metric-value">{data.organizations.length}</strong>
                <span className="metric-note">Prospect and client organizations</span>
              </div>
              <div className="metric">
                <span className="metric-label">Open pipeline</span>
                <strong className="metric-value">{data.deals.length}</strong>
                <span className="metric-note">
                  {money(data.deals.reduce((sum, deal) => sum + (deal.valueCents ?? 0), 0))}{' '}
                  represented
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">AI review</span>
                <strong className="metric-value">
                  {
                    data.aiJobs.filter((job) => job.suggestions.some((s) => s.status === 'PENDING'))
                      .length
                  }
                </strong>
                <span className="metric-note">Advisory suggestions pending</span>
              </div>
              <div className="metric">
                <span className="metric-label">Duplicate review</span>
                <strong className="metric-value">{data.duplicates}</strong>
                <span className="metric-note">No automatic merges</span>
              </div>
            </section>
            <div className="workspace-grid">
              <div className="stack">
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="panel-kicker">Revenue work</div>
                      <h2 className="panel-title">Active deals</h2>
                    </div>
                    <Link className="text-link" href="/deals">
                      View pipeline →
                    </Link>
                  </div>
                  <div className="deal-list">
                    {data.deals.length === 0 ? (
                      <div className="empty">No active deals yet.</div>
                    ) : (
                      data.deals.map((deal) => (
                        <Link className="deal-row" href={`/deals/${deal.id}`} key={deal.id}>
                          <div className="deal-name">
                            <strong>{deal.name}</strong>
                            <span>{deal.organization.name}</span>
                          </div>
                          <span className="stage">{deal.stage.replaceAll('_', ' ')}</span>
                          <span className="value">{money(deal.valueCents)}</span>
                          <span className="row-arrow">→</span>
                        </Link>
                      ))
                    )}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="panel-kicker">Immutable record</div>
                      <h2 className="panel-title">Recent audit activity</h2>
                    </div>
                    <Link className="text-link" href="/audit">
                      Full timeline →
                    </Link>
                  </div>
                  <div className="timeline">
                    {data.auditEvents.length === 0 ? (
                      <div className="empty">
                        Audit events will appear after the first mutation.
                      </div>
                    ) : (
                      data.auditEvents.map((event) => (
                        <div className="event" key={event.id}>
                          <strong>{event.action.replaceAll('.', ' · ')}</strong>
                          <span>
                            #{event.sequence.toString()} · {event.entityType} ·{' '}
                            {event.createdAt.toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
              <aside className="stack">
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="panel-kicker">Local inference</div>
                      <h2 className="panel-title">AI review queue</h2>
                    </div>
                    <Link className="text-link" href="/ai">
                      Open queue →
                    </Link>
                  </div>
                  {data.aiJobs.length === 0 ? (
                    <div className="empty">No AI jobs have been queued.</div>
                  ) : (
                    data.aiJobs.slice(0, 3).map((job) => (
                      <article className="ai-card" key={job.id}>
                        <div className="ai-card-top">
                          <div>
                            <h3>{job.note.deal.organization.name}</h3>
                            <span className="muted">
                              Discovery note · {job.createdAt.toLocaleTimeString()}
                            </span>
                          </div>
                          <span className={`status ${statusClass(job.status)}`}>
                            {job.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                        {job.reasonCode && (
                          <p>Waiting reason: {job.reasonCode.replaceAll('_', ' ')}</p>
                        )}
                        {job.suggestions
                          .filter((s) => s.status === 'PENDING')
                          .slice(0, 1)
                          .map((s) => (
                            <div className="suggestion" key={s.id}>
                              <strong>{s.kind.replaceAll('_', ' ')}</strong>
                              <q>{s.evidenceText}</q>
                              <SuggestionActions suggestionId={s.id} />
                            </div>
                          ))}
                      </article>
                    ))
                  )}
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="panel-kicker">Practice operations</div>
                      <h2 className="panel-title">Matter posture</h2>
                    </div>
                  </div>
                  <div style={{ padding: '20px' }}>
                    <span className="metric-value">{data.matters}</span>
                    <p className="lede">
                      Open matters with tenant-scoped documents, deadlines, and client access.
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
