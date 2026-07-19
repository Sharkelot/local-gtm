# Security policy

## Scope

Local GTM is a portfolio-quality demo of a local-first legal CRM. The public
repository contains application source, synthetic seed data, and sanitized
configuration examples only. Production secrets, private network addresses, and
hosted instance access are intentionally excluded.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main`  | Yes       |

## Reporting a vulnerability

Do not open public GitHub issues for exploitable security findings.

1. Email the maintainer through the contact method listed in the repository profile.
2. Include reproduction steps, affected components, and impact assessment.
3. Allow reasonable time for remediation before public disclosure.

## Public repository rules

Never commit:

- `.env` files except sanitized `.env.example`
- database URLs with credentials
- internal IP addresses or private hostnames where placeholders are appropriate
- passwords, API tokens, OAuth client secrets, or private keys
- production logs, backups, dumps, or uploaded documents

If a secret was previously committed, rotate the credential immediately and
request history cleaning through the maintainer. Deleting the secret from the
latest commit alone is not sufficient.

## Production security model

- Hosted CRM access requires approved Keycloak users; self-registration is disabled.
- Cloudflare Tunnel is the only intended public ingress path.
- Database, Redis, document storage, and Keycloak admin ports remain LAN-only.
- CI runs on GitHub-hosted runners with read-only repository permissions for pull requests.
- Container images publish to GHCR only after protected `main` CI succeeds.
- Production deployment is pull-based from a dedicated deployment CT; no inbound GitHub webhook or self-hosted runner connects to Proxmox.

## Dependency and CI controls

- Immutable dependency installs in CI (`pnpm install --frozen-lockfile`)
- High-severity dependency audit gate
- Filesystem vulnerability scan (Trivy)
- Secret scanning (Gitleaks)
- Pull-request dependency review
- GitHub Actions pinned to full commit SHAs
