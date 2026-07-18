import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

/**
 * Validates an explicit provider message/event link. Persistence is intentionally absent:
 * the current Prisma schema has no tenant-owned communication, provider-message, or link model.
 */
export const explicitProviderCommunicationLinkSchema = z
  .object({
    connectionId: z.string().uuid(),
    provider: z.enum(['MICROSOFT', 'GOOGLE']),
    itemType: z.enum(['MESSAGE', 'EVENT']),
    providerItemId: z.string().trim().min(1).max(500),
    matterId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.matterId || value.organizationId), {
    message: 'A provider communication must be explicitly linked to a matter or organization.',
  });

export function assertNoMailboxWideIngestion(
  input: z.input<typeof explicitProviderCommunicationLinkSchema>,
) {
  return explicitProviderCommunicationLinkSchema.parse(input);
}

export async function linkProviderCommunication(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof explicitProviderCommunicationLinkSchema>,
) {
  const input = explicitProviderCommunicationLinkSchema.parse(unparsedInput);
  if (context.actorType !== 'USER')
    throw new Error('Provider communications must be explicitly linked by a user.');
  return withTenant(client, context, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { tenantId: context.tenantId, identityId: context.actorId, active: true },
      select: { id: true },
    });
    if (!membership) throw new Error('Active tenant membership is required.');
    const connection = await tx.integrationConnection.findFirst({
      where: {
        id: input.connectionId,
        tenantId: context.tenantId,
        provider: input.provider,
        enabled: true,
      },
      select: { id: true },
    });
    if (!connection) throw new Error('Enabled provider connection not found.');
    if (input.matterId) {
      const matter = await tx.matter.findFirst({
        where: { id: input.matterId, tenantId: context.tenantId, archivedAt: null },
        select: { id: true },
      });
      if (!matter) throw new Error('Matter not found.');
    }
    if (input.organizationId) {
      const organization = await tx.organization.findFirst({
        where: { id: input.organizationId, tenantId: context.tenantId, archivedAt: null },
        select: { id: true },
      });
      if (!organization) throw new Error('Organization not found.');
    }
    const linked = await tx.linkedCommunication.create({
      data: {
        tenantId: context.tenantId,
        connectionId: input.connectionId,
        provider: input.provider,
        itemType: input.itemType,
        providerItemId: input.providerItemId,
        matterId: input.matterId ?? null,
        organizationId: input.organizationId ?? null,
        subject: input.subject ?? null,
        occurredAt: input.occurredAt ?? null,
        linkedBy: context.actorId,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'communication.linked',
      entityType: 'LinkedCommunication',
      entityId: linked.id,
      diff: {
        provider: linked.provider,
        itemType: linked.itemType,
        matterId: linked.matterId,
        organizationId: linked.organizationId,
      },
    });
    return linked;
  });
}
