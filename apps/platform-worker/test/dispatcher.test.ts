import { describe, expect, it, vi } from 'vitest';
import {
  OutboxDispatcher,
  type AiQueue,
  type Logger,
  type DocumentScanQueue,
  type OutboxRepository,
  type ProviderWebhookQueue,
} from '../src/dispatcher.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const jobOne = '00000000-0000-4000-8000-000000000011';
const jobA = '00000000-0000-4000-8000-000000000012';
const jobB = '00000000-0000-4000-8000-000000000013';
function createRepository(events: readonly { id: string; eventType: string; payload: unknown }[]) {
  return {
    listDispatchableOutboxEvents: vi.fn().mockResolvedValue(events),
    markOutboxPublished: vi.fn().mockResolvedValue(undefined),
    markOutboxFailed: vi.fn().mockResolvedValue(undefined),
    listNonterminalAiJobIds: vi.fn().mockResolvedValue([]),
    listRecoverableWebhookEventIds: vi.fn().mockResolvedValue([]),
    listQuarantinedDocumentIds: vi.fn().mockResolvedValue([]),
  } satisfies OutboxRepository;
}
function createQueue(): AiQueue & { add: ReturnType<typeof vi.fn> } {
  return {
    add: vi.fn().mockResolvedValue({
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}
function createProviderWebhookQueue(): ProviderWebhookQueue & { add: ReturnType<typeof vi.fn> } {
  return { add: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue(undefined) };
}
function createDocumentScanQueue(): DocumentScanQueue & { add: ReturnType<typeof vi.fn> } {
  return {
    add: vi.fn().mockResolvedValue({
      getState: vi.fn().mockResolvedValue('waiting'),
      retry: vi.fn().mockResolvedValue(undefined),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}
const logger: Logger = { info: vi.fn(), error: vi.fn() };

describe('OutboxDispatcher', () => {
  it('publishes an aiJobId-only payload with a deterministic BullMQ job ID', async () => {
    const repo = createRepository([
      { id: 'outbox-1', eventType: 'AI_EXTRACTION_REQUESTED', payload: { aiJobId: jobOne } },
    ]);
    const queue = createQueue();
    const providerQueue = createProviderWebhookQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      queue,
      providerQueue,
      createDocumentScanQueue(),
      logger,
      () => now,
    );
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 1, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      'ai-extraction',
      { aiJobId: jobOne },
      { jobId: `ai-extraction-${jobOne}` },
    );
    expect(repo.markOutboxPublished).toHaveBeenCalledWith('outbox-1', now);
  });

  it('records invalid events and queue failures for recovery instead of discarding them', async () => {
    const repo = createRepository([
      {
        id: 'outbox-2',
        eventType: 'AI_EXTRACTION_REQUESTED',
        payload: { note: 'must never reach Redis' },
      },
    ]);
    const queue = createQueue();
    const providerQueue = createProviderWebhookQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      queue,
      providerQueue,
      createDocumentScanQueue(),
      logger,
      () => now,
    );
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 0, failed: 1 });
    expect(queue.add).not.toHaveBeenCalled();
    expect(repo.markOutboxFailed).toHaveBeenCalledWith(
      'outbox-2',
      expect.any(String),
      new Date(now.getTime() + 30_000),
    );
  });

  it('re-enqueues nonterminal jobs idempotently after queue recovery', async () => {
    const repo = createRepository([]);
    repo.listNonterminalAiJobIds.mockResolvedValue([jobA, jobB]);
    const queue = createQueue();
    const providerQueue = createProviderWebhookQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      queue,
      providerQueue,
      createDocumentScanQueue(),
      logger,
      () => now,
    );
    await expect(dispatcher.reconcileOnce()).resolves.toBe(2);
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'ai-extraction',
      { aiJobId: jobA },
      { jobId: `ai-extraction-${jobA}` },
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'ai-extraction',
      { aiJobId: jobB },
      { jobId: `ai-extraction-${jobB}` },
    );
  });

  it('replaces a completed deterministic AI queue job for a PostgreSQL retry', async () => {
    const repo = createRepository([]);
    repo.listNonterminalAiJobIds.mockResolvedValue([jobA]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const queue = createQueue();
    queue.add
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('completed'),
        remove,
        retry: vi.fn().mockResolvedValue(undefined),
      })
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn().mockResolvedValue(undefined),
        retry: vi.fn().mockResolvedValue(undefined),
      });
    const dispatcher = new OutboxDispatcher(
      repo,
      queue,
      createProviderWebhookQueue(),
      createDocumentScanQueue(),
      logger,
      () => now,
    );

    await expect(dispatcher.reconcileOnce()).resolves.toBe(1);
    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('publishes a provider webhook identifier only to its separate deterministic queue', async () => {
    const webhookEventId = '00000000-0000-4000-8000-000000000001';
    const repo = createRepository([
      { id: 'outbox-webhook', eventType: 'PROVIDER_WEBHOOK_RECEIVED', payload: { webhookEventId } },
    ]);
    const aiQueue = createQueue();
    const providerQueue = createProviderWebhookQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      aiQueue,
      providerQueue,
      createDocumentScanQueue(),
      logger,
      () => now,
    );
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 1, failed: 0 });
    expect(aiQueue.add).not.toHaveBeenCalled();
    expect(providerQueue.add).toHaveBeenCalledWith(
      'provider-webhook',
      { webhookEventId },
      { jobId: `provider-webhook-${webhookEventId}` },
    );
  });

  it('publishes only tenant and document identifiers to the dedicated scan queue', async () => {
    const repo = createRepository([
      {
        id: 'outbox-document',
        eventType: 'DOCUMENT_SCAN_REQUESTED',
        payload: { tenantId: jobA, documentId: jobB },
      },
    ]);
    const aiQueue = createQueue();
    const providerQueue = createProviderWebhookQueue();
    const documentQueue = createDocumentScanQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      aiQueue,
      providerQueue,
      documentQueue,
      logger,
      () => now,
    );
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 1, failed: 0 });
    expect(documentQueue.add).toHaveBeenCalledWith(
      'document-scan',
      { tenantId: jobA, documentId: jobB },
      {
        jobId: `document-scan-${jobA}-${jobB}`,
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
  });

  it('re-enqueues accepted queued and processing webhook ids after Redis recovery', async () => {
    const repo = createRepository([]);
    const queuedId = '00000000-0000-4000-8000-000000000002';
    const processingId = '00000000-0000-4000-8000-000000000003';
    repo.listRecoverableWebhookEventIds.mockResolvedValue([queuedId, processingId]);
    const aiQueue = createQueue();
    const providerQueue = createProviderWebhookQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      aiQueue,
      providerQueue,
      createDocumentScanQueue(),
      logger,
      () => now,
    );
    await expect(dispatcher.reconcileOnce()).resolves.toBe(2);
    expect(providerQueue.add).toHaveBeenNthCalledWith(
      1,
      'provider-webhook',
      { webhookEventId: queuedId },
      { jobId: `provider-webhook-${queuedId}` },
    );
    expect(providerQueue.add).toHaveBeenNthCalledWith(
      2,
      'provider-webhook',
      { webhookEventId: processingId },
      { jobId: `provider-webhook-${processingId}` },
    );
  });

  it('re-enqueues every bounded quarantined document after queue loss or terminal retry', async () => {
    const repo = createRepository([]);
    repo.listQuarantinedDocumentIds.mockResolvedValue([{ tenantId: jobA, documentId: jobB }]);
    const documentQueue = createDocumentScanQueue();
    const dispatcher = new OutboxDispatcher(
      repo,
      createQueue(),
      createProviderWebhookQueue(),
      documentQueue,
      logger,
      () => now,
    );
    await expect(dispatcher.reconcileOnce()).resolves.toBe(1);
    expect(documentQueue.add).toHaveBeenCalledWith(
      'document-scan',
      { tenantId: jobA, documentId: jobB },
      expect.objectContaining({ jobId: `document-scan-${jobA}-${jobB}` }),
    );
  });

  it('retries a terminally failed deterministic document scan job during reconciliation', async () => {
    const repo = createRepository([]);
    repo.listQuarantinedDocumentIds.mockResolvedValue([{ tenantId: jobA, documentId: jobB }]);
    const retry = vi.fn().mockResolvedValue(undefined);
    const documentQueue = createDocumentScanQueue();
    documentQueue.add.mockResolvedValue({ getState: vi.fn().mockResolvedValue('failed'), retry });
    const dispatcher = new OutboxDispatcher(
      repo,
      createQueue(),
      createProviderWebhookQueue(),
      documentQueue,
      logger,
      () => now,
    );

    await expect(dispatcher.reconcileOnce()).resolves.toBe(1);
    expect(retry).toHaveBeenCalledOnce();
  });
});
