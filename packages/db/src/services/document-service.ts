import type { DocumentScanStatus, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

const documentWriteRoles = ['TENANT_ADMIN', 'ATTORNEY', 'STAFF'] as const;
const documentReadRoles = [...documentWriteRoles, 'AUDITOR'] as const;

export const uploadDocumentMetadataInputSchema = z
  .object({
    matterId: z.string().uuid(),
    name: z.string().trim().min(1).max(500),
    objectKey: z.string().trim().min(1).max(1024),
    objectVersion: z.string().trim().min(1).max(255),
    encryptedDataKey: z.string().trim().min(1).max(10_000),
    contentType: z.string().trim().min(1).max(255),
    sizeBytes: z.bigint().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    retentionAt: z.coerce.date().optional(),
    legalHold: z.boolean().default(false),
  })
  .strict();

export const documentScanResultInputSchema = z
  .object({
    documentId: z.string().uuid(),
    result: z.enum(['CLEAN', 'REJECTED']),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.result === 'REJECTED' && !input.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A rejection reason is required.',
        path: ['reason'],
      });
    }
  });

export function assertDocumentScanTransition(
  current: DocumentScanStatus,
  result: 'CLEAN' | 'REJECTED',
) {
  if (current !== 'QUARANTINED')
    throw new Error('Only quarantined documents may receive a scan result.');
  return result === 'CLEAN' ? 'CLEAN' : ('INFECTED' as const);
}

export function assertDocumentBytesAccessible(scanStatus: DocumentScanStatus): void {
  if (scanStatus !== 'CLEAN')
    throw new Error('Document bytes are unavailable until the scan is clean.');
}

export function assertDocumentDestructionAllowed(document: {
  legalHold: boolean;
  retentionAt: Date | null;
}): void {
  if (document.legalHold) throw new Error('Document is under legal hold.');
  if (document.retentionAt && document.retentionAt > new Date()) {
    throw new Error('Document retention period has not elapsed.');
  }
}

async function requireDocumentRole(
  tx: Parameters<typeof appendAuditEvent>[0],
  context: TenantContext,
  roles: readonly string[],
) {
  if (context.actorType !== 'USER')
    throw new Error('Document operation requires an authenticated user.');
  const membership = await tx.membership.findFirst({
    where: { tenantId: context.tenantId, identityId: context.actorId, active: true },
    select: { role: true },
  });
  if (!membership || !roles.includes(membership.role)) {
    throw new Error('Actor is not authorized for document operations.');
  }
}

export async function uploadDocumentMetadata(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof uploadDocumentMetadataInputSchema>,
) {
  const input = uploadDocumentMetadataInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    await requireDocumentRole(tx, context, documentWriteRoles);
    const matter = await tx.matter.findFirst({
      where: { id: input.matterId, tenantId: context.tenantId, archivedAt: null },
      select: { id: true },
    });
    if (!matter) throw new Error('Matter not found.');
    const document = await tx.document.create({
      data: {
        tenantId: context.tenantId,
        matterId: input.matterId,
        name: input.name,
        legalHold: input.legalHold,
        ...(input.retentionAt ? { retentionAt: input.retentionAt } : {}),
        createdBy: context.actorId,
        scanStatus: 'QUARANTINED',
        versions: {
          create: {
            version: 1,
            objectKey: input.objectKey,
            objectVersion: input.objectVersion,
            encryptedDataKey: input.encryptedDataKey,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256.toLowerCase(),
            createdBy: context.actorId,
          },
        },
      },
      include: { versions: true },
    });
    await appendAuditEvent(tx, context, {
      action: 'document.upload_quarantined',
      entityType: 'Document',
      entityId: document.id,
      diff: { matterId: document.matterId, scanStatus: document.scanStatus, version: 1 },
    });
    await tx.outboxEvent.create({
      data: {
        tenantId: context.tenantId,
        aggregateType: 'Document',
        aggregateId: document.id,
        eventType: 'DOCUMENT_SCAN_REQUESTED',
        payload: { tenantId: context.tenantId, documentId: document.id },
      },
    });
    return document;
  });
}

export async function recordDocumentScanResult(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof documentScanResultInputSchema>,
) {
  const input = documentScanResultInputSchema.parse(unparsedInput);
  if (!['SYSTEM', 'INTEGRATION'].includes(context.actorType)) {
    throw new Error('Only a scanner service may record a document scan result.');
  }
  return withTenant(client, context, async (tx) => {
    const current = await tx.document.findFirst({
      where: { id: input.documentId, tenantId: context.tenantId },
    });
    if (!current) throw new Error('Document not found.');
    const scanStatus = assertDocumentScanTransition(current.scanStatus, input.result);
    const document = await tx.document.update({ where: { id: current.id }, data: { scanStatus } });
    const auditInput = {
      action: input.result === 'CLEAN' ? 'document.scan_clean' : 'document.scan_rejected',
      entityType: 'Document',
      entityId: document.id,
      diff: { scanStatus: document.scanStatus },
      ...(input.reason ? { reason: input.reason } : {}),
    };
    await appendAuditEvent(tx, context, auditInput);
    return document;
  });
}

export async function getCleanDocumentVersionForAccess(
  client: PrismaClient,
  context: TenantContext,
  documentId: string,
) {
  const parsedId = z.string().uuid().parse(documentId);
  return withTenant(client, context, async (tx) => {
    await requireDocumentRole(tx, context, documentReadRoles);
    const document = await tx.document.findFirst({
      where: { id: parsedId, tenantId: context.tenantId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!document) throw new Error('Document not found.');
    assertDocumentBytesAccessible(document.scanStatus);
    const version = document.versions[0];
    if (!version) throw new Error('Document has no stored version.');
    return version;
  });
}
