# Local GTM contributor guidance

## Product boundaries

- This is a local-first, multi-tenant legal CRM and practice suite.
- Next.js owns the UI and HTTP interface; PostgreSQL is the durable source of truth; BullMQ/Redis delivers asynchronous work; LM Studio runs only on Windows localhost.
- Keep React presentation-only. Route handlers authenticate and parse Zod input, then call services. Services own authorization, validation, transactions, RLS context, and audit writes.
- Do not introduce a framework without approval. Never generate or execute model-produced SQL. AI has no CRM write credential and may only create Zod-validated advisory suggestions.

## Security and tenancy

- Every tenant-owned record has `tenant_id`. All access must run with the authenticated membership's transaction-local tenant context and PostgreSQL RLS; never trust a request tenant ID.
- Every approved AI change is applied through a domain service and atomically emits an audit event. Do not hide failed jobs or discard schema-invalid model output.
- Queue payloads contain durable identifiers only. PostgreSQL outbox records remain recoverable when Redis, the Windows worker, or LM Studio is unavailable.
- Keep public exposure limited to signed webhook endpoints. Database, Redis, object storage, secrets, and management services remain private.

## Financial and document safety

- CRM records archive by default. Hard purge requires tenant-admin authorization, retention eligibility, no legal hold, explicit confirmation, and an audit event.
- Ledger entries are immutable; corrections are linked reversals. Do not enable trust accounting until a tenant has recorded jurisdiction configuration and legal/accounting approval.
- Quarantine uploads until malware scanning completes. Store secrets and protected material using approved envelope encryption; retain auditable evidence.

## Required workflow

Before a code change, read the relevant schema, service, tests, and ADR; explain the narrow proposed change and failure cases. Before finishing, run TypeScript checks, linting, unit tests, and affected integration tests. Report changed files and unresolved risks.

## Planned module map

- `apps/web`: Next.js UI and `/api/v1` handlers.
- `apps/platform-worker`: outbox dispatch and platform background work.
- `apps/inference-worker`: Windows LM Studio worker.
- `packages/*`: Zod contracts, domain services, repositories, tenancy/security, audit, integrations, and fixtures.
- `docs/adr`: accepted architecture decisions; `docs/compliance`: controls, evidence, and deployment prerequisites.
