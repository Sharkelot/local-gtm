import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, type TenantTransaction, withTenant } from '../tenant.js';

export const clientPortalDocumentInputSchema = z.object({ documentId: z.string().uuid() }).strict();
export const listClientPortalMattersInputSchema = z.object({}).strict();
const idempotencyKeySchema = z.string().trim().min(8).max(200);
const uuidSchema = z.string().uuid();
const shareTargetSchema = z.object({
  clientMembershipId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});
export const grantClientMatterShareInputSchema = shareTargetSchema
  .extend({ matterId: uuidSchema })
  .strict();
export const revokeClientMatterShareInputSchema = shareTargetSchema
  .extend({ matterId: uuidSchema })
  .strict();
export const grantClientDocumentShareInputSchema = shareTargetSchema
  .extend({ documentId: uuidSchema })
  .strict();
export const revokeClientDocumentShareInputSchema = shareTargetSchema
  .extend({ documentId: uuidSchema })
  .strict();

type PortalMembership = { role: string; active: boolean } | null;

export function assertClientPortalMembership(membership: PortalMembership): asserts membership is {
  role: 'CLIENT';
  active: true;
} {
  if (!membership?.active || membership.role !== 'CLIENT')
    throw new Error('An active client membership is required for portal access.');
}

async function requireClientMembership(tx: TenantTransaction, context: TenantContext) {
  if (context.actorType !== 'USER')
    throw new Error('Client portal access requires an authenticated user.');
  const membership = await tx.membership.findFirst({
    where: { tenantId: context.tenantId, identityId: context.actorId },
    select: { id: true, role: true, active: true },
  });
  assertClientPortalMembership(membership);
  return membership;
}

async function requireTenantAdmin(tx: TenantTransaction, context: TenantContext) {
  if (context.actorType !== 'USER')
    throw new Error('Share management requires an authenticated user.');
  const membership = await tx.membership.findFirst({
    where: {
      tenantId: context.tenantId,
      identityId: context.actorId,
      active: true,
      role: 'TENANT_ADMIN',
    },
    select: { id: true },
  });
  if (!membership)
    throw new Error('Tenant-admin authorization is required to manage client shares.');
}

async function requireTargetClientMembership(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
) {
  const membership = await tx.membership.findFirst({
    where: { id: membershipId, tenantId, role: 'CLIENT', active: true },
    select: { id: true },
  });
  if (!membership) throw new Error('An active client membership in this tenant is required.');
  return membership;
}

function requestHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
async function findIdempotent(
  tx: TenantTransaction,
  context: TenantContext,
  operation: string,
  key: string,
  hash: string,
) {
  const existing = await tx.idempotencyRecord.findUnique({
    where: { tenantId_operation_key: { tenantId: context.tenantId, operation, key } },
  });
  if (existing && existing.requestHash !== hash)
    throw new Error('Idempotency key was reused with different request data.');
  return existing;
}
async function recordIdempotent(
  tx: TenantTransaction,
  context: TenantContext,
  operation: string,
  key: string,
  hash: string,
  response: object,
) {
  await tx.idempotencyRecord.create({
    data: {
      tenantId: context.tenantId,
      operation,
      key,
      requestHash: hash,
      response,
      statusCode: 200,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

export async function grantClientMatterShare(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof grantClientMatterShareInputSchema>,
) {
  const input = grantClientMatterShareInputSchema.parse(unparsedInput);
  const hash = requestHash(input);
  return withTenant(client, context, async (tx) => {
    await requireTenantAdmin(tx, context);
    const replay = await findIdempotent(
      tx,
      context,
      'client_share.matter.grant',
      input.idempotencyKey,
      hash,
    );
    if (replay) {
      const id = (replay.response as { shareId?: string } | null)?.shareId;
      if (!id) throw new Error('Stored idempotency response is invalid.');
      return tx.clientMatterShare.findFirstOrThrow({ where: { id, tenantId: context.tenantId } });
    }
    await requireTargetClientMembership(tx, context.tenantId, input.clientMembershipId);
    const matter = await tx.matter.findFirst({
      where: { id: input.matterId, tenantId: context.tenantId, archivedAt: null },
      select: { id: true },
    });
    if (!matter) throw new Error('Matter was not found.');
    const share = await tx.clientMatterShare.upsert({
      where: {
        tenantId_membershipId_matterId: {
          tenantId: context.tenantId,
          membershipId: input.clientMembershipId,
          matterId: matter.id,
        },
      },
      create: {
        tenantId: context.tenantId,
        membershipId: input.clientMembershipId,
        matterId: matter.id,
        sharedBy: context.actorId,
      },
      update: {},
    });
    await appendAuditEvent(tx, context, {
      action: 'client_matter_share.granted',
      entityType: 'ClientMatterShare',
      entityId: share.id,
      diff: { clientMembershipId: share.membershipId, matterId: share.matterId },
    });
    await recordIdempotent(tx, context, 'client_share.matter.grant', input.idempotencyKey, hash, {
      shareId: share.id,
    });
    return share;
  });
}

export async function grantClientDocumentShare(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof grantClientDocumentShareInputSchema>,
) {
  const input = grantClientDocumentShareInputSchema.parse(unparsedInput);
  const hash = requestHash(input);
  return withTenant(client, context, async (tx) => {
    await requireTenantAdmin(tx, context);
    const replay = await findIdempotent(
      tx,
      context,
      'client_share.document.grant',
      input.idempotencyKey,
      hash,
    );
    if (replay) {
      const id = (replay.response as { shareId?: string } | null)?.shareId;
      if (!id) throw new Error('Stored idempotency response is invalid.');
      return tx.clientDocumentShare.findFirstOrThrow({ where: { id, tenantId: context.tenantId } });
    }
    await requireTargetClientMembership(tx, context.tenantId, input.clientMembershipId);
    const document = await tx.document.findFirst({
      where: { id: input.documentId, tenantId: context.tenantId },
      select: { id: true, matterId: true },
    });
    if (!document) throw new Error('Document was not found.');
    const matterShare = await tx.clientMatterShare.findFirst({
      where: {
        tenantId: context.tenantId,
        membershipId: input.clientMembershipId,
        matterId: document.matterId,
      },
      select: { id: true },
    });
    if (!matterShare) throw new Error('A matter share is required before sharing a document.');
    const share = await tx.clientDocumentShare.upsert({
      where: {
        tenantId_membershipId_documentId: {
          tenantId: context.tenantId,
          membershipId: input.clientMembershipId,
          documentId: document.id,
        },
      },
      create: {
        tenantId: context.tenantId,
        membershipId: input.clientMembershipId,
        documentId: document.id,
        sharedBy: context.actorId,
      },
      update: {},
    });
    await appendAuditEvent(tx, context, {
      action: 'client_document_share.granted',
      entityType: 'ClientDocumentShare',
      entityId: share.id,
      diff: {
        clientMembershipId: share.membershipId,
        documentId: share.documentId,
        matterId: document.matterId,
      },
    });
    await recordIdempotent(tx, context, 'client_share.document.grant', input.idempotencyKey, hash, {
      shareId: share.id,
    });
    return share;
  });
}

async function revokeShare(
  client: PrismaClient,
  context: TenantContext,
  kind: 'matter' | 'document',
  input: {
    clientMembershipId: string;
    idempotencyKey: string;
    matterId?: string;
    documentId?: string;
  },
) {
  const hash = requestHash(input);
  const operation = `client_share.${kind}.revoke`;
  return withTenant(client, context, async (tx) => {
    await requireTenantAdmin(tx, context);
    const replay = await findIdempotent(tx, context, operation, input.idempotencyKey, hash);
    if (replay) return replay.response;
    await requireTargetClientMembership(tx, context.tenantId, input.clientMembershipId);
    const matterId = input.matterId;
    const documentId = input.documentId;
    if (kind === 'matter' && !matterId) throw new Error('Matter share target is required.');
    if (kind === 'document' && !documentId) throw new Error('Document share target is required.');
    const share =
      kind === 'matter'
        ? await tx.clientMatterShare.findFirst({
            where: {
              tenantId: context.tenantId,
              membershipId: input.clientMembershipId,
              matterId: matterId!,
            },
            select: { id: true, matterId: true },
          })
        : await tx.clientDocumentShare.findFirst({
            where: {
              tenantId: context.tenantId,
              membershipId: input.clientMembershipId,
              documentId: documentId!,
            },
            select: { id: true, documentId: true },
          });
    if (!share) throw new Error('Client share was not found.');
    if (kind === 'matter') {
      const childDocumentShares = await tx.clientDocumentShare.count({
        where: {
          tenantId: context.tenantId,
          membershipId: input.clientMembershipId,
          document: { matterId: matterId! },
        },
      });
      if (childDocumentShares > 0)
        throw new Error('Revoke shared documents before revoking their parent matter share.');
    }
    if (kind === 'matter') await tx.clientMatterShare.delete({ where: { id: share.id } });
    else await tx.clientDocumentShare.delete({ where: { id: share.id } });
    await appendAuditEvent(tx, context, {
      action: `client_${kind}_share.revoked`,
      entityType: kind === 'matter' ? 'ClientMatterShare' : 'ClientDocumentShare',
      entityId: share.id,
      diff: {
        clientMembershipId: input.clientMembershipId,
        ...(kind === 'matter' ? { matterId: input.matterId } : { documentId: input.documentId }),
      },
    });
    const response = { revokedShareId: share.id };
    await recordIdempotent(tx, context, operation, input.idempotencyKey, hash, response);
    return response;
  });
}
export async function revokeClientMatterShare(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof revokeClientMatterShareInputSchema>,
) {
  return revokeShare(
    client,
    context,
    'matter',
    revokeClientMatterShareInputSchema.parse(unparsedInput),
  );
}
export async function revokeClientDocumentShare(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof revokeClientDocumentShareInputSchema>,
) {
  return revokeShare(
    client,
    context,
    'document',
    revokeClientDocumentShareInputSchema.parse(unparsedInput),
  );
}

export async function listClientPortalMatters(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof listClientPortalMattersInputSchema> = {},
) {
  listClientPortalMattersInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    const membership = await requireClientMembership(tx, context);
    const shares = await tx.clientMatterShare.findMany({
      where: {
        tenantId: context.tenantId,
        membershipId: membership.id,
        matter: { archivedAt: null },
      },
      include: {
        matter: {
          select: {
            id: true,
            matterNumber: true,
            name: true,
            status: true,
            practiceArea: true,
            documents: {
              where: {
                tenantId: context.tenantId,
                scanStatus: 'CLEAN',
                clientShares: { some: { tenantId: context.tenantId, membershipId: membership.id } },
              },
              select: { id: true, name: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return shares.map(({ matter }) => matter);
  });
}

export async function getClientPortalDocumentMetadata(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof clientPortalDocumentInputSchema>,
) {
  const input = clientPortalDocumentInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    const membership = await requireClientMembership(tx, context);
    const document = await tx.document.findFirst({
      where: {
        id: input.documentId,
        tenantId: context.tenantId,
        scanStatus: 'CLEAN',
        clientShares: { some: { tenantId: context.tenantId, membershipId: membership.id } },
        matter: {
          archivedAt: null,
          clientShares: { some: { tenantId: context.tenantId, membershipId: membership.id } },
        },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        versions: {
          select: { version: true, contentType: true, sizeBytes: true, sha256: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!document) throw new Error('Shared clean document was not found.');
    const version = document.versions[0];
    if (!version) throw new Error('Shared document has no stored version.');
    return {
      documentId: document.id,
      name: document.name,
      createdAt: document.createdAt,
      version: version.version,
      contentType: version.contentType,
      sizeBytes: version.sizeBytes,
      sha256: version.sha256,
    };
  });
}
