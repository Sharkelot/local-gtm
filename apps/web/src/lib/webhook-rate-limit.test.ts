import { describe, expect, it, vi } from 'vitest';
import { checkWebhookRateLimit, webhookRateLimitResponse } from './webhook-rate-limit';

describe('public webhook rate limiting', () => {
  it('allows requests inside the fixed window and limits excess requests', async () => {
    const client = {
      eval: vi.fn().mockResolvedValueOnce([120, 30_001]).mockResolvedValueOnce([121, 30_001]),
    };
    await expect(checkWebhookRateLimit(client, 'bounded-key')).resolves.toEqual({
      status: 'allowed',
    });
    await expect(checkWebhookRateLimit(client, 'bounded-key')).resolves.toEqual({
      status: 'limited',
      retryAfterSeconds: 31,
    });
  });

  it('rejects malformed Redis results instead of bypassing the limit', async () => {
    const client = { eval: vi.fn().mockResolvedValue(['not-a-count']) };
    await expect(checkWebhookRateLimit(client, 'bounded-key')).rejects.toThrow(/invalid/i);
  });

  it('returns retryable responses for exhaustion and limiter outages', () => {
    expect(webhookRateLimitResponse({ status: 'limited', retryAfterSeconds: 12 })?.status).toBe(
      429,
    );
    expect(webhookRateLimitResponse({ status: 'unavailable' })?.status).toBe(503);
    expect(webhookRateLimitResponse({ status: 'allowed' })).toBeNull();
  });
});
