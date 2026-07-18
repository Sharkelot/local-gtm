import { notFound } from 'next/navigation';
import { NoteComposer } from '@/components/note-composer';
import { SuggestionActions } from '@/components/suggestion-actions';
import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { getDeal } from '@/lib/workspace-data';

export const dynamic = 'force-dynamic';
export default async function DealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const context = await getActiveRequestContext();
  const { dealId } = await params;
  const deal = await getDeal(context, dealId);
  if (!deal) notFound();
  return (
    <WorkspacePage
      context={context}
      eyebrow={`${deal.organization.industry ?? 'Legal services'} · ${deal.stage}`}
      title={deal.name}
      lede={`${deal.organization.name} · ${deal.organization.contacts.length} contacts · follow-up ${deal.followUpAt?.toLocaleDateString('en-US', { timeZone: 'UTC' }) ?? 'not set'}`}
    >
      <div className="workspace-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Discovery record</h2>
              <span className="panel-kicker">Source for advisory AI</span>
            </div>
            <NoteComposer dealId={deal.id} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Notes & evidence</h2>
            </div>
            {deal.notes.length === 0 ? (
              <div className="empty">No notes yet.</div>
            ) : (
              deal.notes.map((note) => (
                <article className="ai-card" key={note.id}>
                  <div className="ai-card-top">
                    <h3>{note.createdAt.toLocaleString()}</h3>
                    <span className="muted">v{note.version}</span>
                  </div>
                  <p>{note.body}</p>
                  {note.aiJobs
                    .flatMap((job) => job.suggestions)
                    .map((s) => (
                      <div className="suggestion" key={s.id}>
                        <strong>
                          {s.kind.replaceAll('_', ' ')} · {Math.round(s.confidence * 100)}%
                        </strong>
                        <q>{s.evidenceText}</q>
                        {s.status === 'PENDING' ? (
                          <SuggestionActions suggestionId={s.id} />
                        ) : (
                          <span
                            className={`status ${s.status === 'APPROVED' ? 'completed' : 'failed'}`}
                          >
                            {s.status}
                          </span>
                        )}
                      </div>
                    ))}
                </article>
              ))
            )}
          </section>
        </div>
        <aside className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Firm posture</h2>
            </div>
            <div style={{ padding: 20 }}>
              <div className="eyebrow">Security</div>
              <p className="lede">
                {deal.organization.securityConcerns.join(' · ') || 'No approved concerns'}
              </p>
              <div className="eyebrow" style={{ marginTop: 20 }}>
                Integrations
              </div>
              <p className="lede">
                {deal.organization.integrationRequirements.join(' · ') ||
                  'No approved requirements'}
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">People</h2>
            </div>
            {deal.organization.contacts.map((c) => (
              <div className="deal-row" style={{ gridTemplateColumns: '1fr auto' }} key={c.id}>
                <div className="deal-name">
                  <strong>
                    {c.firstName} {c.lastName}
                  </strong>
                  <span>{c.title ?? c.email}</span>
                </div>
                {c.isDecisionMaker && <span className="status completed">Decision maker</span>}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </WorkspacePage>
  );
}
