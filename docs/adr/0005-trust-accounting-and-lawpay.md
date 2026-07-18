# ADR 0005: Trust accounting and LawPay boundaries

Status: Accepted

## Decision

LawPay handles hosted card/ACH collection and trust/operating routing. The application stores no card data and records only verified provider results, invoices, subledger entries, and reconciliations. Ledger entries are immutable double-entry records; corrections are linked reversals. Enforce period locks, nonnegative client trust balances, separation of operating and trust accounts, and three-way reconciliations.

Financial features are disabled for a tenant until its administrator records jurisdiction configuration and legal/accounting approval.

## Consequences

Every provider mutation, invoice issuance, payment, and ledger operation requires an idempotency key and an audit trail. Property tests and sandbox contracts must prove balance, reversal, lock, overdraft, and reconciliation invariants. This design is not legal or accounting advice.
