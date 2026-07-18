import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

export const createNoteInputSchema = z.object({
  dealId: z.string().uuid(),
  body: z.string().trim().min(1).max(50_000),
});

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export async function createNoteWithAiJob(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: CreateNoteInput,
) {
  const input = createNoteInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    const deal = await tx.deal.findFirst({
      where: { id: input.dealId, tenantId: context.tenantId, archivedAt: null },
      select: { id: true },
    });
    if (!deal) throw new Error('Deal not found.');
    const note = await tx.note.create({
      data: {
        tenantId: context.tenantId,
        dealId: input.dealId,
        body: input.body,
        createdBy: context.actorId,
      },
    });
    const aiJob = await tx.aiJob.create({
      data: { tenantId: context.tenantId, noteId: note.id },
    });
    await tx.outboxEvent.create({
      data: {
        tenantId: context.tenantId,
        aggregateType: 'AiJob',
        aggregateId: aiJob.id,
        eventType: 'AI_EXTRACTION_REQUESTED',
        payload: { aiJobId: aiJob.id },
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'note.created',
      entityType: 'Note',
      entityId: note.id,
      entityVersion: note.version,
      diff: { dealId: input.dealId, aiJobId: aiJob.id },
    });
    return { note, aiJob };
  });
}
