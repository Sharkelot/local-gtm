import { describe, expect, it } from 'vitest';
import { maxWebhookBodyBytes, readBoundedRawBody } from './raw-body';

interface StreamingRequestInit extends RequestInit {
  duplex: 'half';
}

describe('readBoundedRawBody', () => {
  it('returns an exact bounded byte sequence', async () => {
    const body = await readBoundedRawBody(
      new Request('https://example.test', { method: 'POST', body: 'verified' }),
    );
    expect(new TextDecoder().decode(body!)).toBe('verified');
  });
  it('rejects an oversized declared body before reading it', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(maxWebhookBodyBytes + 1) },
    });
    await expect(readBoundedRawBody(request)).resolves.toBeNull();
  });
  it('rejects a chunked body that crosses the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxWebhookBodyBytes + 1));
        controller.close();
      },
    });
    const init: StreamingRequestInit = { method: 'POST', body: stream, duplex: 'half' };
    const request = new Request('https://example.test', init);
    await expect(readBoundedRawBody(request)).resolves.toBeNull();
  });
});
