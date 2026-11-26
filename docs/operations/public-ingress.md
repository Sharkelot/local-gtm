# Public ingress for the hosted CRM demo

The hosted demo URL is `https://crm.afterlifehigh.com`. Requests enter through the Cloudflare Tunnel and the host's loopback-only nginx gateway, then reach the application Caddy virtual host on the CRM node. Preserve the hostname and HTTPS scheme through every proxy hop: Caddy uses it for TLS/SNI and the web application uses it for `NEXTAUTH_URL` and OIDC callback construction. The OIDC issuer is the separately hosted Keycloak realm; do not hard-code client secrets or environment values in this repository.

The application Caddy route sends `/ws` to the realtime gateway and other application paths to the web service. The gateway must forward HTTP/1.1 Upgrade and Connection headers. Keep the database, Redis, object storage, OpenBao, and administration interfaces private. The public app hostname is an authenticated UI, not a license to expose internal services; public webhook routing remains separately constrained to signed provider paths.

## Deploy / verify

Deploy from a reviewed release using the normal immutable-image deployment process in [deploy/README.md](../../deploy/README.md). Do not edit a running container or copy a production `.env` into Git. Configure the tunnel ingress to the loopback nginx HTTPS origin with `crm.afterlifehigh.com` as both HTTP Host and TLS origin server name. Nginx must proxy to the CRM Caddy HTTPS listener with SNI `crm.afterlifehigh.com`; validate with `nginx -t` before reload.

After deployment, check the application health endpoint, verify the unauthenticated UI redirects into the configured Keycloak realm, and verify the OIDC callback returns to the CRM hostname. Exercise `/ws` with an authenticated WebSocket client. Compare all public host responses with the host's approved route baseline. Keep the gateway configuration and tunnel configuration backups outside this repository; never commit credentials, customer data, database dumps, or production environment files.

Operational repair evidence (2026-11-25): tunnel rule corrected from the stopped proxy container to the host loopback gateway; nginx vhost added to proxy to the existing CRM Caddy service. See the operator's private homelab change log for host-specific backups and rollback details.
