import { randomUUID } from 'node:crypto';
import { platformPrisma, type TenantContext } from '@local-gtm/db';

export async function getAiJobForInternalUse(aiJobId: string) {
  return platformPrisma.aiJob.findUnique({
    where: { id: aiJobId },
    include: {
      note: { include: { deal: { include: { organization: true } } } },
      attempts: {
        orderBy: { attemptNumber: 'desc' },
        take: 1,
        select: { errorMessage: true },
      },
    },
  });
}

export function workerContext(tenantId: string): TenantContext {
  return {
    tenantId,
    actorId: process.env.INFERENCE_WORKER_ACTOR_ID ?? '10000000-0000-4000-8000-000000000020',
    actorType: 'AI_WORKER',
    correlationId: randomUUID(),
  };
}
