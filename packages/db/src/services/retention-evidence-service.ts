import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, type TenantTransaction, withTenant } from '../tenant.js';

const recordTypeSchema = z.enum(['DOCUMENT', 'MATTER', 'INVOICE', 'AUDIT_EVENT']);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'A SHA-256 digest is required.');

export const upsertRetentionPolicyInputSchema = z
  .object({
    recordType: recordTypeSchema,
    retentionDays: z.number().int().min(1).max(36_500),
    legalHold: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();

export const registerEvidenceInputSchema = z
  .object({
    recordType: recordTypeSchema,
    recordId: z.string().uuid(),
    evidenceType: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Z][A-Z0-9_ -]*$/),
    sha256: sha256Schema,
    objectKey: z.string().trim().min(1).max(1_024).optional(),
    objectVersion: z.string().trim().min(1).max(255).optional(),
    capturedAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((input) => Boolean(input.objectKey) === Boolean(input.objectVersion), {
    message: 'objectKey and objectVersion must be provided together.',
  });

export const listEvidenceInputSchema = z
  .object({
    recordType: recordTypeSchema.optional(),
    recordId: z.string().uuid().optional(),
    take: z.number().int().min(1).max(250).default(100),
  })
  .strict();

export const documentPurgeEligibilityInputSchema = z
  .object({
    documentCreatedAt: z.coerce.date(),
    documentRetentionAt: z.coerce.date().nullable(),
    documentLegalHold: z.boolean(),
    policyRetentionDays: z.number().int().min(1).max(36_500).nullable(),
    policyLegalHold: z.boolean(),
    secondConfirmation: z.literal(true),
    now: z.coerce.date().optional(),
  })
  .strict();

const retentionAdminRoles = ['TENANT_ADMIN'] as const;
const evidenceRoles = ['TENANT_ADMIN', 'AUDITOR'] as const;

async function requireRole(
  tx: TenantTransaction,
  context: TenantContext,
  roles: readonly string[],
) {
  if (context.actorType !== 'USER') throw new Error('An authenticated user is required.');
  const membership = await tx.membership.findFirst({
    where: { tenantId: context.tenantId, identityId: context.actorId, active: true },
    select: { role: true },
  });
  if (!membership || !roles.includes(membership.role)) throw new Error('Actor is not authorized.');
}

async function assertRecordInTenant(
  tx: TenantTransaction,
  tenantId: string,
  recordType: z.infer<typeof recordTypeSchema>,
  recordId: string,
) {
  const where = { id: recordId, tenantId };
  const record =
    recordType === 'DOCUMENT'
      ? await tx.document.findFirst({ where, select: { id: true } })
      : recordType === 'MATTER'
        ? await tx.matter.findFirst({ where, select: { id: true } })
        : recordType === 'INVOICE'
          ? await tx.invoice.findFirst({ where, select: { id: true } })
          : await tx.auditEvent.findFirst({ where, select: { id: true } });
  if (!record) throw new Error('Referenced record was not found in this tenant.');
}

export async function upsertRetentionPolicy(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof upsertRetentionPolicyInputSchema>,
) {
  const input = upsertRetentionPolicyInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    await requireRole(tx, context, retentionAdminRoles);
    const policy = await tx.retentionPolicy.upsert({
      where: { tenantId_recordType: { tenantId: context.tenantId, recordType: input.recordType } },
      create: { tenantId: context.tenantId, createdBy: context.actorId, ...input },
      update: {
        retentionDays: input.retentionDays,
        legalHold: input.legalHold,
        active: input.active,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'retention_policy.upserted',
      entityType: 'RetentionPolicy',
      entityId: policy.id,
      diff: {
        recordType: policy.recordType,
        retentionDays: policy.retentionDays,
        legalHold: policy.legalHold,
        active: policy.active,
      },
    });
    return policy;
  });
}

export async function registerEvidence(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof registerEvidenceInputSchema>,
) {
  const input = registerEvidenceInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    await requireRole(tx, context, evidenceRoles);
    await assertRecordInTenant(tx, context.tenantId, input.recordType, input.recordId);
    const evidence = await tx.evidenceRecord.create({
      data: {
        tenantId: context.tenantId,
        capturedBy: context.actorId,
        recordType: input.recordType,
        recordId: input.recordId,
        evidenceType: input.evidenceType,
        sha256: input.sha256.toLowerCase(),
        ...(input.objectKey && input.objectVersion
          ? { objectKey: input.objectKey, objectVersion: input.objectVersion }
          : {}),
        ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'evidence.registered',
      entityType: 'EvidenceRecord',
      entityId: evidence.id,
      diff: {
        recordType: evidence.recordType,
        recordId: evidence.recordId,
        evidenceType: evidence.evidenceType,
        sha256: evidence.sha256,
        hasObjectReference: Boolean(evidence.objectKey),
      },
    });
    return evidence;
  });
}

export async function listEvidence(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof listEvidenceInputSchema> = {},
) {
  const input = listEvidenceInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    await requireRole(tx, context, evidenceRoles);
    return tx.evidenceRecord.findMany({
      where: {
        tenantId: context.tenantId,
        ...(input.recordType ? { recordType: input.recordType } : {}),
        ...(input.recordId ? { recordId: input.recordId } : {}),
      },
      orderBy: { capturedAt: 'desc' },
      take: input.take,
    });
  });
}

/** Guard only: physical object/database deletion remains an explicit separate operation. */
export function assertDocumentPurgeEligible(unparsedInput: unknown): void {
  const input = documentPurgeEligibilityInputSchema.parse(unparsedInput);
  if (input.documentLegalHold || input.policyLegalHold)
    throw new Error('Document or retention policy is under legal hold.');
  const policyDeadline = input.policyRetentionDays
    ? new Date(input.documentCreatedAt.getTime() + input.policyRetentionDays * 86_400_000)
    : null;
  const retentionDeadline = [input.documentRetentionAt, policyDeadline]
    .filter((deadline): deadline is Date => deadline !== null)
    .reduce<Date | null>(
      (latest, deadline) => (!latest || deadline > latest ? deadline : latest),
      null,
    );
  if (!retentionDeadline) throw new Error('No elapsed retention deadline authorizes a purge.');
  if (retentionDeadline > (input.now ?? new Date()))
    throw new Error('Document retention period has not elapsed.');
}
