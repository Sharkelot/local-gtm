import { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { Client as MinioClient } from 'minio';
import { prisma, recordDocumentScanResult, withTenant, type TenantContext } from '@local-gtm/db';

export interface DocumentScanJob {
  tenantId: string;
  documentId: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Strict identifier-only queue payload validation, deliberately without byte fields. */
export const documentScanJobSchema = {
  parse(unparsedJob: unknown): DocumentScanJob {
    if (typeof unparsedJob !== 'object' || unparsedJob === null || Array.isArray(unparsedJob))
      throw new Error('Document scan job must be an object.');
    const entries = Object.entries(unparsedJob);
    if (entries.length !== 2 || !('tenantId' in unparsedJob) || !('documentId' in unparsedJob))
      throw new Error('Document scan job accepts only tenantId and documentId.');
    const { tenantId, documentId } = unparsedJob as Record<string, unknown>;
    if (
      typeof tenantId !== 'string' ||
      typeof documentId !== 'string' ||
      !uuidPattern.test(tenantId) ||
      !uuidPattern.test(documentId)
    )
      throw new Error('Document scan job identifiers must be UUIDs.');
    return { tenantId, documentId };
  },
};
export type ScanVerdict = 'CLEAN' | 'INFECTED';

export interface QuarantinedDocumentVersion {
  documentId: string;
  objectKey: string;
  objectVersion: string;
}

export interface ObjectStorage {
  open(version: Pick<QuarantinedDocumentVersion, 'objectKey' | 'objectVersion'>): Promise<Readable>;
}

export interface MalwareScanner {
  scan(bytes: Readable): Promise<ScanVerdict>;
}

export interface ScanLogger {
  info(event: string, fields: Record<string, string>): void;
  error(event: string, fields: Record<string, string>): void;
}

export type ScanResultRecorder = (
  tenantId: string,
  input: { documentId: string; result: 'CLEAN' | 'REJECTED'; reason?: string },
) => Promise<unknown>;

export class RetryableDocumentScanError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RetryableDocumentScanError';
  }
}

const scannerContext = (tenantId: string): TenantContext => ({
  tenantId,
  actorId: 'platform-document-scanner',
  actorType: 'SYSTEM',
  correlationId: crypto.randomUUID(),
});

async function loadQuarantinedDocumentVersion(
  job: DocumentScanJob,
): Promise<QuarantinedDocumentVersion | null> {
  return withTenant(prisma, scannerContext(job.tenantId), async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: job.documentId, tenantId: job.tenantId, scanStatus: 'QUARANTINED' },
      select: {
        id: true,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { objectKey: true, objectVersion: true },
        },
      },
    });
    const version = document?.versions[0];
    if (!document || !version) return null;
    return { documentId: document.id, ...version };
  });
}

const recordScanResult: ScanResultRecorder = (tenantId, input) =>
  recordDocumentScanResult(prisma, scannerContext(tenantId), input);

/**
 * Scans only quarantined object versions. Scan errors deliberately leave the
 * database status quarantined, so queue retry/recovery never releases bytes.
 */
export class DocumentScanProcessor {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly scanner: MalwareScanner,
    private readonly logger: ScanLogger,
    private readonly loadVersion: (
      job: DocumentScanJob,
    ) => Promise<QuarantinedDocumentVersion | null> = loadQuarantinedDocumentVersion,
    private readonly recordResult: ScanResultRecorder = recordScanResult,
  ) {}

  async process(unparsedJob: unknown): Promise<'CLEAN' | 'INFECTED' | 'SKIPPED'> {
    const job = documentScanJobSchema.parse(unparsedJob);
    const version = await this.loadVersion(job);
    if (!version) {
      this.logger.info('document_scan.skipped', {
        tenantId: job.tenantId,
        documentId: job.documentId,
      });
      return 'SKIPPED';
    }
    try {
      const bytes = await this.storage.open(version);
      const verdict = await this.scanner.scan(bytes);
      await this.recordResult(job.tenantId, {
        documentId: version.documentId,
        result: verdict === 'CLEAN' ? 'CLEAN' : 'REJECTED',
        ...(verdict === 'INFECTED' ? { reason: 'Malware scanner detected infected content.' } : {}),
      });
      this.logger.info('document_scan.completed', {
        tenantId: job.tenantId,
        documentId: job.documentId,
        verdict,
      });
      return verdict;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scanner failure.';
      this.logger.error('document_scan.retryable_failure', {
        tenantId: job.tenantId,
        documentId: job.documentId,
        message: message.slice(0, 500),
      });
      throw new RetryableDocumentScanError('Document scan failed; document remains quarantined.', {
        cause: error,
      });
    }
  }
}

export class MinioObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: MinioClient,
    private readonly bucket: string,
  ) {}

  async open(version: Pick<QuarantinedDocumentVersion, 'objectKey' | 'objectVersion'>) {
    return this.client.getObject(this.bucket, version.objectKey, {
      versionId: version.objectVersion,
    });
  }
}

export class ClamAvStreamScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  async scan(bytes: Readable): Promise<ScanVerdict> {
    const socket = new Socket();
    const response = new Promise<string>((resolve, reject) => {
      let output = '';
      socket.setEncoding('utf8');
      socket.once('error', reject);
      socket.on('data', (chunk: string) => (output += chunk));
      socket.once('end', () => resolve(output));
      socket.once('timeout', () => reject(new Error('ClamAV scan timed out.')));
    });
    socket.setTimeout(this.timeoutMs);
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(this.port, this.host, resolve);
    });
    try {
      socket.write('zINSTREAM\0');
      for await (const chunk of bytes) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(data.length);
        if (!socket.write(Buffer.concat([length, data])))
          await new Promise<void>((resolve) => socket.once('drain', resolve));
      }
      socket.end(Buffer.alloc(4));
      const output = await response;
      if (/\bOK\b/.test(output)) return 'CLEAN';
      if (/\bFOUND\b/.test(output)) return 'INFECTED';
      throw new Error(
        `ClamAV returned an unrecognized scan result: ${JSON.stringify(output.slice(0, 200))}`,
      );
    } catch (error) {
      bytes.destroy(error instanceof Error ? error : undefined);
      socket.destroy();
      throw error;
    }
  }
}

/** Builds the real internal-only adapters; callers decide queue concurrency and retry policy. */
export function createProductionDocumentScanProcessor(
  environment = process.env,
): DocumentScanProcessor {
  const endPoint = environment.MINIO_ENDPOINT;
  const accessKey = environment.MINIO_ACCESS_KEY;
  const secretKey = environment.MINIO_SECRET_KEY;
  const bucket = environment.MINIO_DOCUMENT_BUCKET;
  if (!endPoint || !accessKey || !secretKey || !bucket)
    throw new Error('MinIO document scan configuration is incomplete.');
  const minio = new MinioClient({
    endPoint,
    port: Number(environment.MINIO_PORT ?? 9000),
    useSSL: environment.MINIO_USE_SSL === 'true',
    accessKey,
    secretKey,
  });
  return new DocumentScanProcessor(
    new MinioObjectStorage(minio, bucket),
    new ClamAvStreamScanner(
      environment.CLAMAV_HOST ?? 'clamav',
      Number(environment.CLAMAV_PORT ?? 3310),
      Number(environment.DOCUMENT_SCAN_TIMEOUT_MS ?? 60_000),
    ),
    {
      info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
      error: (event, fields) => console.error(JSON.stringify({ level: 'error', event, ...fields })),
    },
  );
}
