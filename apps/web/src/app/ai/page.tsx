import { SuggestionActions } from '@/components/suggestion-actions';
import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import { getAiQueue } from '@/lib/workspace-data';
export const dynamic = 'force-dynamic';
export default async function AiPage() {
  const context = await getActiveRequestContext();
  const jobs = await getAiQueue(context);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Advisory only"
      title="AI review queue."
      lede="Nothing here writes to a CRM record until a person approves it through the service layer."
    >
      <div className="stack">
        {jobs.map((job) => (
          <section className="panel" key={job.id}>
            <div className="panel-head">
              <div>
                <h2 className="panel-title">{job.note.deal.organization.name}</h2>
                <span className="panel-kicker">{job.id}</span>
              </div>
              <span
                className={`status ${job.status === 'COMPLETED' ? 'completed' : job.status.includes('WAITING') ? 'waiting' : job.status.includes('FAILED') ? 'failed' : 'processing'}`}
              >
                {job.status.replaceAll('_', ' ')}
              </span>
            </div>
            {job.reasonCode && (
              <div className="ai-card">
                <strong>Waiting reason</strong>
                <p>
                  {job.reasonCode} · next retry{' '}
                  {job.nextRetryAt?.toLocaleString() ?? 'pending worker'}
                </p>
              </div>
            )}
            {job.suggestions.map((s) => (
              <div className="ai-card" key={s.id}>
                <div className="suggestion">
                  <strong>
                    {s.kind.replaceAll('_', ' ')} · {Math.round(s.confidence * 100)}%
                  </strong>
                  <q>{s.evidenceText}</q>
                  {s.status === 'PENDING' ? (
                    <SuggestionActions suggestionId={s.id} />
                  ) : (
                    <span className={`status ${s.status === 'APPROVED' ? 'completed' : 'failed'}`}>
                      {s.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </WorkspacePage>
  );
}
