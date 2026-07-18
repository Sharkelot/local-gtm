import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { scoreContactDuplicate } from '@local-gtm/domain';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

export const prospectImportRowSchema = z.object({
  organization: z.string().trim().min(1).max(300),
  industry: z.string().trim().max(200).optional().default('Law firm'),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).optional().or(z.literal('')),
  phone: z.string().trim().max(50).optional().default(''),
  title: z.string().trim().max(200).optional().default(''),
});

export const importProspectsInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().trim().min(8).max(200),
  rows: z.array(prospectImportRowSchema).min(1).max(10_000),
});

const normalize = (value: string | undefined) =>
  value?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';

export async function importProspects(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof importProspectsInputSchema>,
) {
  const input = importProspectsInputSchema.parse(unparsedInput);
  const requestHash = createHash('sha256').update(JSON.stringify(input.rows)).digest('hex');
  return withTenant(client, context, async (tx) => {
    const prior = await tx.importRun.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: context.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new Error('Idempotency key was reused with different import data.');
      return prior;
    }
    const run = await tx.importRun.create({
      data: {
        tenantId: context.tenantId,
        filename: input.filename,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        status: 'PROCESSING',
        rowsTotal: input.rows.length,
        createdBy: context.actorId,
      },
    });
    const createdIds: string[] = [];
    for (const row of input.rows) {
      const normalizedName = normalize(row.organization);
      const organization = await tx.organization.upsert({
        where: { tenantId_normalizedName: { tenantId: context.tenantId, normalizedName } },
        create: {
          tenantId: context.tenantId,
          name: row.organization,
          normalizedName,
          industry: row.industry,
        },
        update: { industry: row.industry },
      });
      const contact = await tx.contact.create({
        data: {
          tenantId: context.tenantId,
          organizationId: organization.id,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email || null,
          normalizedEmail: normalize(row.email) || null,
          phone: row.phone || null,
          normalizedPhone: normalize(row.phone) || null,
          title: row.title || null,
        },
      });
      createdIds.push(contact.id);
    }
    const contacts = await tx.contact.findMany({
      where: { tenantId: context.tenantId, archivedAt: null },
      include: { organization: true },
      orderBy: { id: 'asc' },
    });
    let duplicateCount = 0;
    for (let leftIndex = 0; leftIndex < contacts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < contacts.length; rightIndex += 1) {
        const left = contacts[leftIndex]!;
        const right = contacts[rightIndex]!;
        if (!createdIds.includes(left.id) && !createdIds.includes(right.id)) continue;
        const score = scoreContactDuplicate(
          { ...left, organizationName: left.organization?.name ?? null },
          { ...right, organizationName: right.organization?.name ?? null },
        );
        if (!score.isCandidate) continue;
        const existing = await tx.duplicateCandidate.findUnique({
          where: {
            tenantId_leftContactId_rightContactId: {
              tenantId: context.tenantId,
              leftContactId: left.id,
              rightContactId: right.id,
            },
          },
        });
        if (!existing) {
          await tx.duplicateCandidate.create({
            data: {
              tenantId: context.tenantId,
              organizationId:
                left.organizationId === right.organizationId ? left.organizationId : null,
              leftContactId: left.id,
              rightContactId: right.id,
              score: score.score,
              reasons: [...score.reasons],
            },
          });
          duplicateCount += 1;
        }
      }
    }
    const completed = await tx.importRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        rowsImported: createdIds.length,
        duplicateCount,
        completedAt: new Date(),
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'import.completed',
      entityType: 'ImportRun',
      entityId: run.id,
      diff: {
        filename: input.filename,
        rowsImported: createdIds.length,
        duplicateCandidates: duplicateCount,
      },
    });
    return completed;
  });
}
