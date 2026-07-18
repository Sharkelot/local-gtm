import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { submitAiResult } from '../src/services/ai-service.js';

describe('submitAiResult', () => {
  it('atomically queues an identifier-only retry after schema-invalid model output', async () => {
    const aiAttemptCreate = vi
      .fn<(input: { data: { errorCode: string; attemptNumber: number } }) => Promise<object>>()
      .mockResolvedValue({});
    const aiJobUpdate = vi
      .fn<(input: { data: { status: string } }) => Promise<object>>()
      .mockResolvedValue({});
    const outboxCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiJob: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000011',
          tenantId: '00000000-0000-4000-8000-000000000001',
          noteId: '00000000-0000-4000-8000-000000000012',
          status: 'PROCESSING',
          validationRetries: 0,
          attempts: [],
          note: {
            id: '00000000-0000-4000-8000-000000000012',
            version: 1,
            dealId: '00000000-0000-4000-8000-000000000013',
            deal: { organizationId: '00000000-0000-4000-8000-000000000014' },
          },
        }),
        update: aiJobUpdate,
      },
      aiAttempt: { create: aiAttemptCreate },
      outboxEvent: { create: outboxCreate },
      aiSuggestion: { create: vi.fn() },
      auditEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: auditCreate,
      },
    };
    const client = {
      $transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
      ),
    } as unknown as PrismaClient;

    const result = await submitAiResult(
      client,
      {
        tenantId: '00000000-0000-4000-8000-000000000001',
        actorId: '00000000-0000-4000-8000-000000000020',
        actorType: 'AI_WORKER',
        correlationId: '00000000-0000-4000-8000-000000000021',
      },
      {
        aiJobId: '00000000-0000-4000-8000-000000000011',
        rawOutput: {},
        protectedRawOutput: 'protected',
      },
    );

    expect(result.job.status).toBe('QUEUED');
    expect(aiAttemptCreate.mock.calls[0]?.[0].data).toMatchObject({
      errorCode: 'SCHEMA_INVALID',
      attemptNumber: 1,
    });
    expect(aiJobUpdate.mock.calls[0]?.[0].data.status).toBe('QUEUED');
    expect(outboxCreate).toHaveBeenCalledWith({
      data: {
        tenantId: '00000000-0000-4000-8000-000000000001',
        aggregateType: 'AiJob',
        aggregateId: '00000000-0000-4000-8000-000000000011',
        eventType: 'AI_EXTRACTION_REQUESTED',
        payload: { aiJobId: '00000000-0000-4000-8000-000000000011' },
      },
    });
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
