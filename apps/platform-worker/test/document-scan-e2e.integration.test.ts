import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Client as MinioClient } from 'minio';
import { describe, expect, it } from 'vitest';
import { prisma, uploadDocumentMetadata, type TenantContext } from '@local-gtm/db';
import { createProductionDocumentScanProcessor } from '../src/document-scan-processor.js';
import {
  OutboxDispatcher,
  type Logger,
  type OutboxEvent,
  type OutboxRepository,
} from '../src/dispatcher.js';

const requiredEnvironment = [
  'TEST_DATABASE_URL',
  'TEST_REDIS_URL',
  'TEST_MINIO_ENDPOINT',
  'TEST_MINIO_ACCESS_KEY',
  'TEST_MINIO_SECRET_KEY',
  'TEST_MINIO_SCANNER_ACCESS_KEY',
  'TEST_MINIO_SCANNER_SECRET_KEY',
  'TEST_MINIO_BUCKET',
  'TEST_CLAMAV_HOST',
] as const;
const enabled = requiredEnvironment.every((name) => Boolean(process.env[name]));
const suite = describe.skipIf(!enabled);

suite('document scan outbox-to-worker recovery path', () => {
  it('keeps Redis identifier-only and releases metadata only after a real clean scan', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL as string;
    const redisUrl = new URL(process.env.TEST_REDIS_URL as string);
    const minioEndpoint = new URL(process.env.TEST_MINIO_ENDPOINT as string);
    const bucket = process.env.TEST_MINIO_BUCKET as string;
    const client = prisma;
    const minio = new MinioClient({
      endPoint: minioEndpoint.hostname,
      port: Number(minioEndpoint.port || 80),
      useSSL: minioEndpoint.protocol === 'https:',
      accessKey: process.env.TEST_MINIO_ACCESS_KEY as string,
      secretKey: process.env.TEST_MINIO_SECRET_KEY as string,
    });
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      db: Number(redisUrl.pathname.slice(1) || 0),
      maxRetriesPerRequest: null,
    };
    const suffix = randomUUID();
    const queueSuffix = suffix.replaceAll('-', '');
    const aiQueue = new Queue(`scan-e2e-ai-${queueSuffix}`, { connection });
    const providerQueue = new Queue(`scan-e2e-provider-${queueSuffix}`, { connection });
    const scanQueue = new Queue(`scan-e2e-document-${queueSuffix}`, { connection });
    let worker: Worker | null = null;
    try {
      const tenant = await client.tenant.create({
        data: { name: `Scan tenant ${suffix}`, slug: `scan-${suffix}` },
      });
      const identity = await client.identity.create({
        data: {
          issuer: 'scan-integration',
          subject: suffix,
          email: `scan-${suffix}@example.test`,
          displayName: 'Scan Integration',
        },
      });
      await client.membership.create({
        data: { tenantId: tenant.id, identityId: identity.id, role: 'TENANT_ADMIN' },
      });
      const matter = await client.matter.create({
        data: {
          tenantId: tenant.id,
          matterNumber: `SCAN-${suffix}`,
          name: 'Document scan integration',
          status: 'ACTIVE',
        },
      });
      const bytes = Buffer.from('clean document scan integration content');
      const objectKey = `${tenant.id}/${randomUUID()}`;
      const uploaded = await minio.putObject(bucket, objectKey, bytes, bytes.length, {
        'content-type': 'text/plain',
      });
      if (!uploaded.versionId)
        throw new Error('Versioned document upload did not return a MinIO version ID.');
      const context: TenantContext = {
        tenantId: tenant.id,
        actorId: identity.id,
        actorType: 'USER',
        correlationId: randomUUID(),
      };
      const document = await uploadDocumentMetadata(client, context, {
        matterId: matter.id,
        name: 'clean.txt',
        objectKey,
        objectVersion: uploaded.versionId,
        encryptedDataKey: 'integration-encrypted-data-key',
        contentType: 'text/plain',
        sizeBytes: BigInt(bytes.length),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        legalHold: false,
      });
      const outbox = await client.outboxEvent.findFirstOrThrow({
        where: { aggregateId: document.id, eventType: 'DOCUMENT_SCAN_REQUESTED' },
        select: { id: true, eventType: true, payload: true },
      });
      const repository: OutboxRepository = {
        listDispatchableOutboxEvents: () => Promise.resolve([outbox as OutboxEvent]),
        markOutboxPublished: (id, publishedAt) =>
          client.outboxEvent
            .update({ where: { id }, data: { status: 'PUBLISHED', publishedAt } })
            .then(() => undefined),
        markOutboxFailed: () => Promise.resolve(),
        listNonterminalAiJobIds: () => Promise.resolve([]),
        listRecoverableWebhookEventIds: () => Promise.resolve([]),
        listQuarantinedDocumentIds: () => Promise.resolve([]),
      };
      const logger: Logger = { info: () => undefined, error: () => undefined };
      const processor = createProductionDocumentScanProcessor({
        ...process.env,
        DATABASE_URL: databaseUrl,
        MINIO_ENDPOINT: minioEndpoint.hostname,
        MINIO_PORT: String(minioEndpoint.port || 80),
        MINIO_USE_SSL: String(minioEndpoint.protocol === 'https:'),
        MINIO_ACCESS_KEY: process.env.TEST_MINIO_SCANNER_ACCESS_KEY,
        MINIO_SECRET_KEY: process.env.TEST_MINIO_SCANNER_SECRET_KEY,
        MINIO_DOCUMENT_BUCKET: bucket,
        CLAMAV_HOST: process.env.TEST_CLAMAV_HOST,
        CLAMAV_PORT: process.env.TEST_CLAMAV_PORT ?? '3310',
      });
      worker = new Worker(scanQueue.name, (job) => processor.process(job.data), {
        connection,
        concurrency: 1,
      });
      const dispatcher = new OutboxDispatcher(
        repository,
        aiQueue,
        providerQueue,
        scanQueue,
        logger,
      );
      await expect(dispatcher.dispatchOnce()).resolves.toEqual({ published: 1, failed: 0 });
      const jobId = `document-scan-${tenant.id}-${document.id}`;
      const job = await scanQueue.getJob(jobId);
      expect(job?.data).toEqual({ tenantId: tenant.id, documentId: document.id });

      let scanStatus = 'QUARANTINED';
      for (let attempt = 0; attempt < 50 && scanStatus === 'QUARANTINED'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        scanStatus = (await client.document.findUniqueOrThrow({ where: { id: document.id } }))
          .scanStatus;
      }
      expect(scanStatus).toBe('CLEAN');
      expect(
        await client.auditEvent.count({
          where: { tenantId: tenant.id, entityId: document.id, action: 'document.scan_clean' },
        }),
      ).toBe(1);
    } finally {
      if (worker) await worker.close();
      await Promise.all([aiQueue.close(), providerQueue.close(), scanQueue.close()]);
      await client.$disconnect();
    }
  }, 30_000);
});
