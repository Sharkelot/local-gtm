# Contributing

Thank you for improving Local GTM. This project is intended to remain a safe,
public portfolio repository.

## Before you start

1. Read [AGENTS.md](AGENTS.md) for architecture and security boundaries.
2. Read [docs/security-model.md](docs/security-model.md) and [SECURITY.md](SECURITY.md).
3. Never include production secrets, private addresses, or real customer data.

## Development workflow

```powershell
pnpm install
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

Integration tests expect local PostgreSQL and Redis or the disposable services
used in CI.

## Pull requests

- Open pull requests against `main`.
- Keep changes focused and explain failure cases in the PR description.
- Ensure CI passes before requesting review.
- Do not add self-hosted runners, repository secrets for PR jobs, or
  `pull_request_target` workflows.

## Documentation

Use placeholders such as:

- `crm.example.com`
- `auth.example.com`
- `APP_SERVER`, `DATABASE_SERVER`, `IDENTITY_SERVER`, `DOCUMENT_SERVER`

Production-only values belong in local files outside the repository, for example
`/etc/local-gtm/crm.env`.

## Code review expectations

- Services own authorization, transactions, RLS context, and audit writes.
- Route handlers authenticate and parse Zod input only.
- AI output remains advisory until explicitly approved by a user.
- Ledger entries remain immutable; corrections use linked reversals.
