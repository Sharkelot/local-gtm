# Product pivot plan: legal CRM to general CRM

**Status:** proposal for approval; no implementation authorized by this plan  
**Scope:** planning only. This document deliberately does not change application code, database schema, Keycloak, or the live deployment.

## Decision summary

Reposition Local GTM as a local-first, multi-tenant general-purpose CRM with a useful import/export path, extensible sales pipelines, and integration-ready architecture. Preserve the sound generic platform capabilities (tenant isolation, audit, SSO, quarantined document storage, asynchronous outbox processing, local AI assistance); remove legal-practice workflows and professional/legal positioning. Deliver a measured data migration that preserves customer data and authentication continuity. Do not change the live CT601 database or CT603 Keycloak realm until a separately approved implementation has rehearsed backup, migration, rollback, and identity cutover.

**Naming proposal:** use **Contact**, **Company**, **Deal**, **Pipeline**, and **Stage** as canonical product concepts. Keep `Organization` as the possible internal name for Company only if implementation review finds rename risk disproportionate; UI and import/export vocabulary should consistently say Company. Keep existing `legal-crm` realm and `legal-crm-web` client identifiers for the first release; update display/product copy and defer realm/client identifier migration to a separately approved low-risk operation.

## Current-state inventory and classification

Inventory is based on a repository-wide legal-term scan of `origin/main` (`acb3f89`) and inspection of the Prisma schema, service and route tree, seed/fixtures, env examples, Keycloak bootstrap, and ADRs. Exact paths are grouped below; nested imports/tests and generated lock/build artifacts must be re-scanned during implementation. Some generic terms (for example `client` in an SDK or `case` in a test runner) are false positives and are not product concepts.

### Rename or generalize

| Current concept and locations | Target / treatment |
|---|---|
| `Matter` and `matterNumber`, `practiceArea`, matter statuses: `packages/db/prisma/schema.prisma` (`Matter`, relations from Organization/Document/TimeEntry/Invoice/communications/shares); `packages/db/src/services/matter-service.ts`; `apps/web/src/app/api/v1/matters/**`; `apps/web/src/app/matters/**`; `apps/web/src/components/matter-actions.tsx`; matter-using billing, document, portal, communication and test paths | General `Deal` is already present; make Deal the single sales-opportunity aggregate. Move matter-linked documents and activities to suitable generic relations (Contact/Company/Deal or generic attachable entity) instead of pretending a sales deal is a legal matter. Replace fixed matter status/stage with configurable Pipeline and Stage records. |
| `Organization` as customer account, `Contact` as person, `isDecisionMaker`, security/integration concern fields: `schema.prisma`; `organization-service.ts`, `contact-service.ts`, AI/search services; `/organizations`, `/contacts`, `/deals` UI/API; `packages/domain/src/index.ts` | Company/Account and Contact. Generalize buyer/decision-maker role to configurable contact role or remove if unused. Replace legal vertical-specific signals with configurable CRM fields/activities, not hard-coded compliance attributes. |
| Membership roles `ATTORNEY`, `SALES`, `BILLING`, `STAFF`, `AUDITOR`, `CLIENT` in schema, auth/service guards, route tests and deployment fixtures | General roles/permissions such as `OWNER`, `ADMIN`, `MEMBER`, `READ_ONLY`, with explicit capability model if needed. Keep tenant/platform administration and least privilege; remove professional-practice roles and external client-portal membership model unless a generic sharing feature is approved. |
| `DealStage` enum and deal stage logic; seed and UI use `DISCOVERY` etc. | Pipeline and Stage are tenant-configurable data with ordering, win/loss terminal semantics, and migration mapping from existing enum. Avoid retaining enum constraints that prevent custom stages. |
| `Note` is deal-bound; AI prompt/suggestion model uses discovery and legal-sales language: `schema.prisma`, `ai-service.ts`, internal AI prompt route, `apps/inference-worker`, `packages/contracts`, tests | General Activities (call/email/meeting/note) and AI summaries, suggested next steps, and optional enrichment. Keep advisory-only AI: schema-validated suggestions, human approval, audit, outbox and local inference; never model-authored SQL or autonomous CRM writes. |
| `ImportRun`, `/api/v1/imports/prospects`, `import-prospects.tsx`, `import-input.test.ts`, fixtures named `eve-legal-services-prospects.csv` | General import jobs for contacts, companies and deals; persist mapping and row-level results, provide progress, dry-run, error CSV, deduplication/merge review and external-ID idempotency. Reuse transactional/outbox patterns where suitable, but do not assume current prospect import meets these requirements. |
| `clientId`, `ClientPortal*`, `client-shares`, client portal UI/routes/services/tests and client-specific finance ledger fields | Separate generic CRM Contact/Company identity from OAuth/API “client” terminology. Remove the legal client portal and matter-share workflows, or redesign later as generic record sharing with explicit authorization and audit. |
| `Eve Legal Operations`, legal-industry labels, fixtures, demo story and app metadata in `apps/web/src/app/layout.tsx`, `apps/web/e2e/eve-demo.spec.ts`, `packages/fixtures/**`, seed and README | Replace with a neutral, non-legal demo tenant and realistic cross-industry sample organizations. Avoid synthetic personally identifying real-looking data; use reserved `.test` domains. |
| Names in `.env.example`, `deploy/split/*.env.example`, `deploy/internal/bootstrap.env`, Docker image defaults, workflow files, docs and scripts: `legal_crm*`, `legal-crm-*`, `MINIO_DOCUMENT_BUCKET=legal-documents` | Introduce generic canonical names and a compatibility window for deployed environment variables/image names. Document exact rename mapping and cutover order; do not silently break existing deployments. Generic document bucket name. |

