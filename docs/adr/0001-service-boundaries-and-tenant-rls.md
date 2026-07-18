# ADR 0001: Service boundaries and tenant RLS

Status: Accepted

## Decision

Use one PostgreSQL database with `tenant_id` on each tenant-owned row, forced row-level security, and default-deny policies. Separate migration-owner, runtime, platform-admin, and reporting roles. Each service operation opens a transaction and sets a transaction-local tenant context derived from the authenticated membership.

Next.js route handlers authenticate and parse Zod requests only. Domain services perform authorization, business validation, tenant-context setup, repository access, and audit writes. React components do not contain business logic.

## Consequences

Cross-tenant ID substitution is denied at both service and database layers. Database migrations and tests must demonstrate RLS default deny. Direct repository access, request-supplied tenant IDs, and `BYPASSRLS` runtime roles are prohibited.
