import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { getAuditTimeline } from '@/lib/workspace-data';
export const dynamic = 'force-dynamic';
export default async function AuditPage() {
  const context = await getActiveRequestContext();
  const events = await getAuditTimeline(context);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Tamper-evident"
      title="Audit ledger."
      lede="An ordered, append-only account of every approved change and AI lifecycle transition."
    >
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Complete timeline</h2>
          <span className="panel-kicker">{events.length} events</span>
        </div>
        <div className="timeline">
          {events.map((e) => (
            <div className="event" key={e.id}>
              <strong>{e.action}</strong>
              <span>
                #{e.sequence.toString()} · {e.actorType} · {e.entityType} ·{' '}
                {e.createdAt.toLocaleString()} · hash {e.eventHash.slice(0, 12)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </WorkspacePage>
  );
}
