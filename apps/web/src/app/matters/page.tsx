import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { getMatters } from '@/lib/workspace-data';
import { DocumentActions } from '@/components/document-actions';
import { MatterActions } from '@/components/matter-actions';
export const dynamic = 'force-dynamic';
export default async function MattersPage() {
  const context = await getActiveRequestContext();
  const matters = await getMatters(context);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Practice operations"
      title="Matters."
      lede="Intake, deadlines, documents, time, and client sharing remain inside the tenant boundary."
    >
      <MatterActions />
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Active matters</h2>
          <span className="panel-kicker">{matters.length}</span>
        </div>
        {matters.length === 0 ? (
          <div className="empty">Matter tracking is ready; no matters have been opened.</div>
        ) : (
          matters.map((m) => (
            <div className="deal-row" key={m.id}>
              <div className="deal-name">
                <strong>
                  {m.matterNumber} · {m.name}
                </strong>
                <span>{m.organization?.name ?? 'Private client'}</span>
              </div>
              <span className="stage">{m.status}</span>
              <span>{m.documents.length} docs</span>
              {m.legalHold ? (
                <span className="status failed">Legal hold</span>
              ) : (
                <span className="status completed">Active</span>
              )}
              <DocumentActions />
            </div>
          ))
        )}
      </section>
    </WorkspacePage>
  );
}
