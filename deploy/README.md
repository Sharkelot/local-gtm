# Production deployment template

Deploy from a dedicated Debian VM on Proxmox. Docker is the only application runtime on that VM. PostgreSQL, Redis, MinIO, OpenBao, and observability services have no published host ports; Caddy is the sole ingress container.

## Before first start

1. Create a private DNS zone and restrict the host firewall to WireGuard clients for `APP_DOMAIN`, `KEYCLOAK_DOMAIN`, and `GRAFANA_DOMAIN`. The `HOOKS_DOMAIN` is the only public application hostname and should permit only the exact provider webhook routes.
2. Copy [`.env.example`](../.env.example) to `.env`; use a secret manager or an approved break-glass procedure to populate it. Never put production values in Compose or Git.
3. Build application images with immutable digest references, then set `WEB_IMAGE`, `PLATFORM_WORKER_IMAGE`, and `MIGRATOR_IMAGE`. Record the three digests in the release evidence.
4. On a new PostgreSQL volume, Compose uses the bootstrap credential only to create dedicated migration, runtime, platform, reporting, and Keycloak roles. Keep the bootstrap credential in break-glass storage; it is not an application connection credential. Role creation changes require an empty volume or an approved, reviewed role-rotation procedure.
5. Build/start the stack: `docker compose --env-file .env -f deploy/compose.production.yml up -d --build`. The one-shot `migrator` service must finish successfully before web or the platform worker starts. Investigate its logs and do not bypass this dependency after a migration failure.
6. Initialize and unseal OpenBao, enable KV v2 and Transit, then store root tokens and recovery shares outside this VM. Configure a workload auth method that issues short-lived, policy-scoped tokens; `OPENBAO_TOKEN` is a bootstrap delivery mechanism only and must be rotated/revoked after workload auth is proven.
7. Configure Keycloak realm MFA (including recovery-code policy), restrict the admin hostname/path to the WireGuard administration group, and use a separate named administrator account from ordinary user identities. Keycloak uses its own PostgreSQL schema and login, not the application role.
8. The initial Compose template keeps PostgreSQL private to Docker networks. Before a policy requires in-network database TLS, mount managed server certificates and enable `ssl=on`; do not enable it without the certificate/key material.
9. The one-shot `minio-bootstrap` service creates `MINIO_DOCUMENT_BUCKET` with object lock and versioning, applies the configured default GOVERNANCE retention, and provisions the scanner-only MinIO principal. It must finish before the platform worker starts. Object lock cannot be retrofitted onto an existing bucket: if this service reports a retention failure, create/restore a correctly locked bucket through an approved migration rather than disabling retention or recreating evidence storage.

## MinIO credential lifecycle

`MINIO_ROOT_*` credentials are bootstrap-only and appear only in the MinIO server and the one-shot bootstrap container. The platform worker receives `MINIO_SCANNER_*`, whose policy permits only `GetObject` and `GetObjectVersion` for the document bucket; it cannot enumerate, mutate, delete, or administer storage. The bootstrap service deliberately reapplies that policy and updates the scanner secret on a controlled restart, so rotate the scanner key by updating the approved secret source and running only `minio-bootstrap` while the worker is stopped/restarted.

This Compose template uses environment placeholders until OpenBao workload authentication is operational. Before production promotion, inject root and scanner credentials through the approved short-lived OpenBao bootstrap/workload flow, revoke the bootstrap token, and retain the credential-rotation evidence. Rotating the MinIO root credential itself remains an operator-controlled MinIO procedure; do not assume this bootstrap service rotates it.

The host firewall, WireGuard, Cloudflare DNS token scope, provider webhook IP policy, database migrations, backup target, alert receiver, and TLS renewal monitoring are operational prerequisites; this template deliberately cannot make those external guarantees itself. Ports 80/443 do not make the CRM, Keycloak, or Grafana public: the host firewall/reverse-proxy network policy must admit them only from WireGuard/private ranges. `HOOKS_DOMAIN` is the deliberate public exception and exposes only the enumerated webhook paths.

## Network boundary

- `edge`: Caddy ingress only.
- `app`: application dependencies; no direct host ingress.
- `data`: persistence plane; only application services can reach it.
- `observability`: telemetry plane; no direct host ingress.

## Database-role boundary

- `legal_crm_bootstrap`: initial-volume creation and emergency recovery only; no workload service uses it.
- `legal_crm_migrator`: owns Prisma-created application objects and is used by the one-shot migration image only.
- `legal_crm_runtime`: web request database URL; forced tenant RLS still requires transaction-local tenant context.
- `legal_crm_platform`: platform worker URL and web internal API URL. It has the narrowly required `BYPASSRLS` privilege for durable dispatcher and authenticated inference-worker cross-tenant lookups; access is limited to internal Docker networks and must be separately access-reviewed.
- `legal_crm_reporting`: read-only grants with RLS still enforced; a reporting query must set a tenant context or use an approved future reporting boundary.
- `keycloak`: owns only the `keycloak` schema.

The initialization script applies default privileges for objects subsequently created by the migrator. Review grants after every migration that introduces extensions, security-definer functions, or a non-`public` schema.

Webhook route rate limits, replay detection, signatures, and idempotency must be enforced by the Next.js route/service layer because Caddy has no persistent knowledge of provider event IDs.

## Operations runbooks

- [Backup and restore](runbooks/backup-restore.md)
- [OpenBao recovery](runbooks/openbao-recovery.md)
- [Incident response](runbooks/incident-response.md)
