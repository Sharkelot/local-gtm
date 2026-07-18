# OpenBao recovery runbook

1. Treat unseal keys and root tokens as break-glass material. Keep threshold shares with separate authorized custodians; never commit them or store all shares on the Proxmox VM.
2. Bootstrap a workload auth method from a time-bounded, approved operator session. Bind each workload policy to its service identity, use short TTLs with explicit maximum TTLs, and deliver the initial token through the approved secret-delivery channel. Do not persist a root token in `.env` or an application image.
3. During an outage, start the replacement OpenBao instance in an isolated network, restore the latest encrypted storage snapshot, and have the required custodians unseal it.
4. Verify the audit device, KV v2 mounts, Transit key versions, policies, auth bindings, token TTLs, and application auth method before reconnecting applications.
5. Revoke bootstrap tokens and rotate root, deployment, PostgreSQL-role, and application credentials after recovery; record custodians, approvals, timestamps, validation evidence, and follow-up controls in the evidence register.
