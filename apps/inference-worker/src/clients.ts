import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  InferenceUnavailableError,
  type LmStudioClient,
  type PlatformClient,
  type ScopedPrompt,
} from './worker.js';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export type PlatformFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Connect to a private address while retaining the URL hostname for Host, TLS
 * SNI, and certificate verification. This avoids publishing internal worker
 * endpoints or weakening TLS when private DNS is unavailable on Windows.
 */
export function createPrivatePlatformFetch(connectHost: string, caPath?: string): PlatformFetch {
  if (!isIP(connectHost)) throw new Error('INTERNAL_API_CONNECT_HOST must be an IP address.');
  const ca = caPath ? readFileSync(caPath) : undefined;

  return async (input, init = {}) => {
    const url = new URL(input.toString());
    if (url.protocol !== 'https:')
      throw new Error('Private internal API transport requires HTTPS.');

    const headers = new Headers(init.headers);
    headers.set('host', url.host);
    const body = init.body;
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== 'string' &&
      !(body instanceof Uint8Array) &&
      !(body instanceof ArrayBuffer)
    ) {
      throw new Error('Unsupported internal API request body.');
    }

    return new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(
        {
          hostname: connectHost,
          port: url.port ? Number(url.port) : 443,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers.entries()),
          servername: url.hostname,
          rejectUnauthorized: true,
          ca,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer | string) =>
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
          );
          response.once('error', reject);
          response.once('end', () => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
              else if (value !== undefined) responseHeaders.set(name, value);
            }
            const bytes = Buffer.concat(chunks);
            const responseInit: ResponseInit = {
              status: response.statusCode ?? 500,
              headers: responseHeaders,
            };
            if (response.statusMessage !== undefined)
              responseInit.statusText = response.statusMessage;
            resolve(new Response(bytes.length ? bytes : null, responseInit));
          });
        },
      );
      request.once('error', reject);
      if (init.signal) {
        if (init.signal.aborted) request.destroy(new Error('Internal API request aborted.'));
        else
          init.signal.addEventListener(
            'abort',
            () => request.destroy(new Error('Internal API request aborted.')),
            { once: true },
          );
      }
      if (typeof body === 'string' || body instanceof Uint8Array) request.write(body);
      else if (body instanceof ArrayBuffer) request.write(new Uint8Array(body));
      request.end();
    });
  };
}

export class HttpPlatformClient implements PlatformClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: PlatformFetch = fetch,
  ) {
    if (new URL(baseUrl).protocol !== 'https:') throw new Error('INTERNAL_API_URL must use HTTPS.');
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImpl(`${trimTrailingSlash(this.baseUrl)}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Internal API ${path} failed with ${response.status}.`);
    return response;
  }

  async getPrompt(aiJobId: string): Promise<ScopedPrompt> {
    return (
      await this.request(`/api/internal/ai-jobs/${encodeURIComponent(aiJobId)}/prompt`)
    ).json() as Promise<ScopedPrompt>;
  }

  async submitRawResult(aiJobId: string, rawOutput: string): Promise<void> {
    await this.request(`/api/internal/ai-jobs/${encodeURIComponent(aiJobId)}/result`, {
      method: 'POST',
      body: JSON.stringify({ rawOutput }),
    });
  }

  async reportStatus(input: Parameters<PlatformClient['reportStatus']>[0]): Promise<void> {
    await this.request(`/api/internal/ai-jobs/${encodeURIComponent(input.aiJobId)}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async heartbeat(): Promise<void> {
    await this.request('/api/internal/inference-workers/heartbeat', { method: 'POST', body: '{}' });
  }
}

export class HttpLmStudioClient implements LmStudioClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      throw new Error('LM Studio base URL must resolve to local loopback.');
  }

  async complete(prompt: ScopedPrompt): Promise<string> {
    try {
      const models = await this.fetchImpl(`${trimTrailingSlash(this.baseUrl)}/v1/models`);
      if (!models.ok)
        throw new InferenceUnavailableError(`LM Studio model endpoint returned ${models.status}.`);
      const response = await this.fetchImpl(
        `${trimTrailingSlash(this.baseUrl)}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: prompt.modelId,
            messages: prompt.messages,
            temperature: prompt.temperature ?? 0,
            ...(prompt.responseFormat ? { response_format: prompt.responseFormat } : {}),
          }),
        },
      );
      if (!response.ok)
        throw new InferenceUnavailableError(`LM Studio completion returned ${response.status}.`);
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content)
        throw new InferenceUnavailableError('LM Studio returned no completion content.');
      return content;
    } catch (error) {
      if (error instanceof InferenceUnavailableError) throw error;
      throw new InferenceUnavailableError(
        error instanceof Error ? error.message : 'LM Studio network failure.',
      );
    }
  }
}
