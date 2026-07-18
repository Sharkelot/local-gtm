import { createServer } from 'node:http';
import { Queue, Worker } from 'bullmq';
import {
  createProductionDocumentScanProcessor,
  documentScanJobSchema,
} from './document-scan-processor.js';
import { OutboxDispatcher, type Logger } from './dispatcher.js';
import { prismaOutboxRepository } from './prisma-repository.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required.');
const parsedRedisUrl = new URL(redisUrl);
const redisConnection = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || 6379),
  db: Number(parsedRedisUrl.pathname.slice(1) || 0),
  enableOfflineQueue: false,
  maxRetriesPerRequest: null,
  ...(parsedRedisUrl.username ? { username: decodeURIComponent(parsedRedisUrl.username) } : {}),
  ...(parsedRedisUrl.password ? { password: decodeURIComponent(parsedRedisUrl.password) } : {}),
};
const aiQueue = new Queue('ai-extraction', {
  connection: redisConnection,
});
const providerWebhookQueue = new Queue('provider-sync', { connection: redisConnection });
const documentScanQueue = new Queue('document-scan', { connection: redisConnection });
const logger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: 'error', event, ...fields })),
};
const dispatcher = new OutboxDispatcher(
  prismaOutboxRepository,
  aiQueue,
  providerWebhookQueue,
  documentScanQueue,
  logger,
);
const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5000);
const reconcileMs = Number(process.env.RECONCILE_MS ?? 60_000);
let healthy = true;
let stopping = false;
let documentScanWorker: Worker | null = null;
let scannerConfigured = true;
try {
  const processor = createProductionDocumentScanProcessor();
  documentScanWorker = new Worker(
    'document-scan',
    async (job) => processor.process(documentScanJobSchema.parse(job.data)),
    {
      connection: redisConnection,
      concurrency: Number(process.env.DOCUMENT_SCAN_CONCURRENCY ?? 2),
    },
  );
  documentScanWorker.on('failed', (job, error) => {
    healthy = false;
    logger.error('document_scan.job_failed', {
      ...(job?.id ? { jobId: job.id } : {}),
      message: error.message,
    });
  });
} catch (error) {
  healthy = false;
  scannerConfigured = false;
  logger.error('document_scan.configuration_missing', {
    message: error instanceof Error ? error.message : 'Unknown scanner configuration failure.',
  });
}

async function poll(): Promise<void> {
  try {
    await dispatcher.dispatchOnce();
    healthy = true;
  } catch (error) {
    healthy = false;
    logger.error('outbox.poll_failed', {
      message: error instanceof Error ? error.message : 'Unknown failure.',
    });
  }
}
async function reconcile(): Promise<void> {
  try {
    await dispatcher.reconcileOnce();
  } catch (error) {
    healthy = false;
    logger.error('ai_job.reconcile_cycle_failed', {
      message: error instanceof Error ? error.message : 'Unknown failure.',
    });
  }
}
const pollTimer = setInterval(() => void poll(), pollMs);
const reconcileTimer = setInterval(() => void reconcile(), reconcileMs);
void poll();
void reconcile();
const server = createServer((_request, response) => {
  response.statusCode = healthy && scannerConfigured && !stopping ? 200 : 503;
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({ status: healthy && scannerConfigured && !stopping ? 'ok' : 'degraded' }),
  );
});
server.listen(Number(process.env.HEALTH_PORT ?? 3001), '0.0.0.0');
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(pollTimer);
  clearInterval(reconcileTimer);
  logger.info('worker.shutdown', { signal });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([
    aiQueue.close(),
    providerWebhookQueue.close(),
    documentScanQueue.close(),
    ...(documentScanWorker ? [documentScanWorker.close()] : []),
  ]);
  process.exitCode = 0;
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