### Remove from the general CRM product

| Concepts and locations | Removal boundary |
|---|---|
| Conflict checking, privilege, attorney/client legal practice terms and practice-area matter metadata in source, prompts, fixture copy and docs | Remove workflows and product claims. Search exact identifiers and user-facing copy; do not globally replace generic English “case”, “client”, “legal” in library/license text, test framework terminology, or unrelated technical contexts. |
| Matter/document `legalHold`, `RetentionPolicy.legalHold`, retention evidence `MATTER` record type and purge logic conditioned on legal hold: schema, `retention-evidence-service.ts`, document service, retention API/tests, migration `20260717230400_finance_retention_evidence`, ADR 0004 | Remove legal-specific hold state. Preserve generic lifecycle controls only if product requirements justify them: retention period, archive, tenant-admin authorized purge, confirmation and audit. Treat contractual retention/legal holds as a future generic policy requirement, not silently discard existing holds. Existing held records must be surfaced and preserved during migration pending an explicit customer decision. |
| Finance/accounting practice suite: time entries, invoices, trust ledger, client trust liability, reconciliation, accounting periods/locks, LawPay, jurisdiction and professional approval: schema; `packages/db/src/services/finance-service.ts`; `/api/v1/finance/**`, billing UI/actions; ADR 0005; finance tests/env/provider wiring | Remove from CRM scope and public product. This includes sensitive immutable ledger and payment data; no destructive DB drop is proposed. Preserve a read-only export/archive or separately migrate it to an explicitly maintained subsystem before removing schema/API support. No trust accounting or payment processing is part of the target. |
| Legal client portal and client-specific shares as described above | Remove from initial target; generic sharing is out of scope unless separately specified and designed. |

### Keep (generic capabilities), with these boundaries

- **PostgreSQL, tenant RLS, service-owned authorization and transactions, Zod contracts, append-only hash-linked audit events, idempotency, and recoverable outbox.** Retain/strengthen. Tenant ID continues to come from authenticated context, never the request.
- **Document/object storage, encryption, versioning, quarantine and ClamAV malware scan.** Keep as generic record attachments. Clean-scan and authorization checks remain mandatory before download; decouple attachment ownership from Matter and remove legal-specific bucket/hold labels. Retention/deletion must remain explicit, auditable, and tenant configurable where required.
- **SSO/Keycloak**, tenant membership, secure secrets management in OpenBao and encrypted-at-rest connector credentials. Keep. Connector OAuth/API secrets must never be stored in PostgreSQL plaintext; prefer OpenBao references/leases and scope each secret to tenant/provider.
- **Local AI inference, worker queues, job status/retry, validation and audit.** Keep for consented, advisory summaries, next steps and note-based enrichment. No remote provider is implied.
- **Imports, duplicate review and exports.** Existing `ImportRun`, duplicate-candidate scoring and one-time prospect import are useful foundations but are not the requested full import workflow. Preserve data provenance and ensure import mutations are tenant-scoped and audited.

## Target product domain

