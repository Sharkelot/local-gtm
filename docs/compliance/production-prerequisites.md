# Production prerequisite checklist

## Required external inputs

- [ ] Proxmox capacity and dedicated Debian VM.
- [ ] Registered domain and zone-scoped Cloudflare DNS-01 token.
- [ ] WireGuard addressing and a second private backup site.
- [ ] Microsoft 365, Google Workspace, and LawPay developer/sandbox credentials and production approvals.
- [ ] OpenBao initialization/recovery custodians, workload auth configuration, short-lived token policy, and secure recovery procedures.
- [ ] Legal/accounting approval for each tenant enabling trust accounting.
- [ ] Management-appointed SOC 2 control owners and independent CPA engagement.

## Release blockers

- [ ] Private network exposure verified; only intended webhook hostname is public.
- [ ] WireGuard/private-ingress firewall enforcement verified for CRM, Keycloak administration, Grafana, and all management endpoints; only the exact signed webhook paths are public.
- [ ] Caddy certificate issuance/renewal, Keycloak MFA/recovery-code policy, separate restricted admin account/route, and proxy-header configuration verified.
- [ ] PostgreSQL bootstrap, migration, runtime, platform, reporting, and Keycloak credentials are distinct; bootstrap access is break-glass only, platform `BYPASSRLS` access is approved/reviewed, and each runtime secret is issued/rotated through OpenBao workload auth.
- [ ] PostgreSQL RLS default deny, tenant substitution, authorization, CSRF, webhook signature/replay, and rate-limit tests pass.
- [ ] Redis outage, dispatcher crash, duplicate delivery, worker-offline, LM Studio-offline, timeout, malformed output, and recovery scenarios pass without data loss.
- [ ] PostgreSQL/MinIO/config/OpenBao recovery material backups are encrypted, replicated, and restore-tested against RPO one hour / RTO four hours, with dated drill evidence and remediation tickets for misses.
- [ ] Monitoring, alert routing, vulnerability management, audit checkpoints, access reviews, retention, and incident response evidence are operating.
- [ ] TypeScript, lint, unit, affected integration, production build, container health, and Playwright acceptance checks pass.
