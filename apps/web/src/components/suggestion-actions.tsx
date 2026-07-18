'use client';

import { useState } from 'react';

export function SuggestionActions({ suggestionId }: { suggestionId: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'approved' | 'rejected' | 'error'>('idle');
  async function decide(decision: 'APPROVE' | 'REJECT') {
    setState('saving');
    const response = await fetch(`/api/v1/ai/suggestions/${suggestionId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `decision-${suggestionId}-${decision}`,
      },
      body: JSON.stringify({
        decision,
        reason:
          decision === 'APPROVE'
            ? 'Reviewed and accepted by user.'
            : 'Reviewed and declined by user.',
      }),
    });
    setState(response.ok ? (decision === 'APPROVE' ? 'approved' : 'rejected') : 'error');
  }
  if (state === 'approved' || state === 'rejected')
    return (
      <span className={`status ${state === 'approved' ? 'completed' : 'failed'}`}>{state}</span>
    );
  return (
    <div className="suggestion-actions">
      <button
        className="btn primary"
        disabled={state === 'saving'}
        onClick={() => void decide('APPROVE')}
      >
        Approve
      </button>
      <button className="btn" disabled={state === 'saving'} onClick={() => void decide('REJECT')}>
        Reject
      </button>
      {state === 'error' && <span className="muted">Could not save</span>}
    </div>
  );
}
