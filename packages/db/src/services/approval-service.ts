import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idempotencyKeySchema } from '@local-gtm/contracts';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

export const decideSuggestionInputSchema = z.object({
  suggestionId: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema,
});

export async function decideAiSuggestion(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof decideSuggestionInputSchema>,
) {
  const input = decideSuggestionInputSchema.parse(unparsedInput);
  return withTenant(client, context, async (tx) => {
    const requestHash = createHash('sha256')
      .update(`${input.suggestionId}:${input.decision}:${input.reason}`)
      .digest('hex');
    const prior = await tx.idempotencyRecord.findUnique({
      where: {
        tenantId_operation_key: {
          tenantId: context.tenantId,
          operation: 'ai-suggestion-decision',
          key: input.idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new Error('Idempotency key was reused with different input.');
      return tx.aiSuggestion.findFirstOrThrow({
        where: { id: input.suggestionId, tenantId: context.tenantId },
      });
    }
    await tx.idempotencyRecord.create({
      data: {
        tenantId: context.tenantId,
        operation: 'ai-suggestion-decision',
        key: input.idempotencyKey,
        requestHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const suggestion = await tx.aiSuggestion.findFirstOrThrow({
      where: { id: input.suggestionId, tenantId: context.tenantId },
      include: { aiJob: { include: { note: { include: { deal: true } } } } },
    });
    if (suggestion.status !== 'PENDING') throw new Error('Suggestion has already been decided.');
    if (suggestion.aiJob.note.version !== suggestion.sourceVersion) {
      await tx.aiSuggestion.update({ where: { id: suggestion.id }, data: { status: 'STALE' } });
      throw new Error('Suggestion source is stale.');
    }
    if (input.decision === 'REJECT') {
      const rejected = await tx.aiSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'REJECTED', decidedBy: context.actorId, decidedAt: new Date() },
      });
      await appendAuditEvent(tx, context, {
        action: 'ai_suggestion.rejected',
        entityType: 'AiSuggestion',
        entityId: suggestion.id,
        diff: { kind: suggestion.kind },
        reason: input.reason,
      });
      return rejected;
    }

    const value = z.union([z.string(), z.boolean(), z.number()]).parse(suggestion.proposedValue);
    switch (suggestion.kind) {
      case 'SECURITY_CONCERN':
        await tx.organization.update({
          where: { id: suggestion.aiJob.note.deal.organizationId },
          data: {
            securityConcern: true,
            securityConcerns: { push: String(value) },
            version: { increment: 1 },
          },
        });
        break;
      case 'INTEGRATION_REQUIREMENT':
        await tx.organization.update({
          where: { id: suggestion.aiJob.note.deal.organizationId },
          data: { integrationRequirements: { push: String(value) }, version: { increment: 1 } },
        });
        break;
      case 'FOLLOW_UP_DATE':
        await tx.deal.update({
          where: { id: suggestion.aiJob.note.dealId },
          data: { followUpAt: new Date(String(value)), version: { increment: 1 } },
        });
        break;
      case 'DECISION_MAKER': {
        const [firstName = '', ...lastParts] = String(value).trim().split(/\s+/);
        const lastName = lastParts.join(' ');
        const contact = await tx.contact.findFirst({
          where: {
            tenantId: context.tenantId,
            organizationId: suggestion.aiJob.note.deal.organizationId,
            firstName: { equals: firstName, mode: 'insensitive' },
            lastName: { equals: lastName, mode: 'insensitive' },
          },
        });
        if (!contact)
          throw new Error('Proposed decision maker is not an existing organization contact.');
        await tx.contact.update({
          where: { id: contact.id },
          data: { isDecisionMaker: true, version: { increment: 1 } },
        });
        break;
      }
      case 'GENERAL_FIELD_UPDATE':
        throw new Error('General updates require a field-specific approval handler.');
    }
    const approved = await tx.aiSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'APPROVED', decidedBy: context.actorId, decidedAt: new Date() },
    });
    await appendAuditEvent(tx, context, {
      action: 'ai_suggestion.approved',
      entityType: 'AiSuggestion',
      entityId: suggestion.id,
      diff: { kind: suggestion.kind, targetField: suggestion.targetField },
      reason: input.reason,
    });
    return approved;
  });
}