1. **Contacts and Companies (accounts):** tenant-owned records, multiple emails/phones, company domain, job/title, owner, tags, archive state, provenance and external IDs; contact-to-company relation.
2. **Deals, Pipelines and Stages:** configurable pipelines/stages, rank/order, terminal won/lost flags, amount/currency, close date, owner, company and many-to-many contacts. Existing `Deal` is not sufficient while it requires a Company and uses a global enum.
3. **Activities:** call, email, meeting, note, task completion and system/import events, each with timestamp, owner, participants and links to relevant contacts, companies and deals. Avoid exposing message bodies or attachments outside tenant authorization.
4. **Tasks:** owner, due date, status/priority, reminder strategy, optional activity/record link. **Tags and custom fields:** typed, validated, tenant-scoped definitions; explicit allowed types and bounded JSON storage or typed value tables, with index/filter plan and audit of schema/value changes.
5. **Owners and Teams:** map authenticated tenant memberships to ownership; team-based visibility only if product defines it. Default-deny tenant RLS and authorization remain unchanged.
6. **Attachments and audit log:** generic attachment links with existing quarantine/scan gate; durable audit events for create/update/archive/import/merge/export/connector/AI approval.
7. **AI assist:** summaries, next-step suggestions and optional enrichment from notes/activities; advisory-only, cite source evidence, validate output, stale-version checks, human accept/reject, audit every decision. Local inference remains; prompt/evaluation fixtures become industry-neutral.

## Import, connector and export proposal

### CSV and vCard import (first import PR)

Wizard stages: upload (CSV and vCard; bounded size/encoding/row count, MIME sniff and safe parsing) → header detection → mapping editor → validation → dry-run preview → commit → background progress/results. Save versioned mappings per tenant, with optional built-in provider presets. Validate field types, date/time zones, enums, required fields and relationship resolution before commit. Preview create/update/duplicate/error counts and representative rows without writing business records. Allow conservative duplicate suggestions based on exact normalized email, company domain and phone, then fuzzy name/company similarity; never auto-merge fuzzy matches. Require a human merge decision and make merges transactional, audited and reversible where feasible. Download a row-numbered error report without secrets. For idempotent re-import, require an external source ID with source namespace; upsert uniqueness is tenant + entity type + source + external ID. Use request hash/idempotency key for job replay safety, but do not confuse job idempotency with per-record identity. Store only durable IDs in queue payloads; source files must be quarantined, access controlled and deleted under documented retention policy. Platform-worker owns processing and progress events; database/outbox remains source of truth when Redis/worker is down.

### Presets

Ship versioned column maps and sample fixtures for HubSpot, Salesforce, Pipedrive, Zoho and Google Contacts exports. Treat them as mapping presets, not API integrations; document vendor export format variants and fixture provenance. Unknown columns are offered for mapping, not silently discarded. Test alternate header capitalization, duplicate headers, malformed rows, Unicode, large files, partially populated records and repeated imports.

### Connectors (phase 2+)

Implement a provider-neutral connector contract with OAuth/API-key auth, tenant-bound connection state, provider/cursor/sync-run state, field mapping, incremental cursor checkpoints, backoff/rate limiting, idempotent upserts, error/dead-letter visibility, scheduled sync and signature-verified webhook ingestion. Keep OpenBao secret path/version references in DB, not tokens or API keys. Add outbound webhooks and public REST API using scoped/revocable personal access tokens only after API versioning, rate limits, audit, tenant auth, replay protection and signing are designed.

Recommend **HubSpot first**: its public developer APIs and common export/import use case are a practical initial integration; confirm current terms, OAuth scopes, rate limits and endpoint lifecycle against official vendor docs during connector implementation. Do not treat “free” access or API openness as a substitute for licensing/ToS review. Build framework boundaries that allow a later Pipedrive connector. n8n/Zapier compatibility comes via the documented public API and outbound webhooks, not vendor-specific shortcuts.

### Export

Provide tenant-admin authorized CSV and JSON full export with stable identifiers, relationships, custom fields, attachments as separately downloadable manifests/archives, audit metadata where policy permits, schema/version manifest, checksums, and a clear inclusion/exclusion report. Stream large exports asynchronously, encrypt at rest, provide short-lived authenticated downloads, audit initiation/completion, and enforce expiry/deletion. Export must make data ownership practical and not leak other tenants or secrets.

