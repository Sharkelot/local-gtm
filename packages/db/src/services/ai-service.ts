import type { PrismaClient } from '@prisma/client';
import { aiExtractionResultSchema } from '@local-gtm/contracts';
import { assertAiJobTransition } from '@local-gtm/domain';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, withTenant } from '../tenant.js';

const kindToTargetField = {
  INTEGRATION_REQUIREMENT: 'integrationRequirements',
  SECURITY_CONCERN: 'securityConcerns',
  FOLLOW_UP_DATE: 'followUpAt',
  DECISION_MAKER: 'decisionMaker',
  GENERAL_FIELD_UPDATE: 'general',
} as const;

export async function markAiJobWaiting(
  client: PrismaClient,
  context: TenantContext,
  aiJobId: string,
  reasonCode: 'WORKER_OFFLINE' | 'LM_STUDIO_OFFLINE' | 'MODEL_UNAVAILABLE' | 'TIMEOUT',
  nextRetryAt?: Date,
) {
  return withTenant(client, context, async (tx) => {
    const current = await tx.aiJob.findFirstOrThrow({
      where: { id: aiJobId, tenantId: context.tenantId },
    });
    const nextStatus =
      reasonCode === 'WORKER_OFFLINE' ? 'WAITING_FOR_WORKER' : 'WAITING_FOR_INFERENCE';
    assertAiJobTransition(current.status, nextStatus);
    const job = await tx.aiJob.update({
      where: { id: aiJobId },
      data: { status: nextStatus, reasonCode, nextRetryAt: nextRetryAt ?? null },
    });
    await appendAuditEvent(tx, context, {
      action: 'ai_job.waiting',
      entityType: 'AiJob',
      entityId: aiJobId,
      diff: { from: current.status, to: nextStatus, reasonCode },
    });
    return job;
  });
}

export async function markAiJobProcessing(
  client: PrismaClient,
  context: TenantContext,
  aiJobId: string,
) {
  return withTenant(client, context, async (tx) => {
    const current = await tx.aiJob.findFirstOrThrow({
      where: { id: aiJobId, tenantId: context.tenantId },
    });
    if (current.status === 'PROCESSING') return current;
    assertAiJobTransition(current.status, 'PROCESSING');
    const job = await tx.aiJob.update({
      where: { id: aiJobId },
      data: { status: 'PROCESSING', reasonCode: null, startedAt: new Date(), nextRetryAt: null },
    });
    await appendAuditEvent(tx, context, {
      action: 'ai_job.processing',
      entityType: 'AiJob',
      entityId: aiJobId,
      diff: { from: current.status, to: 'PROCESSING' },
    });
    return job;
  });
}

export interface SubmitAiResultInput {
  aiJobId: string;
  rawOutput: unknown;
  protectedRawOutput: string;
}

export async function submitAiResult(
  client: PrismaClient,
  context: TenantContext,
  input: SubmitAiResultInput,
) {
  return withTenant(client, context, async (tx) => {
    const job = await tx.aiJob.findFirstOrThrow({
      where: { id: input.aiJobId, tenantId: context.tenantId },
      include: { note: { include: { deal: true } }, attempts: true },
    });
    if (job.status === 'COMPLETED') return { job, duplicate: true as const };
    const attemptNumber = job.attempts.length + 1;
    const parsed = aiExtractionResultSchema.safeParse(input.rawOutput);
    const sourceMismatch = parsed.success
      ? parsed.data.suggestions.some(
          (suggestion) =>
            suggestion.sourceNoteId !== job.noteId ||
            suggestion.sourceNoteVersion !== job.note.version,
        )
      : false;
    const parseErrorMessage = parsed.success
      ? null
      : parsed.error.issues
          .map((issue) => issue.message)
          .join('; ')
          .slice(0, 2000);
    if (!parsed.success || sourceMismatch) {
      const validationRetries = job.validationRetries + 1;
      const nextStatus = validationRetries >= 3 ? 'FAILED_VALIDATION' : 'QUEUED';
      const errorCode = sourceMismatch ? 'SOURCE_MISMATCH' : 'SCHEMA_INVALID';
      const errorMessage = sourceMismatch
        ? 'AI suggestion source does not match the queued note version.'
        : (parseErrorMessage ?? 'Unknown schema validation error.');
      await tx.aiAttempt.create({
        data: {
          tenantId: context.tenantId,
          aiJobId: job.id,
          attemptNumber,
          encryptedRawOutput: input.protectedRawOutput,
          errorCode,
          errorMessage,
        },
      });
      await tx.aiJob.update({
        where: { id: job.id },
        data: { status: nextStatus, validationRetries, reasonCode: errorCode },
      });
      if (nextStatus === 'QUEUED') {
        await tx.outboxEvent.create({
          data: {
            tenantId: context.tenantId,
            aggregateType: 'AiJob',
            aggregateId: job.id,
            eventType: 'AI_EXTRACTION_REQUESTED',
            payload: { aiJobId: job.id },
          },
        });
      }
      await appendAuditEvent(tx, context, {
        action: 'ai_job.invalid_output',
        entityType: 'AiJob',
        entityId: job.id,
        diff: { attemptNumber, nextStatus },
      });
      return { job: { ...job, status: nextStatus }, duplicate: false as const };
    }

    await tx.aiAttempt.create({
      data: {
        tenantId: context.tenantId,
        aiJobId: job.id,
        attemptNumber,
        encryptedRawOutput: input.protectedRawOutput,
      },
    });
    for (const suggestion of parsed.data.suggestions) {
      const targetEntityId =
        suggestion.type === 'FOLLOW_UP_DATE' || suggestion.type === 'DECISION_MAKER'
          ? job.note.dealId
          : job.note.deal.organizationId;
      await tx.aiSuggestion.create({
        data: {
          id: suggestion.suggestionId,
          tenantId: context.tenantId,
          aiJobId: job.id,
          kind: suggestion.type,
          evidenceText: suggestion.evidence.quote,
          confidence: suggestion.confidence,
          targetEntityType: suggestion.target.split('.')[0] ?? 'unknown',
          targetEntityId,
          targetField: kindToTargetField[suggestion.type],
          proposedValue: suggestion.value,
          sourceVersion: suggestion.sourceNoteVersion,
        },
      });
    }
    const completed = await tx.aiJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        reasonCode: null,
        modelId: parsed.data.suggestions[0]?.modelId ?? job.modelId,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'ai_job.completed',
      entityType: 'AiJob',
      entityId: job.id,
      diff: { suggestionCount: parsed.data.suggestions.length, attemptNumber },
    });
    return { job: completed, duplicate: false as const };
  });
}
