import { describe, expect, it } from 'vitest';
import {
  assertSha256AndSize,
  createDataKeyProviderFromEnvironment,
  createDevEnvelopeKeyDataKeyProvider,
  createOpenBaoTransitDataKeyProvider,
  decryptDocument,
  encryptDocument,
  sha256,
} from '../src/index.js';

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const context = Buffer.from('tenant-a:document-123:v1');

describe('document envelopes', () => {
  it('round-trips bytes and verifies their SHA-256 and size', async () => {
    const bytes = Buffer.from('privileged document bytes');
    const provider = createDevEnvelopeKeyDataKeyProvider(key);
    const envelope = await encryptDocument(bytes, provider, { context });
    expect(envelope.startsWith('local-gtm-document:v1:')).toBe(true);
    const plaintext = await decryptDocument(envelope, provider, { context });
    expect(plaintext).toEqual(bytes);
    assertSha256AndSize(plaintext, { sha256: sha256(bytes), sizeBytes: bytes.byteLength });
  });

  it('rejects tampered ciphertext and the wrong context', async () => {
    const provider = createDevEnvelopeKeyDataKeyProvider(key);
    const envelope = await encryptDocument(Buffer.from('confidential'), provider, { context });
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith('A') ? 'B' : 'A'}`;
    await expect(decryptDocument(tampered, provider, { context })).rejects.toThrow();
    await expect(
      decryptDocument(envelope, provider, { context: Buffer.from('tenant-b:document-123:v1') }),
    ).rejects.toThrow();
  });

  it('rejects size and digest mismatches', () => {
    const bytes = Buffer.from('document');
    expect(() => assertSha256AndSize(bytes, { sha256: sha256(bytes), sizeBytes: 99 })).toThrow(
      'size',
    );
    expect(() =>
      assertSha256AndSize(bytes, { sha256: '0'.repeat(64), sizeBytes: bytes.byteLength }),
    ).toThrow('SHA-256');
  });

  it('fails closed when production OpenBao configuration is missing', () => {
    expect(() => createDataKeyProviderFromEnvironment({ NODE_ENV: 'production' })).toThrow(
      'required in production',
    );
  });

  it('sends base64 keys and authenticated context to OpenBao Transit', async () => {
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    const provider = createOpenBaoTransitDataKeyProvider({
      address: 'https://openbao.example/',
      token: 'test-token',
      keyName: 'documents',
      fetchImplementation: (url, init) => {
        const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
        calls.push({
          url: requestUrl,
          body: JSON.parse(init.body) as Record<string, string>,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                ciphertext: 'vault:v1:wrapped',
                plaintext: Buffer.alloc(32, 7).toString('base64'),
              },
            }),
            { status: 200 },
          ),
        );
      },
    });
    await provider.wrapDataKey(Buffer.alloc(32, 7), context);
    const unwrapped = await provider.unwrapDataKey('vault:v1:wrapped', context);
    expect(unwrapped).toEqual(Buffer.alloc(32, 7));
    expect(calls).toEqual([
      expect.objectContaining({
        url: 'https://openbao.example/v1/transit/encrypt/documents',
        body: {
          plaintext: Buffer.alloc(32, 7).toString('base64'),
          context: context.toString('base64'),
        },
      }),
      expect.objectContaining({
        url: 'https://openbao.example/v1/transit/decrypt/documents',
        body: { ciphertext: 'vault:v1:wrapped', context: context.toString('base64') },
      }),
    ]);
  });
});
