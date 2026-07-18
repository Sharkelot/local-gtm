import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkWebhookRateLimit } from './webhook-rate-limit';

const redisUrl = process.env.TEST_REDIS_URL;
const suite = describe.skipIf(!redisUrl);

suite('Redis webhook rate limiting', () => {
  let redis!: Redis;
  const key = `webhook-rate:integration:${randomUUID()}`;

  beforeAll(async () => {
    redis = new Redis(redisUrl as string, { maxRetriesPerRequest: 1 });
    await redis.ping();
  });

  afterAll(async () => {
    await redis.del(key);
    await redis.quit();
  });

  it('atomically limits the first request over the configured fixed-window ceiling', async () => {
    await expect(checkWebhookRateLimit(redis, key, 2, 60_000)).resolves.toEqual({
      status: 'allowed',
    });
    await expect(checkWebhookRateLimit(redis, key, 2, 60_000)).resolves.toEqual({
      status: 'allowed',
    });
    await expect(checkWebhookRateLimit(redis, key, 2, 60_000)).resolves.toMatchObject({
      status: 'limited',
    });
  });
});
