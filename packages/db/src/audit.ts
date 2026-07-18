import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TenantContext, TenantTransaction } from './tenant.js';

export interface AppendAuditInput {
  action: string;
  entityType: string;
  entityId: string;
  entityVersion?: number | null;
  diff?: Prisma.InputJsonValue;
  reason?: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function appendAuditEvent(
  tx: TenantTransaction,
  context: TenantContext,
  input: AppendAuditInput,
) {
  // Serialize the hash chain per tenant so concurrent mutations cannot fork it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId}, 0))`;
  const previous = await tx.auditEvent.findFirst({
    where: { tenantId: context.tenantId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true, eventHash: true },
  });
  const sequence = (previous?.sequence ?? 0n) + 1n;
  const createdAt = new Date();
  const redactedDiff = input.diff ?? {};
  const hashPayload = {
    tenantId: context.tenantId,
    sequence: sequence.toString(),
    actorType: context.actorType,
    actorId: context.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion ?? null,
    redactedDiff,
    reason: input.reason ?? null,
    correlationId: context.correlationId,
    previousHash: previous?.eventHash ?? null,
    createdAt: createdAt.toISOString(),
  };
  const eventHash = createHash('sha256').update(stableJson(hashPayload)).digest('hex');
  return tx.auditEvent.create({
    data: {
      tenantId: context.tenantId,
      sequence,
      actorType: context.actorType,
      actorId: context.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityVersion: input.entityVersion ?? null,
      redactedDiff,
      reason: input.reason ?? null,
      correlationId: context.correlationId,
      previousHash: previous?.eventHash ?? null,
      eventHash,
      createdAt,
    },
  });
}
