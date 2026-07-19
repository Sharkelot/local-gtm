# Local development

## Prerequisites

- Node.js 24
- pnpm 10.15
- PostgreSQL 17
- Redis 7

## Setup

1. Clone the repository.
2. Copy `.env.example` to `.env` and replace placeholders with local-only values.
3. Install dependencies:

```powershell
pnpm install
```

4. Generate the Prisma client and apply migrations:

```powershell
pnpm --filter @local-gtm/db db:generate
pnpm --filter @local-gtm/db db:migrate
pnpm --filter @local-gtm/db db:seed
```

5. Start development processes:

```powershell
pnpm dev
```

## Quality commands

```powershell
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

## Synthetic data

Seed data describes fictional firms, matters, and contacts. Do not import real
client records into the public repository or shared development databases.

## Identity in development

Local development may use placeholder Keycloak settings from `.env.example`.
Production deployments require a configured realm with self-registration disabled
and an explicit redirect URI allowlist.

## Windows inference worker

The inference worker runs only on the Windows LM Studio host. See
[deploy/windows-inference-worker/README.md](../deploy/windows-inference-worker/README.md).

Use RFC 5737 documentation addresses such as `192.0.2.70` in examples; replace
them with your private application CT address during installation.
