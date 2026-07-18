import { Queue, QueueEvents, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OutboxDispatcher,
  type Logger,
  type OutboxEvent,
  type OutboxRepository,
} from '../src/dispatcher.js';

const redisUrl = process.env.TEST_REDIS_URL;
const suite = describe.skipIf(!redisUrl);

suite('BullMQ identifier-only dispatch', () => {
  const parsed = new URL(redisUrl ?? 'redis://127.0.0.1:1');
  const connection = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    maxRetriesPerRequest: null,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
  let aiQueue!: Queue;
  let providerQueue!: Queue;
  let documentQueue!: Queue;
  const aiJobId = '00000000-0000-4000-8000-000000000021';
  const webhookEventId = '00000000-0000-4000-8000-000000000022';
  const tenantId = '00000000-0000-4000-8000-000000000023';
  const documentId = '00000000-0000-4000-8000-000000000024';
  const events: OutboxEvent[] = [
    { id: 'outbox-ai', eventType: 'AI_EXTRACTION_REQUESTED', payload: { aiJobId } },
    {
      id: 'outbox-webhook',
      eventType: 'PROVIDER_WEBHOOK_RECEIVED',
      payload: { webhookEventId },
    },
  ];
  const repository: OutboxRepository = {
    listDispatchableOutboxEvents: () => Promise.resolve(events),
    markOutboxPublished: () => Promise.resolve(),
    markOutboxFailed: () => Promise.resolve(),
    listNonterminalAiJobIds: () => Promise.resolve([]),
    listRecoverableWebhookEventIds: () => Promise.resolve([]),
    listQuarantinedDocumentIds: () => Promise.resolve([{ tenantId, documentId }]),
  };
  const logger: Logger = { info: () => undefined, error: () => undefined };

  beforeAll(async () => {
    aiQueue = new Queue('local-gtm-ai-dispatch-integration', { connection });
    providerQueue = new Queue('local-gtm-provider-dispatch-integration', { connection });
    documentQueue = new Queue('local-gtm-document-scan-integration', { connection });
    await Promise.all([
      aiQueue.waitUntilReady(),
      providerQueue.waitUntilReady(),
      documentQueue.waitUntilReady(),
    ]);
    await Promise.all([aiQueue.drain(true), providerQueue.drain(true), documentQueue.drain(true)]);
  });

  afterAll(async () => {
    await Promise.all([aiQueue.close(), providerQueue.close(), documentQueue.close()]);
  });

  it('accepts deterministic colon-free IDs and deduplicates repeated delivery', async () => {
    const dispatcher = new OutboxDispatcher(
      repository,
      aiQueue,
      providerQueue,
      documentQueue,
      logger,
    );
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 2, failed: 0 });
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 2, failed: 0 });

    const aiJob = await aiQueue.getJob(`ai-extraction-${aiJobId}`);
    const providerJob = await providerQueue.getJob(`provider-webhook-${webhookEventId}`);
    expect(aiJob?.data).toEqual({ aiJobId });
    expect(providerJob?.data).toEqual({ webhookEventId });
    expect(await aiQueue.getJobCountByTypes('wait')).toBe(1);
    expect(await providerQueue.getJobCountByTypes('wait')).toBe(1);
  });

  it('reconciles a lost document scan job with an identifier-only deterministic job', async () => {
    const dispatcher = new OutboxDispatcher(
      repository,
      aiQueue,
      providerQueue,
      documentQueue,
      logger,
    );
    await expect(dispatcher.reconcileOnce()).resolves.toBe(1);
    const job = await documentQueue.getJob(`document-scan-${tenantId}-${documentId}`);
    expect(job?.data).toEqual({ tenantId, documentId });
  });

  it('retries a terminally failed deterministic scan when PostgreSQL still reports QUARANTINED', async () => {
    const jobId = `document-scan-${tenantId}-${documentId}`;
    await documentQueue.drain(true);
    const queueEvents = new QueueEvents(documentQueue.name, { connection });
    const worker = new Worker(
      documentQueue.name,
      () => {
        throw new Error('scanner unavailable');
      },
      { connection },
    );
    await queueEvents.waitUntilReady();
    await worker.waitUntilReady();
    try {
      const failedJob = await documentQueue.add(
        'document-scan',
        { tenantId, documentId },
        { jobId, attempts: 1 },
      );
      await expect(failedJob.waitUntilFinished(queueEvents)).rejects.toThrow('scanner unavailable');
      expect(await failedJob.getState()).toBe('failed');
      await worker.close();

      const dispatcher = new OutboxDispatcher(
        repository,
        aiQueue,
        providerQueue,
        documentQueue,
        logger,
      );
      await expect(dispatcher.reconcileOnce()).resolves.toBe(1);
      expect(await failedJob.getState()).toBe('waiting');
    } finally {
      await queueEvents.close();
    }
  });
});
