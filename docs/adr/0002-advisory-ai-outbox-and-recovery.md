# ADR 0002: Advisory AI, transactional outbox, and queue recovery

Status: Accepted

## Decision

Creating an AI-eligible note atomically stores the note, `AiJob`, and PostgreSQL outbox record. A dispatcher publishes deterministic BullMQ jobs that contain only `aiJobId`. Redis is delivery infrastructure, not the system of record.

The Windows inference worker fetches a scoped prompt from an authenticated internal API, calls LM Studio at `127.0.0.1:1234`, and submits raw output. The server retains attempts, parses a discriminated Zod extraction contract, and stores evidence-backed suggestions only. AI never mutates CRM records. A human approval revalidates authorization, source/target version, and constraints, applies the selected change through a service, and writes an audit event in the same transaction.

## Failure handling

Use `QUEUED`, `WAITING_FOR_WORKER`, `WAITING_FOR_INFERENCE`, `PROCESSING`, `COMPLETED`, `FAILED_VALIDATION`, and `FAILED_TERMINAL`. Missing heartbeats set `WAITING_FOR_WORKER`; unavailable LM Studio delays retry with jittered exponential backoff capped at five minutes without consuming validation retries. Invalid output is encrypted, visible, audited, retried twice with correction context, then marked `FAILED_VALIDATION`. Outbox reconciliation re-enqueues every nonterminal job after Redis recovery. All handlers are idempotent.
