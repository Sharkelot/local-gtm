# CT603 identity and observability operator checklist

This CT exposes Keycloak HTTPS (`8443`), Grafana HTTPS (`3000`), and OTLP/HTTP HTTPS (`4318`) only on its private/VPN address. CT600 Caddy proxies to the first two services and its workloads send telemetry to OTLP with certificate verification using the inter-CT CA bundle. Never route these ports publicly. PostgreSQL is CT601 and must remain TLS-only.

## Before first start

1. Copy `../identity.env.example` to a protected `.env` alongside `compose.identity.yml`, replace every placeholder with a release-pinned image digest or approved secret, and set the CT603 private address. `.env` is ignored by Git; do not use the example digests.
2. Place the CT601 CA certificate at `postgres-ca/root.crt`, restrict file permissions, and verify `KEYCLOAK_DATABASE_URL` uses CT601's certificate hostname with `sslmode=verify-full`.
3. Confirm CT601 has the `keycloak` schema role from its initialization procedure and firewall access is limited to CT603. Test no plaintext PostgreSQL route is accepted.
4. Provision `tls/keycloak.crt`, `tls/keycloak.key`, `tls/grafana.crt`, `tls/grafana.key`, `tls/otel.crt`, and `tls/otel.key` through the approved secret/certificate process. Each leaf must cover the private hostname or IP used by CT600. Keys must be readable by the container and never committed. See [`tls/README.md`](tls/README.md).
5. Install the issuing CA bundle at CT600's configured `PRIVATE_CA_BUNDLE_PATH`; Caddy validates both CT603 upstream certificates against it. Do not use Caddy `tls_insecure_skip_verify`, plaintext upstream URLs, or public certificate issuance as a substitute.
6. Restrict CT603 firewall ingress to CT600's private address and approved VPN/admin subnets. Permit TCP 8443 and 3000 only to their approved consumers and TCP 4318 only from CT600; do not publish ports for Prometheus, Alertmanager, or Loki. Restrict the identity-admin hostname to the administrator VPN/routing group at Caddy and the firewall.

## Bootstrap and realm operation

1. For one controlled bootstrap only, inject `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` with a protected temporary Compose override; start Keycloak and sign in through the restricted admin hostname. These variables are intentionally absent from steady-state `compose.identity.yml`.
2. Create the `legal-crm` realm, confidential application client, exact redirect URIs, token/session limits, and least-privilege realm administrator. Disable public self-registration, password recovery unless formally approved, and all unreviewed identity-provider/broker flows.
3. Require MFA for every administrator using an explicit realm authentication flow (WebAuthn or TOTP), test it with a second administrator, and keep recovery codes/break-glass access in the approved protected procedure.
4. Remove the temporary bootstrap override, recreate Keycloak, and verify normal realm administration still works while the bootstrap account is not relied on.
5. Do not claim realm, client, MFA, users, roles, or admin routing are configured merely because this Compose manifest is running: all are operator-controlled and must be evidenced.

## Ongoing checks

1. Validate rendering only before any deployment: `docker compose --env-file .env -f compose.identity.yml config`. This check does not validate certificate presence, key permissions, CA trust, DNS, or firewall policy.
2. Monitor Keycloak readiness, certificate expiry, Prometheus storage, Loki storage, Grafana access, and alert delivery. Test an alert route and a backup/restore procedure before production use.
3. Rotate PostgreSQL, Keycloak bootstrap/recovery, and Grafana credentials under the approved change process. Persistent volumes contain operational state; do not delete them to rotate credentials.
