# ADR 0004: Documents, secrets, audit, and retention

Status: Accepted

## Decision

OpenBao KV holds versioned infrastructure secrets; Transit envelope-encrypts OAuth tokens, provider secrets, protected AI attempts, and document data keys. MinIO stores TLS-protected, versioned document bytes with object lock, retention, and legal hold. PostgreSQL stores metadata and permissions. Uploads remain quarantined until ClamAV reports clean; failures and timeouts remain visible quarantines.

Write append-only audit events with tenant sequence, actor, action, entity/version, redacted diff, reason, correlation ID, timestamp, previous hash, and event hash. Retain signed periodic checkpoints in locked object storage. Archive CRM records by default; hard purge requires authorized retention eligibility, no legal hold, confirmation, and an audit event.

## Consequences

Audit and protected-attempt retention are evidence obligations, not best-effort logs. Restore tests must cover PostgreSQL, MinIO, and cryptographic recovery. Access to bytes is denied until scan and authorization both succeed.
