import Link from 'next/link';
import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { runWorkspaceSearch } from '@/lib/workspace-data';
export const dynamic = 'force-dynamic';
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const context = await getActiveRequestContext();
  const q = (await searchParams).q?.slice(0, 500) ?? '';
  const results = await runWorkspaceSearch(context, q);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Validated hybrid search"
      title={`“${q || 'Search'}”`}
      lede="PostgreSQL results remain available when local inference is offline; AI can only produce a whitelisted filter plan."
    >
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Matching firms</h2>
          <span className="panel-kicker">{results.length} results</span>
        </div>
        {results.map((f) => (
          <div className="deal-row" key={f.id}>
            <div className="deal-name">
              <strong>{f.name}</strong>
              <span>{f.securityConcerns.join(' · ') || f.industry}</span>
            </div>
            <span>{f.deals.length} deals</span>
            <span className={`status ${f.securityConcern ? 'failed' : 'completed'}`}>
              {f.securityConcern ? 'Security concern' : 'No concern'}
            </span>
            {f.deals[0] ? (
              <Link className="row-arrow" href={`/deals/${f.deals[0].id}`}>
                →
              </Link>
            ) : (
              <span />
            )}
          </div>
        ))}
      </section>
    </WorkspacePage>
  );
}
