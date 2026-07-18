import Link from 'next/link';
import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { getDeals } from '@/lib/workspace-data';

export const dynamic = 'force-dynamic';
export default async function DealsPage() {
  const context = await getActiveRequestContext();
  const deals = await getDeals(context);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Revenue work"
      title="Deal room."
      lede="Every opportunity, note, approval, and follow-up remains attributable."
    >
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Pipeline</h2>
          <span className="panel-kicker">{deals.length} active</span>
        </div>
        <div className="deal-list">
          {deals.map((deal) => (
            <Link className="deal-row" href={`/deals/${deal.id}`} key={deal.id}>
              <div className="deal-name">
                <strong>{deal.name}</strong>
                <span>{deal.organization.name}</span>
              </div>
              <span className="stage">{deal.stage}</span>
              <span className="value">
                {deal.valueCents ? `$${(deal.valueCents / 100).toLocaleString()}` : '—'}
              </span>
              <span className="row-arrow">→</span>
            </Link>
          ))}
        </div>
      </section>
    </WorkspacePage>
  );
}
