'use client';

import { useState } from 'react';

export function ImportProspects() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  async function upload() {
    if (!file) return;
    setMessage('Validating and importing…');
    const form = new FormData();
    form.set('file', file);
    const response = await fetch('/api/v1/imports/prospects', {
      method: 'POST',
      headers: { 'idempotency-key': `csv-${file.name}-${file.size}-${file.lastModified}` },
      body: form,
    });
    const body = (await response.json()) as {
      rowsImported?: number;
      duplicateCount?: number;
      message?: string;
    };
    setMessage(
      response.ok
        ? `${body.rowsImported ?? 0} contacts imported · ${body.duplicateCount ?? 0} duplicate candidates`
        : (body.message ?? 'Import failed visibly.'),
    );
  }
  return (
    <div className="ai-card">
      <div className="eyebrow">CSV intake</div>
      <h3>Import law-firm prospects</h3>
      <p>
        Rows are validated through the service layer. Duplicate candidates are reviewed; contacts
        are never auto-merged.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        style={{ marginTop: 12 }}
      />
      <div className="suggestion-actions">
        <button className="btn primary" disabled={!file} onClick={() => void upload()}>
          Import CSV
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </div>
  );
}
