import { ImportProspects } from '@/components/import-prospects';
import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { getOrganizations } from '@/lib/workspace-data';
export const dynamic = 'force-dynamic';
export default async function ProspectsPage() {
  const context = await getActiveRequestContext();
  const firms = await getOrganizations(context);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Relationships"
      title="Firms & people."
      lede="One tenant-isolated view of prospects, clients, and duplicate review."
    >
      <div className="workspace-grid">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Organizations</h2>
            <span className="panel-kicker">{firms.length} records</span>
          </div>
          {firms.map((f) => (
            <div className="deal-row" key={f.id}>
              <div className="deal-name">
                <strong>{f.name}</strong>
                <span>{f.industry ?? 'Legal services'}</span>
              </div>
              <span>{f.contacts.length} contacts</span>
              <span>{f.deals.length} deals</span>
              {f.securityConcern ? (
                <span className="status failed">Security concern</span>
              ) : (
                <span className="status completed">Clear</span>
              )}
            </div>
          ))}
        </section>
        <aside className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">New intake</h2>
            </div>
            <ImportProspects />
          </section>
        </aside>
      </div>
    </WorkspacePage>
  );
}