## Data and identity migration plan (design; execute only after approval)

### Database

1. Establish a consistent encrypted backup of CT601 PostgreSQL and object storage metadata/bytes before any production migration; record backup ID, timestamp, restore point and restore test. This is a hard go/no-go gate, not an optional deployment step.
2. Rehearse from a production-like restored copy with schema checksum, row counts and representative tenant/RLS checks. Inventory tables and foreign keys, including finance, legal holds, client shares, integration tokens, import runs, audit evidence and uploaded objects. Never use production data in public fixtures.
3. Prefer expand/backfill/contract: add generic pipeline/activity/task/custom-field/external-ID structures and compatibility columns/tables; backfill Companies/Contacts/Deals/activities and document links; validate counts, foreign-key integrity, tenant ownership and hashes; dual-read only during a bounded transition; switch services/UI; then drop old legal-only structures only after explicit retention/archive approval. Existing `Deal` data maps to default pipeline/stages; `Matter` cannot be mechanically treated as Deal without deciding whether it represented a sales opportunity or a service case. Map separately or preserve as archived export. Finance data is exported/archived, never reinterpreted as CRM revenue.
4. Add stable tenant-scoped external source IDs and uniqueness constraints only after duplicate collision report and remediation. Migrate duplicate candidates to review state; do not auto-merge contacts or companies. Preserve audit history and original timestamps/actor attribution; append migration audit events instead of rewriting history.
5. Verify RLS with runtime credentials for all new tables, tenant isolation tests, migration drift, object reference integrity, row counts and import/export round trip. Keep rollback point and scripts until post-migration acceptance.

### Rollback

Before contract/drop, rollback means route traffic back to the previous application and restore the pre-migration database/object-store snapshot if writes occurred against new structures; snapshot recovery must be tested. Once the migration is destructive or new CRM writes happen, a down-migration alone is not a safe rollback. Use forward-fix or restore + controlled replay from audited outbox/import logs; define an acceptable recovery point and reconcile any writes. Never promise a lossless rollback without the replay design and rehearsal. Defer dropping old tables for at least one verified release window.

### Keycloak

Keep realm identifier `legal-crm` and client ID `legal-crm-web` for the initial general-CRM release; change realm display name, client display name and user-facing app branding only. This avoids issuer/subject changes and OIDC discovery, redirect URI, existing sessions, role-mapping and backup/restore disruption. Remove legal group/role mapping in application authorization with a compatibility map first. A future realm rename is a separate planned identity migration: create or rename with import/export rehearsal, issuer/subject and user-link verification, client secret/redirect rotation, session invalidation communication, rollback and staged account migration. Do not rename the realm as an incidental part of the product pivot.

## Delivery phases and PR sizing (proposal)

| Phase / PR | Scope | Target size |
|---|---|---:|
| 0 — approved product plan | Review this proposal; settle domain naming, legacy finance/data disposition and migration decision | docs only |
| 1 — CRM generalization | Replace legal copy/roles and legal workflows; generalize Companies/Contacts/Deals/Pipelines/Activities; remove legal portal and finance only after data/archive disposition is approved; retain generic security/document/audit/AI controls | 3–5 focused PRs, ideally 200–500 changed lines each; schema/migration PR isolated |
| 2 — CSV/vCard import core | Upload/mapping/validation/preview/job progress/error report/idempotent row imports and conservative duplicate review | 3–4 PRs, 250–600 lines each; service/contracts, worker, wizard/e2e separated |
| 3 — vendor presets | Five column-map presets plus fixture coverage/docs | 1–2 PRs, <500 lines each |
| 4 — connector framework | Credential reference lifecycle, connection/sync state, incremental sync, rate limiting, webhook verification and observability | 3–5 PRs, <600 lines each; security review before secret-bearing paths |
| 5 — first connector + public API/webhooks | HubSpot adapter first; versioned REST API, scoped PATs, outbound webhooks; n8n/Zapier examples | 3–5 PRs, <600 lines each; vendor API contract tests and security review |
| 6 — export and cleanup | Full CSV/JSON export, remove deprecated compatibility code after acceptance, README/docs scan | 1–3 PRs, <500 lines each |

Each PR is a green, independently reviewable change, squash-merged to linear-history main only after required CI/checks pass. No PR deploys to CT600 without explicit opus/user approval. Public-copy cleanup must include README, SECURITY, architecture/ADR/compliance/deployment docs and all demo/fixture text; preserve security/compliance controls where they remain generic and accurate.

