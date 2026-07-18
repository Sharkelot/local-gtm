# ADR 0003: Identity and private Proxmox deployment

Status: Accepted

## Decision

Deploy Docker Compose on a dedicated Debian VM in Proxmox. Caddy terminates HTTPS with Cloudflare DNS-01 certificates. WireGuard provides private user and client-portal access. Only the VPN entry points, private HTTPS, and a dedicated public webhook hostname are reachable; PostgreSQL, Redis, MinIO, OpenBao, and management endpoints are private.

Use Keycloak in production mode with fixed frontend/admin hostnames, correctly overwritten proxy headers, MFA, and separately restricted administration routing. Tenant identity comes from the authenticated membership, not browser input.

## Consequences

Production promotion requires firewall and routing validation, certificate renewal monitoring, MFA verification, and signed-webhook verification/replay controls. No public self-registration or human-facing public CRM is in the first release.
