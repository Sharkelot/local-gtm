export interface OutboxEvent {
  id: string;
  eventType: string;
  payload: unknown;
}

export interface OutboxRepository {
  listDispatchableOutboxEvents(limit: number, now: Date): Promise<readonly OutboxEvent[]>;
  markOutboxPublished(eventId: string, publishedAt: Date): Promise<void>;
  markOutboxFailed(eventId: string, message: string, availableAt: Date): Promise<void>;
  listNonterminalAiJobIds(limit: number): Promise<readonly string[]>;
  listRecoverableWebhookEventIds(limit: number): Promise<readonly string[]>;
  listQuarantinedDocumentIds(
    limit: number,
  ): Promise<readonly { tenantId: string; documentId: string }[]>;
}

export interface AiQueue {
  add(
    name: 'ai-extraction',
    data: { aiJobId: string },
    options: { jobId: string },
  ): Promise<AiQueueJob>;
  close(): Promise<void>;
}

export interface AiQueueJob {
  getState(): Promise<string>;
  remove(): Promise<void>;
  retry(): Promise<void>;
}

export interface ProviderWebhookQueue {
  add(
    name: 'provider-webhook',
    data: { webhookEventId: string },
    options: { jobId: string },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface DocumentScanQueue {
  add(
    name: 'document-scan',
    data: { tenantId: string; documentId: string },
    options: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<DocumentScanJob>;
  close(): Promise<void>;
}

export interface DocumentScanJob {
  getState(): Promise<string>;
  retry(): Promise<void>;
}

export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

const retryAt = (now: Date) => new Date(now.getTime() + 30_000);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isAiJobPayload = (value: unknown): value is { aiJobId: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).aiJobId === 'string' &&
  uuidPattern.test((value as Record<string, unknown>).aiJobId as string);
const isProviderWebhookPayload = (value: unknown): value is { webhookEventId: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).webhookEventId === 'string' &&
  uuidPattern.test((value as Record<string, unknown>).webhookEventId as string);
const isDocumentScanPayload = (value: unknown): value is { tenantId: string; documentId: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).tenantId === 'string' &&
  typeof (value as Record<string, unknown>).documentId === 'string' &&
  uuidPattern.test((value as Record<string, unknown>).tenantId as string) &&
  uuidPattern.test((value as Record<string, unknown>).documentId as string);

/**
 * Redis receives only durable job identity. PostgreSQL retains payload and recovery state.
 * A repeated enqueue is safe because the BullMQ job id is deterministic.
 */
export class OutboxDispatcher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly aiQueue: AiQueue,
    private readonly providerWebhookQueue: ProviderWebhookQueue,
    private readonly documentScanQueue: DocumentScanQueue,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dispatchOnce(limit = 100): Promise<{ published: number; failed: number }> {
    const currentTime = this.now();
    const events = await this.repository.listDispatchableOutboxEvents(limit, currentTime);
    let published = 0;
    let failed = 0;
    for (const event of events) {
      const target = this.targetFor(event);
      if (!target) {
        await this.repository.markOutboxFailed(
          event.id,
          'Invalid outbox event type or identifier-only payload.',
          retryAt(currentTime),
        );
        this.logger.error('outbox.invalid_payload', {
          outboxEventId: event.id,
          eventType: event.eventType,
        });
        failed += 1;
        continue;
      }
      try {
        await target.enqueue();
        await this.repository.markOutboxPublished(event.id, currentTime);
        this.logger.info('outbox.published', {
          outboxEventId: event.id,
          kind: target.kind,
          identifier: target.identifier,
        });
        published += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown queue publishing failure.';
        await this.repository.markOutboxFailed(event.id, message, retryAt(currentTime));
        this.logger.error('outbox.publish_failed', {
          outboxEventId: event.id,
          kind: target.kind,
          identifier: target.identifier,
          message,
        });
        failed += 1;
      }
    }
    return { published, failed };
  }

  async reconcileOnce(limit = 500): Promise<number> {
    const aiJobIds = await this.repository.listNonterminalAiJobIds(limit);
    const webhookEventIds = await this.repository.listRecoverableWebhookEventIds(limit);
    const quarantinedDocuments = await this.repository.listQuarantinedDocumentIds(limit);
    let aiEnqueued = 0;
    let webhookEnqueued = 0;
    let documentScansEnqueued = 0;
    for (const aiJobId of aiJobIds) {
      try {
        await this.enqueue(aiJobId);
        aiEnqueued += 1;
      } catch (error) {
        this.logger.error('ai_job.reconcile_failed', {
          aiJobId,
          message: error instanceof Error ? error.message : 'Unknown queue publishing failure.',
        });
      }
    }
    for (const document of quarantinedDocuments) {
      try {
        await this.enqueueDocumentScan(document.tenantId, document.documentId);
        documentScansEnqueued += 1;
      } catch (error) {
        this.logger.error('document_scan.reconcile_failed', {
          tenantId: document.tenantId,
          documentId: document.documentId,
          message: error instanceof Error ? error.message : 'Unknown queue publishing failure.',
        });
      }
    }
    for (const webhookEventId of webhookEventIds) {
      try {
        await this.enqueueProviderWebhook(webhookEventId);
        webhookEnqueued += 1;
      } catch (error) {
        this.logger.error('provider_webhook.reconcile_failed', {
          webhookEventId,
          message: error instanceof Error ? error.message : 'Unknown queue publishing failure.',
        });
      }
    }
    this.logger.info('ai_job.reconciled', { examined: aiJobIds.length, enqueued: aiEnqueued });
    this.logger.info('provider_webhook.reconciled', {
      examined: webhookEventIds.length,
      enqueued: webhookEnqueued,
    });
    this.logger.info('document_scan.reconciled', {
      examined: quarantinedDocuments.length,
      enqueued: documentScansEnqueued,
    });
    return aiEnqueued + webhookEnqueued + documentScansEnqueued;
  }

  private async enqueue(aiJobId: string): Promise<void> {
    const name = 'ai-extraction';
    const data = { aiJobId };
    const options = { jobId: `ai-extraction-${aiJobId}` };
    const job = await this.aiQueue.add(name, data, options);
    const state = await job.getState();
    if (state === 'completed') {
      await job.remove();
      await this.aiQueue.add(name, data, options);
    } else if (state === 'failed') {
      await job.retry();
    }
  }

  private async enqueueProviderWebhook(webhookEventId: string): Promise<void> {
    await this.providerWebhookQueue.add(
      'provider-webhook',
      { webhookEventId },
      { jobId: `provider-webhook-${webhookEventId}` },
    );
  }

  private async enqueueDocumentScan(tenantId: string, documentId: string): Promise<void> {
    const job = await this.documentScanQueue.add(
      'document-scan',
      { tenantId, documentId },
      {
        jobId: `document-scan-${tenantId}-${documentId}`,
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    // A deterministic BullMQ ID deduplicates enqueueing, but add() leaves a terminally
    // failed job failed. QUARANTINED is PostgreSQL's durable signal to retry the scan.
    if ((await job.getState()) === 'failed') await job.retry();
  }

  private targetFor(event: OutboxEvent): {
    kind: 'ai' | 'provider_webhook' | 'document_scan';
    identifier: string;
    enqueue: () => Promise<void>;
  } | null {
    if (event.eventType === 'AI_EXTRACTION_REQUESTED' && isAiJobPayload(event.payload)) {
      const { aiJobId } = event.payload;
      return { kind: 'ai', identifier: aiJobId, enqueue: () => this.enqueue(aiJobId) };
    }
    if (event.eventType === 'DOCUMENT_SCAN_REQUESTED' && isDocumentScanPayload(event.payload)) {
      const { tenantId, documentId } = event.payload;
      return {
        kind: 'document_scan',
        identifier: documentId,
        enqueue: () => this.enqueueDocumentScan(tenantId, documentId),
      };
    }
    if (
      event.eventType === 'PROVIDER_WEBHOOK_RECEIVED' &&
      isProviderWebhookPayload(event.payload)
    ) {
      const { webhookEventId } = event.payload;
      return {
        kind: 'provider_webhook',
        identifier: webhookEventId,
        enqueue: () => this.enqueueProviderWebhook(webhookEventId),
      };
    }
    return null;
  }
}
