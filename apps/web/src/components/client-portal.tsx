export function ClientPortal({
  matters,
}: {
  matters: Array<{
    id: string;
    matterNumber: string;
    name: string;
    status: string;
    practiceArea: string | null;
    documents: Array<{ id: string; name: string; createdAt: Date }>;
  }>;
}) {
  return (
    <main className="content">
      <section className="hero">
        <div>
          <div className="eyebrow">Private client portal</div>
          <h1 className="page-title">Shared matters.</h1>
          <p className="lede">
            Read-only access over the private portal. Only records explicitly shared with your
            active client membership appear here.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Your matters</h2>
          <span className="panel-kicker">{matters.length}</span>
        </div>
        {matters.length === 0 ? (
          <div className="empty">
            No matters or documents have been shared with this client account.
          </div>
        ) : (
          matters.map((matter) => (
            <article className="deal-row" key={matter.id}>
              <div className="deal-name">
                <strong>
                  {matter.matterNumber} · {matter.name}
                </strong>
                <span>{matter.practiceArea ?? 'Matter details'}</span>
              </div>
              <span className="stage">{matter.status}</span>
              <span>{matter.documents.length} shared documents</span>
              {matter.documents.map((document) => (
                <span className="muted" key={document.id}>
                  {document.name}
                </span>
              ))}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
