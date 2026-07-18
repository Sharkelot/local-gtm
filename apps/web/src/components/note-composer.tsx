'use client';

import { useState } from 'react';

export function NoteComposer({ dealId }: { dealId: string }) {
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
  async function submit() {
    setState('saving');
    const response = await fetch(`/api/v1/deals/${dealId}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      setState('error');
      return;
    }
    setBody('');
    setState('queued');
  }
  return (
    <div className="ai-card">
      <label className="eyebrow" htmlFor="discovery-note">
        Discovery note
      </label>
      <textarea
        id="discovery-note"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Paste the call notes. AI will extract advisory suggestions only."
        style={{
          width: '100%',
          minHeight: 150,
          marginTop: 10,
          padding: 12,
          border: '1px solid var(--line)',
          borderRadius: 7,
          background: 'white',
          resize: 'vertical',
        }}
      />
      <div className="suggestion-actions">
        <button
          className="btn primary"
          disabled={state === 'saving' || !body.trim()}
          onClick={() => void submit()}
        >
          {state === 'saving' ? 'Queuing…' : 'Save note & queue review'}
        </button>
        {state === 'queued' && <span className="status queued">Queued durably</span>}
        {state === 'error' && <span className="status failed">Not saved</span>}
      </div>
    </div>
  );
}
