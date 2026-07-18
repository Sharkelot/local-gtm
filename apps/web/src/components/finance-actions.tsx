'use client';

import { useState } from 'react';

function key(label: string) {
  return `${label}-${crypto.randomUUID()}`;
}
async function mutation(path: string, body: unknown, label: string) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key(label) },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { message?: string };
  return response.ok
    ? 'Recorded. Refresh to view updated invoices.'
    : (result.message ?? 'The controlled finance operation failed.');
}
export function FinanceActions({
  timeEntries,
  accounts,
  periods,
}: {
  timeEntries: Array<{
    id: string;
    minutes: number;
    rateCents: number;
    description: string;
    approvedAt: Date | null;
    invoicedAt: Date | null;
    matter: { name: string };
  }>;
  accounts: Array<{ id: string; name: string; type: string; active: boolean }>;
  periods: Array<{
    id: string;
    startsAt: Date;
    endsAt: Date;
    status: string;
    locks: Array<{ id: string }>;
  }>;
}) {
  const [timeEntryId, setTimeEntryId] = useState('');
  const [matterId, setMatterId] = useState('');
  const [timeEntryIds, setTimeEntryIds] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [rateCents, setRateCents] = useState('0');
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('OPERATING');
  const [periodStartsAt, setPeriodStartsAt] = useState('');
  const [periodEndsAt, setPeriodEndsAt] = useState('');
  const [lockAccountId, setLockAccountId] = useState('');
  const [message, setMessage] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Controlled billing actions</h2>
        <span className="panel-kicker">Idempotent</span>
      </div>
      <p className="muted">
        Available only after jurisdiction and legal/accounting approval. LawPay collection is not
        initiated here.
      </p>
      <div className="suggestion-actions">
        <input
          aria-label="Time matter ID"
          placeholder="Matter UUID"
          value={matterId}
          onChange={(e) => setMatterId(e.target.value)}
        />
        <input
          aria-label="Minutes"
          type="number"
          min="1"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <input
          aria-label="Rate in cents"
          type="number"
          min="0"
          value={rateCents}
          onChange={(e) => setRateCents(e.target.value)}
        />
        <input
          aria-label="Time description"
          placeholder="Work description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          aria-label="Occurred on"
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
        />
        <button
          className="btn"
          disabled={!matterId || !description || !occurredOn}
          onClick={() =>
            void mutation(
              '/api/v1/finance/time-entries',
              {
                matterId,
                minutes: Number(minutes),
                rateCents: Number(rateCents),
                description,
                occurredOn,
              },
              'time-create',
            ).then(setMessage)
          }
        >
          Record time
        </button>
      </div>
      <div className="suggestion-actions">
        <input
          aria-label="Time entry ID"
          placeholder="Time entry UUID"
          value={timeEntryId}
          onChange={(e) => setTimeEntryId(e.target.value)}
        />
        <button
          className="btn"
          disabled={!timeEntryId}
          onClick={() =>
            void mutation(
              `/api/v1/finance/time-entries/${timeEntryId}/approve`,
              {},
              'time-approve',
            ).then(setMessage)
          }
        >
          Approve time
        </button>
      </div>
      <div className="suggestion-actions">
        <input
          aria-label="Ledger account name"
          placeholder="Account name"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
        />
        <select
          aria-label="Ledger account type"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
        >
          <option>OPERATING</option>
          <option>REVENUE</option>
          <option>RECEIVABLE</option>
          <option>TRUST_BANK</option>
          <option>CLIENT_TRUST_LIABILITY</option>
        </select>
        <button
          className="btn"
          disabled={!accountName}
          onClick={() =>
            void mutation(
              '/api/v1/finance/ledger/accounts',
              { name: accountName, type: accountType },
              'account-create',
            ).then(setMessage)
          }
        >
          Add account
        </button>
        <input
          aria-label="Period start"
          type="date"
          value={periodStartsAt}
          onChange={(e) => setPeriodStartsAt(e.target.value)}
        />
        <input
          aria-label="Period end"
          type="date"
          value={periodEndsAt}
          onChange={(e) => setPeriodEndsAt(e.target.value)}
        />
        <button
          className="btn"
          disabled={!periodStartsAt || !periodEndsAt}
          onClick={() =>
            void mutation(
              '/api/v1/finance/accounting-periods',
              { startsAt: periodStartsAt, endsAt: periodEndsAt },
              'period-create',
            ).then(setMessage)
          }
        >
          Open period
        </button>
      </div>
      <div className="ai-card">
        <div className="eyebrow">Operational records</div>
        <p className="muted">
          These are operational statuses, not accounting or trust-account advice.
        </p>
        <p className="muted">
          {timeEntries.length} time entries · {accounts.length} accounts · {periods.length} periods
        </p>
        {periods.map((period) => (
          <div className="suggestion-actions" key={period.id}>
            <span className="muted">
              {period.startsAt.toLocaleDateString()} – {period.endsAt.toLocaleDateString()} ·{' '}
              {period.status} · {period.locks.length} locks
            </span>
            {period.status === 'OPEN' && (
              <>
                <select
                  aria-label="Account to lock"
                  value={lockAccountId}
                  onChange={(e) => setLockAccountId(e.target.value)}
                >
                  <option value="">Choose account</option>
                  {accounts
                    .filter((account) => account.active)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </select>
                <button
                  className="btn"
                  disabled={!lockAccountId}
                  onClick={() =>
                    void mutation(
                      `/api/v1/finance/accounting-periods/${period.id}/locks`,
                      { ledgerAccountId: lockAccountId },
                      'period-lock',
                    ).then(setMessage)
                  }
                >
                  Lock period
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    void mutation(
                      `/api/v1/finance/accounting-periods/${period.id}/close`,
                      {},
                      'period-close',
                    ).then(setMessage)
                  }
                >
                  Close period
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="suggestion-actions">
        <input
          aria-label="Matter ID"
          placeholder="Matter UUID"
          value={matterId}
          onChange={(e) => setMatterId(e.target.value)}
        />
        <input
          aria-label="Approved time entry IDs"
          placeholder="Approved time UUIDs, comma-separated"
          value={timeEntryIds}
          onChange={(e) => setTimeEntryIds(e.target.value)}
        />
        <input
          aria-label="Invoice number"
          placeholder="Invoice number"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={!matterId || !timeEntryIds || !invoiceNumber}
          onClick={() =>
            void mutation(
              '/api/v1/finance/invoices',
              {
                matterId,
                invoiceNumber,
                timeEntryIds: timeEntryIds
                  .split(',')
                  .map((id) => id.trim())
                  .filter(Boolean),
              },
              'invoice-issue',
            ).then(setMessage)
          }
        >
          Issue invoice
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </section>
  );
}
