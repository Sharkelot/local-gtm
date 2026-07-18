import { describe, expect, it, vi } from 'vitest';
import {
  createPrivatePlatformFetch,
  HttpLmStudioClient,
  HttpPlatformClient,
  type PlatformFetch,
} from '../src/clients.js';

describe('platform transport safety', () => {
  it('requires HTTPS for the internal API', () => {
    expect(() => new HttpPlatformClient('http://10.0.0.70', 'token')).toThrow(
      'INTERNAL_API_URL must use HTTPS.',
    );
  });

  it('requires a literal connect IP rather than performing arbitrary DNS', () => {
    expect(() => createPrivatePlatformFetch('crm.example.test')).toThrow(
      'INTERNAL_API_CONNECT_HOST must be an IP address.',
    );
  });

  it('keeps worker authentication on scoped internal routes', async () => {
    const fetchImpl = vi.fn<PlatformFetch>(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const client = new HttpPlatformClient('https://crm.example.test', 'worker-token', fetchImpl);

    await client.heartbeat();

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://crm.example.test/api/internal/inference-workers/heartbeat');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer worker-token' });
  });

  it('forwards the server-owned JSON schema to LM Studio structured output', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: '{"schemaVersion":"1","suggestions":[]}' } }],
        }),
      );
    const client = new HttpLmStudioClient('http://127.0.0.1:1234', fetchImpl);
    await client.complete({
      modelId: 'qwen',
      messages: [{ role: 'user', content: 'extract' }],
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'ai_extraction_result',
          strict: true,
          schema: { type: 'object' },
        },
      },
    });

    const completionInit = fetchImpl.mock.calls[1]?.[1];
    if (typeof completionInit?.body !== 'string') throw new Error('Expected JSON request body.');
    const body = JSON.parse(completionInit.body) as {
      response_format?: { type?: string };
    };
    expect(body.response_format?.type).toBe('json_schema');
  });
});
