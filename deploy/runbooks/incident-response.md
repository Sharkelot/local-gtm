# Incident response runbook

1. Triage and assign an incident commander. Preserve logs, audit events, and relevant container/image digests.
2. Contain by revoking affected credentials, isolating workloads/networks, or disabling webhook ingress as appropriate. Do not delete queues, audit events, or invalid AI attempts.
3. Assess tenant impact, record timeline and decisions, and notify approved stakeholders using the incident communications policy.
4. Recover from verified backups or a known-good release, validate RLS, audit chain, queue reconciliation, and document access before reopening service.
5. Complete root-cause analysis, corrective actions, evidence retention, and management review.
