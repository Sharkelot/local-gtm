import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  DocumentScanProcessor,
  documentScanJobSchema,
  RetryableDocumentScanError,
  type MalwareScanner,
  type ObjectStorage,
  type ScanLogger,
} from '../src/document-scan-processor.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
const logger: ScanLogger = { info: vi.fn(), error: vi.fn() };
const version = { documentId, objectKey: 'tenant/object', objectVersion: 'version-1' };

function setup(verdict: 'CLEAN' | 'INFECTED') {
  const open = vi.fn().mockResolvedValue(Readable.from(['private bytes']));
  const scan = vi.fn().mockResolvedValue(verdict);
  const storage: ObjectStorage = { open };
  const scanner: MalwareScanner = { scan };
  const loadVersion = vi.fn().mockResolvedValue(version);
  const recordResult = vi.fn().mockResolvedValue(undefined);
  return {
    storage,
    scanner,
    open,
    scan,
    loadVersion,
    recordResult,
    processor: new DocumentScanProcessor(storage, scanner, logger, loadVersion, recordResult),
  };
}

describe('DocumentScanProcessor', () => {
  it('accepts only durable tenant/document identifiers as scan job data', () => {
    expect(() => documentScanJobSchema.parse({ tenantId, documentId })).not.toThrow();
    expect(() =>
      documentScanJobSchema.parse({ tenantId, documentId, bytes: 'never redis' }),
    ).toThrow();
  });

  it('streams a quarantined object to the scanner and records clean only through the service boundary', async () => {
    const { processor, open, scan, recordResult } = setup('CLEAN');
    await expect(processor.process({ tenantId, documentId })).resolves.toBe('CLEAN');
    expect(open).toHaveBeenCalledWith({
      documentId,
      objectKey: version.objectKey,
      objectVersion: version.objectVersion,
    });
    expect(scan).toHaveBeenCalledOnce();
    expect(recordResult).toHaveBeenCalledWith(tenantId, { documentId, result: 'CLEAN' });
  });

  it('records infected results through the service boundary with no object bytes in the audit input', async () => {
    const { processor, recordResult } = setup('INFECTED');
    await expect(processor.process({ tenantId, documentId })).resolves.toBe('INFECTED');
    expect(recordResult).toHaveBeenCalledWith(tenantId, {
      documentId,
      result: 'REJECTED',
      reason: 'Malware scanner detected infected content.',
    });
  });

  it('leaves a scan retryable and quarantined when storage or scanner work fails', async () => {
    const storage: ObjectStorage = {
      open: vi.fn().mockRejectedValue(new Error('MinIO unavailable')),
    };
    const scanner: MalwareScanner = { scan: vi.fn() };
    const recordResult = vi.fn();
    const processor = new DocumentScanProcessor(
      storage,
      scanner,
      logger,
      vi.fn().mockResolvedValue(version),
      recordResult,
    );
    await expect(processor.process({ tenantId, documentId })).rejects.toBeInstanceOf(
      RetryableDocumentScanError,
    );
    expect(recordResult).not.toHaveBeenCalled();
  });

  it('skips stale jobs without opening bytes', async () => {
    const { storage, scanner, open, recordResult } = setup('CLEAN');
    const processor = new DocumentScanProcessor(
      storage,
      scanner,
      logger,
      vi.fn().mockResolvedValue(null),
      recordResult,
    );
    await expect(processor.process({ tenantId, documentId })).resolves.toBe('SKIPPED');
    expect(open).not.toHaveBeenCalled();
    expect(recordResult).not.toHaveBeenCalled();
  });
});
