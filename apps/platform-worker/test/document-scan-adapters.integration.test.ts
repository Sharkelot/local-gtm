import { randomUUID } from 'node:crypto';
import { Client as MinioClient } from 'minio';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClamAvStreamScanner, MinioObjectStorage } from '../src/document-scan-processor.js';

const minioEndpoint = process.env.TEST_MINIO_ENDPOINT;
const minioAccessKey = process.env.TEST_MINIO_ACCESS_KEY;
const minioSecretKey = process.env.TEST_MINIO_SECRET_KEY;
const clamAvHost = process.env.TEST_CLAMAV_HOST;
const clamAvPort = Number(process.env.TEST_CLAMAV_PORT ?? 3310);
const enabled = Boolean(minioEndpoint && minioAccessKey && minioSecretKey && clamAvHost);
const suite = describe.skipIf(!enabled);

suite('MinIO and ClamAV document scan adapters', () => {
  const endpoint = new URL(minioEndpoint ?? 'http://127.0.0.1:1');
  const minio = new MinioClient({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
    useSSL: endpoint.protocol === 'https:',
    accessKey: minioAccessKey ?? 'missing',
    secretKey: minioSecretKey ?? 'missing',
  });
  const bucket = `scan-${randomUUID()}`;
  const storage = new MinioObjectStorage(minio, bucket);
  const scanner = new ClamAvStreamScanner(clamAvHost ?? '127.0.0.1', clamAvPort, 30_000);

  beforeAll(async () => {
    await minio.makeBucket(bucket, 'us-east-1', { ObjectLocking: true });
    await minio.setBucketVersioning(bucket, { Status: 'Enabled' });
  });

  async function scanObject(objectKey: string, bytes: Buffer) {
    const uploaded = await minio.putObject(bucket, objectKey, bytes, bytes.length, {
      'content-type': 'application/octet-stream',
    });
    if (!uploaded.versionId) throw new Error('Versioned MinIO upload did not return a version ID.');
    return scanner.scan(await storage.open({ objectKey, objectVersion: uploaded.versionId }));
  }

  it('streams an exact version from locked/versioned storage and distinguishes clean from EICAR content', async () => {
    await expect(scanObject('clean.txt', Buffer.from('clean legal document'))).resolves.toBe(
      'CLEAN',
    );
    const eicar = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    );
    await expect(scanObject('eicar.txt', eicar)).resolves.toBe('INFECTED');
  });
});
