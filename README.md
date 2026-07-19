# Local GTM

Local GTM is a **local-first, AI-assisted legal CRM demo**. PostgreSQL is the
source of truth, BullMQ delivers asynchronous work, and LM Studio suggestions
remain advisory until a user explicitly approves them.

All records shipped in this repository are **synthetic and fictional**. This
public repository does **not** include production configuration, secrets, or
access to any hosted instance. Deployed environments remain private and require
approved Keycloak users.

## What is in this repository

- Application source (`apps/*`, `packages/*`)
- Sanitized deployment templates (`deploy/`)
- Synthetic seed data and fixtures
- Public architecture and security documentation

## What is intentionally excluded

- Production `.env` files and secrets
- Private network addresses
- Cloudflare, Keycloak, or database credentials
- Customer or matter data from live systems

## Workspace

| Path                    | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `apps/web`              | Next.js UI and `/api/v1` handlers                |
| `apps/platform-worker`  | Outbox dispatch and background work              |
| `apps/inference-worker` | Windows LM Studio worker                         |
| `packages/*`            | Contracts, domain rules, Prisma services         |
| `deploy/`               | Compose templates, pull-based deployment scripts |
| `docs/`                 | Architecture, security, and operations guides    |

## Quality gates

```powershell
pnpm install
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

GitHub Actions runs the same gates on pull requests and protected `main`, then
publishes immutable container images to GHCR after successful `main` builds.

## Deployment model

1. GitHub-hosted CI validates changes and builds images.
2. After protected `main` CI succeeds, images publish to GHCR with commit-SHA tags.
3. A dedicated local deployment CT (`local-gtm-deployer`) polls GHCR outbound,
   pulls an operator-approved digest, runs migrations, deploys, health-checks,
   and rolls back on failure.

See [docs/deployment-model.md](docs/deployment-model.md).

## Security

- No anonymous CRM access in production configurations.
- Keycloak self-registration disabled; only pre-created users may authenticate.
- Database, Redis, document storage, and admin services remain LAN-only.
- Cloudflare Tunnel is the intended public ingress path.

See [SECURITY.md](SECURITY.md) and [docs/security-model.md](docs/security-model.md).

## License

MIT — see [LICENSE](LICENSE).
