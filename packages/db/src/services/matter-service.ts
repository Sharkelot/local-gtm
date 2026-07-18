import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

const matterStatusSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_ -]*$/);

export const createMatterInputSchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    matterNumber: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(500),
    status: matterStatusSchema,
    practiceArea: z.string().trim().min(1).max(200).optional(),
    openedAt: z.coerce.date().optional(),
  })
  .strict();

export const updateMatterInputSchema = z
  .object({
    matterId: z.string().uuid(),
    name: z.string().trim().min(1).max(500).optional(),
    status: matterStatusSchema.optional(),
    practiceArea: z.string().trim().min(1).max(200).nullable().optional(),
    openedAt: z.coerce.date().nullable().optional(),
    closedAt: z.coerce.date().nullable().optional(),
    legalHold: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, 'At least one matter field is required.');

const matterWriteRoles = ['TENANT_ADMIN', 'ATTORNEY', 'STAFF'] as const;

async function requireMatterWriter(
  tx: Parameters<typeof appendAuditEvent>[0],
  context: TenantContext,
) {
  if (context.actorType !== 'USER')
    throw new Error('Matter changes require an authenticated user.');
  const membership = await tx.membership.findFirst({
    where: { tenantId: context.tenantId, identityId: context.actorId, active: true },
    select: { role: true },
  });
  if (
    !membership ||
    !matterWriteRoles.includes(membership.role as (typeof matterWriteRoles)[number])
  ) {
    throw new Error('Actor is not authorized to change matters.');
  }
}

export async function createMatter(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof createMatterInputSchema>,
) {
  const input = createMatterInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    await requireMatterWriter(tx, context);
    if (input.organizationId) {
      const organization = await tx.organization.findFirst({
        where: { id: input.organizationId, tenantId: context.tenantId, archivedAt: null },
        select: { id: true },
      });
      if (!organization) throw new Error('Organization not found.');
    }
    const matter = await tx.matter.create({
      data: {
        tenantId: context.tenantId,
        matterNumber: input.matterNumber,
        name: input.name,
        status: input.status,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.practiceArea ? { practiceArea: input.practiceArea } : {}),
        ...(input.openedAt ? { openedAt: input.openedAt } : {}),
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'matter.created',
      entityType: 'Matter',
      entityId: matter.id,
      diff: { matterNumber: matter.matterNumber, organizationId: matter.organizationId },
    });
    return matter;
  });
}

export async function updateMatter(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.input<typeof updateMatterInputSchema>,
) {
  const input = updateMatterInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    await requireMatterWriter(tx, context);
    const current = await tx.matter.findFirst({
      where: { id: input.matterId, tenantId: context.tenantId, archivedAt: null },
    });
    if (!current) throw new Error('Matter not found.');
    if (current.legalHold && input.legalHold === false) {
      throw new Error('A matter legal hold cannot be removed through this operation.');
    }
    const { matterId, ...unfilteredData } = input;
    const data: Prisma.MatterUpdateInput = {};
    if (unfilteredData.name !== undefined) data.name = unfilteredData.name;
    if (unfilteredData.status !== undefined) data.status = unfilteredData.status;
    if (unfilteredData.practiceArea !== undefined) data.practiceArea = unfilteredData.practiceArea;
    if (unfilteredData.openedAt !== undefined) data.openedAt = unfilteredData.openedAt;
    if (unfilteredData.closedAt !== undefined) data.closedAt = unfilteredData.closedAt;
    if (unfilteredData.legalHold !== undefined) data.legalHold = unfilteredData.legalHold;
    const matter = await tx.matter.update({ where: { id: matterId }, data });
    const auditDiff = {
      ...(unfilteredData.name !== undefined ? { name: unfilteredData.name } : {}),
      ...(unfilteredData.status !== undefined ? { status: unfilteredData.status } : {}),
      ...(unfilteredData.practiceArea !== undefined
        ? { practiceArea: unfilteredData.practiceArea }
        : {}),
      ...(unfilteredData.openedAt !== undefined
        ? { openedAt: unfilteredData.openedAt?.toISOString() ?? null }
        : {}),
      ...(unfilteredData.closedAt !== undefined
        ? { closedAt: unfilteredData.closedAt?.toISOString() ?? null }
        : {}),
      ...(unfilteredData.legalHold !== undefined ? { legalHold: unfilteredData.legalHold } : {}),
    };
    await appendAuditEvent(tx, context, {
      action: 'matter.updated',
      entityType: 'Matter',
      entityId: matter.id,
      diff: auditDiff,
    });
    return matter;
  });
}
