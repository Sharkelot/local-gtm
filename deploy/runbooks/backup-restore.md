# Backup and restore runbook

## Objective

Meet the target RPO of one hour and RTO of four hours. The backup target is the separately administered private site; its credentials and host details are intentionally not stored here.

## Backup procedure

1. Run encrypted PostgreSQL base backups plus WAL archival at least hourly. Verify the backup manifest, recovery target, encryption-key availability, and retention policy.
2. Replicate MinIO buckets with versioning, object-lock retention, and legal holds preserved. Back up the Compose configuration, Caddy data, OpenBao storage snapshots, OpenBao recovery procedure references (never recovery shares), and application/migrator release digests.
3. Record backup job result, object count, checksum, timestamp, operator/service identity, destination, encryption-key reference, and retention result in the evidence register. Alert on missed RPO.

## Monthly restore drill

1. Create an isolated restore VM/network; never restore into production networks.
2. Restore PostgreSQL to the selected recovery point, restore MinIO objects and metadata, and recover OpenBao using its approved procedure.
3. Start a release-pinned Compose stack against the restored services. Verify tenant RLS isolation, document access, audit-chain verification, and a sample queued AI job.
4. Verify the one-shot migrator reports no pending or failed migration, application/runtime credentials cannot connect as the bootstrap role, Keycloak is using the `keycloak` schema, and OpenBao workload credentials can be freshly issued.
5. Measure elapsed recovery time, record data-loss window and failures, attach commands/logs/screenshots, release digests, and approver to the evidence register, and create remediation tickets for any RPO/RTO miss.

## Incident restore

Declare an incident, preserve evidence, select the last verified recovery point, follow the restore drill, rotate credentials after recovery, and obtain incident commander approval before restoring user access.
