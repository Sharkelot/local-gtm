'use client';

import { useState } from 'react';

export function MatterActions() {
  const [matterNumber, setMatterNumber] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [message, setMessage] = useState('');
  async function createMatter() {
    setMessage('Saving…');
    const response = await fetch('/api/v1/matters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matterNumber, name, status }),
    });
    const body = (await response.json()) as { message?: string };
    if (response.ok) {
      setMatterNumber('');
      setName('');
      setMessage('Matter opened. Refresh to see it in the list.');
    } else setMessage(body.message ?? 'Matter was not saved.');
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Open a matter</h2>
        <span className="panel-kicker">Audited</span>
      </div>
      <p className="muted">
        Only matter metadata is entered here. Client and document records remain tenant-scoped.
      </p>
      <div className="suggestion-actions">
        <input
          aria-label="Matter number"
          placeholder="Matter number"
          value={matterNumber}
          onChange={(e) => setMatterNumber(e.target.value)}
        />
        <input
          aria-label="Matter name"
          placeholder="Matter name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="Matter status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option>OPEN</option>
          <option>PENDING</option>
        </select>
        <button
          className="btn primary"
          disabled={!matterNumber.trim() || !name.trim()}
          onClick={() => void createMatter()}
        >
          Open matter
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </section>
  );
}
