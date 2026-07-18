import { createHash } from 'node:crypto';
import Redis from 'ioredis';

export type PublicWebhookProvider = 'MICROSOFT' | 'GOOGLE' | 'LAWPAY';

interface RedisEvalClient {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export type WebhookRateLimitResult =
  | { status: 'allowed' }
  | { status: 'limited'; retryAfterSeconds: number }
  | { status: 'unavailable' };

const windowMs = 60_000;
const requestLimit = 120;
const fixedWindowScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

function finiteInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function checkWebhookRateLimit(
  client: RedisEvalClient,
  key: string,
  limit = requestLimit,
  durationMs = windowMs,
): Promise<Exclude<WebhookRateLimitResult, { status: 'unavailable' }>> {
  const raw = await client.eval(fixedWindowScript, 1, key, String(durationMs));
  if (!Array.isArray(raw) || raw.length !== 2)
    throw new Error('Redis returned an invalid webhook rate-limit result.');
  const count = finiteInteger(raw[0]);
  const ttl = finiteInteger(raw[1]);
  if (count === null || ttl === null)
    throw new Error('Redis returned an invalid webhook rate-limit counter.');
  return count > limit
    ? { status: 'limited', retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1_000)) }
    : { status: 'allowed' };
}

function clientAddress(request: Request): string {
  // Caddy overwrites this header from its connection peer. The web container is not published,
  // so request-supplied forwarding chains are never trusted as rate-limit identity.
  const candidate = request.headers.get('x-real-ip')?.trim() || 'unknown';
  return candidate.slice(0, 200);
}

function rateLimitKey(request: Request, provider: PublicWebhookProvider): string {
  const digest = createHash('sha256')
    .update(`${provider}\u0000${clientAddress(request)}`)
    .digest('hex');
  return `webhook-rate:${provider.toLowerCase()}:${digest}`;
}

type WebhookRateLimitGlobal = typeof globalThis & {
  webhookRateLimitRedis?: Redis;
  webhookRateLimitRedisConnect?: Promise<Redis>;
};

async function getRedis(): Promise<Redis> {
  const state = globalThis as WebhookRateLimitGlobal;
  if (!state.webhookRateLimitRedis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL is required for public webhook rate limiting.');
    const client = new Redis(redisUrl, {
      connectTimeout: 2_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    client.on('error', () => undefined);
    state.webhookRateLimitRedis = client;
  }
  const client = state.webhookRateLimitRedis;
  if (client.status === 'ready') return client;
  if (!state.webhookRateLimitRedisConnect) {
    state.webhookRateLimitRedisConnect = client
      .connect()
      .then(() => client)
      .finally(() => {
        delete state.webhookRateLimitRedisConnect;
      });
  }
  return state.webhookRateLimitRedisConnect;
}

export async function enforceWebhookRateLimit(
  request: Request,
  provider: PublicWebhookProvider,
): Promise<WebhookRateLimitResult> {
  try {
    return await checkWebhookRateLimit(await getRedis(), rateLimitKey(request, provider));
  } catch {
    return { status: 'unavailable' };
  }
}

export function webhookRateLimitResponse(result: WebhookRateLimitResult): Response | null {
  if (result.status === 'allowed') return null;
  if (result.status === 'unavailable')
    return Response.json({ message: 'Webhook ingress temporarily unavailable.' }, { status: 503 });
  return Response.json(
    { message: 'Webhook rate limit exceeded.' },
    { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } },
  );
}