## Test and release strategy

- **Unit:** Zod validation, CSV/vCard parsing and type conversion, header matching, saved mapping versioning, duplicate scoring, merge invariants, source-ID idempotency, stage/pipeline transitions, custom field validation, export serialization, connector cursor/retry/rate-limit state machine, webhook signature/replay handling, AI suggestion stale-version and approval.
- **Integration:** PostgreSQL migrations, tenant RLS/default-deny on every new table, cross-tenant ID substitution, transactional import/merge/audit/outbox, repeated imports, worker crash/retry/resume, object quarantine/scan and deletion, OpenBao secret reference lookup without DB plaintext, and realistic anonymized vendor-format fixtures for all five exports.
- **E2E:** Playwright import wizard from upload to saved mapping, dry-run, error download and completion progress; duplicate review/merge; contact/company/deal navigation and owner/task activity; export download and tenant boundary. Include failure/retry and no-worker states.
- **Migration rehearsal:** restored DB/object store, forward/backfill/verify/rollback rehearsal, row/hash/fk counts, production credentials RLS verification, Keycloak login and issuer continuity. CI must never connect to live CT601/CT603.
- **Acceptance gates:** no exposed plaintext connector secrets; no cross-tenant access; no unscanned attachment downloads; audited approved changes; user can export tenant data; import retries do not duplicate records; key identity continuity; all existing security tests and required CI checks green.

## Principal risks and decisions required before P2

1. **Finance and records disposition (blocking):** existing schema includes invoices, time entries, LawPay identifiers, immutable trust ledger, payment events and accounting periods. Decide whether these are abandoned demo-only artifacts, separately archived/exported, or maintained in a separate product. Do not drop or repurpose them without approval.
2. **Matter ambiguity:** some Matter rows may actually be service cases, not opportunities. Require tenant/customer-level classification before mapping or deleting; provide export and preserve uncertain records.
3. **Legal holds/retention:** preserve held records and existing audit/evidence regardless of product copy. Decide generic retention defaults and data deletion policy before changing purge semantics.
4. **Import quality and merge risk:** fuzzy duplicate detection can combine distinct people; use suggestions and human-reviewed, audited merge only. External IDs are source-scoped and may be absent or unstable.
5. **Tenant security and job reliability:** untrusted files, tenant context, queue retries, webhooks, large exports and custom fields expand attack surface; enforce size/row limits, scan/quarantine, least privilege, durable outbox and per-tenant rate limits.
6. **Identity/environment compatibility:** existing realm/client and env/image names are deployed interfaces. Keep aliases and staged rotation until every deployment is verified.
7. **Scope creep:** generic CRM import, APIs, connectors and export form separate milestones; no simultaneous provider integrations. HubSpot is a proposal pending current vendor policy review.
8. **Decision gate:** approve the target vocabulary and removal/archival policy, especially finance, existing Matter records, legal holds and the portal, before schema/production work. P2 remains unapproved until explicit review of this plan.

## Source inventory pointers

Core inspection set: `packages/db/prisma/schema.prisma`; `packages/db/src/services/{matter,client-portal,finance,retention-evidence,document,ai,contact,organization}-service.ts`; `packages/db/prisma/seed.ts` and `packages/db/prisma/migrations/*`; `packages/domain/src/index.ts`; `packages/contracts/src/index.ts`; `packages/fixtures/**`; `apps/web/src/app/api/v1/{matters,portal,finance,retention-policies,tenant/client-shares,imports}/**`; `apps/web/src/app/{matters,portal,billing,deals,contacts,organizations}/**`; `apps/web/src/components/{matter-actions,client-portal,finance-actions,import-prospects}.tsx`; inference-worker prompt/evaluation paths and platform-worker document scan/import queue paths; `apps/web/e2e/eve-demo.spec.ts`; `docs/adr/0001`–`0005`, `docs/compliance/**`, architecture/deployment/security/local development docs; `.env.example`, `deploy/{internal,split}/**`, Keycloak bootstrap (`deploy/split/identity/bootstrap-keycloak.sh`); README/SECURITY. Use a fresh case-insensitive repository-wide scan at implementation time, including migration SQL, CI/deploy scripts and generated fixtures, and review every match rather than bulk-renaming strings.
