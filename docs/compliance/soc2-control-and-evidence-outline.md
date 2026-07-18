# SOC 2 Security, Availability, and Confidentiality outline

## Scope and ownership

SOC 2 is an independent CPA examination, not a product certification. Management must define the system boundary, assign control owners, approve policies, operate controls, and retain evidence. This outline supports a Type I design assessment followed by a Type II operating-effectiveness period.

## Control/evidence register

| Area              | Control objective                                | Example evidence                                                         |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Access            | Least privilege, MFA, timely deprovisioning      | Keycloak settings, quarterly access reviews, termination tickets         |
| Change            | Reviewed, tested, approved production changes    | Protected-branch rules, CI results, release/deployment approvals         |
| Security          | Secrets, encryption, vulnerability remediation   | OpenBao policies/token TTLs, key rotation, scans, remediation records    |
| Availability      | Monitored service and recoverable data           | Alerts, uptime records, backup success, restore/failover drills          |
| Confidentiality   | Tenant isolation and protected document access   | RLS tests, authorization tests, access audit events, retention/hold logs |
| Incident response | Detected, triaged, contained, learned from       | Incident log, tabletop exercises, post-incident actions                  |
| Vendors           | External dependencies are assessed and monitored | Vendor inventory, risk reviews, contracts/attestations                   |

## Type I gate

Before examination, finalize system description, risk assessment, control matrix, policies, evidence owners, and a dated sample of implemented controls. Obtain CPA scoping and management assertion; remediate design gaps.

## Type II gate

After Type I, operate the controls through the agreed observation period. Preserve recurring evidence, exceptions, remediation, and management review records. The CPA determines the period and report outcome.
