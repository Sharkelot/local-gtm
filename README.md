# Local GTM

Local GTM is a self-hosted, multi-tenant legal CRM and practice-management platform. PostgreSQL is authoritative, asynchronous delivery uses BullMQ, and local AI suggestions are advisory until a user explicitly approves them.

## Workspace

- `apps/web` — Next.js UI and HTTP API
- `apps/platform-worker` — outbox dispatch and server-side background work
- `apps/inference-worker` — Windows BullMQ worker for LM Studio
- `packages/contracts` — shared Zod and API contracts
- `packages/domain` — framework-independent business rules
- `packages/db` — Prisma schema, RLS migrations, repositories, and transactional services
- `deploy` — Docker Compose, edge, observability, backup, and recovery configuration

## Quality gates

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

Production deployment additionally requires external credentials, a configured Proxmox VM, WireGuard, DNS, off-site backup storage, provider sandbox approval, legal/accounting review, and an independent SOC 2 auditor.
