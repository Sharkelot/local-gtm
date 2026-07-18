# Private PostgreSQL data CT

This manifest runs only PostgreSQL and an optional one-shot Prisma migrator. It is intended for a private Proxmox CT with a private/VPN host address; it does not publish a database port to every host interface.

## Required before start

1. Copy `data.env.example` to a protected environment file and replace every placeholder using the approved secret delivery process. `MIGRATOR_IMAGE` must be a release-pinned digest.
2. Provision managed TLS files at `postgres/tls/server.crt`, `postgres/tls/server.key`, and `postgres/tls/root.crt`. The certificate must cover the private hostname/IP used by clients. `server.key` must be owned/readable by the PostgreSQL container user and have mode `0600`; a missing or unreadable file prevents PostgreSQL from starting.
3. Restrict the CT and upstream firewall so only approved private application, platform, reporting, and Keycloak hosts can reach `POSTGRES_PRIVATE_BIND_ADDRESS:5432`. Never set the bind address to `0.0.0.0`.
4. Configure an approved encrypted base-backup and WAL archival system before production data is accepted. This Compose file deliberately does not supply a fake `archive_command`, backup sidecar, or backup credentials. The operator must set and test `archive_mode`, a real archival command/agent, retention, encryption, monitoring, and quarterly restore evidence as required by `../runbooks/backup-restore.md`.

`generate-private-pki.sh` creates the private CA and service certificates in a new,
non-versioned output directory. Run it on the deployment host, distribute only each
service's leaf key and CA copy, and keep `ca/ca.key` offline with restricted recovery
access. The leaf certificates cover both the fixed private IPs and internal DNS names
for CTs 601–603. The script refuses to overwrite an existing PKI directory.

Client connections are TLS-only (`hostssl` plus `sslmode=require`). Production clients should use `sslmode=verify-full` with the managed CA at their deployment boundary; do not weaken `pg_hba.conf` to permit plaintext fallback.

## Operations

Validate only:

```sh
docker compose --env-file data.env -f compose.data.yml config
```

Start PostgreSQL only after the prerequisites are met; then run the migration explicitly:

```sh
docker compose --env-file data.env -f compose.data.yml up -d postgres
docker compose --env-file data.env -f compose.data.yml --profile migration run --rm migrator
docker compose --env-file data.env -f compose.data.yml --profile seed run --rm seeder
```

The bootstrap account exists only to initialize a new volume or for controlled recovery. The migration role owns Prisma objects; runtime has tenant RLS; platform has the ADR-approved `BYPASSRLS` dispatcher exception; reporting remains read-only with RLS; and Keycloak owns only its `keycloak` schema. Role creation runs only when `postgres_data` is empty. Rotate roles through an approved procedure, never by deleting a populated volume.
