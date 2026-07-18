import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  verifyGoogleCalendarNotification,
  verifyMicrosoftNotification,
  webhookOutboxPayload,
} from '../src/services/webhook-service.js';

const mappings = [
  {
    provider: 'MICROSOFT' as const,
    externalId: 'subscription-1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    secret: 'a'.repeat(32),
  },
  {
    provider: 'GOOGLE' as const,
    externalId: 'channel-1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    secret: 'b'.repeat(32),
  },
];

describe('webhook verification', () => {
  it('rejects a Microsoft notification with an invalid client state', () => {
    expect(
      verifyMicrosoftNotification(
        Buffer.from(
          JSON.stringify({ value: [{ subscriptionId: 'subscription-1', clientState: 'wrong' }] }),
        ),
        mappings,
      ),
    ).toBeNull();
  });
  it('coalesces a bounded trusted Microsoft batch by subscription and rejects mixed batches', () => {
    const body = Buffer.from(
      JSON.stringify({
        value: [
          { subscriptionId: 'subscription-1', clientState: 'a'.repeat(32), resource: 'one' },
          { subscriptionId: 'subscription-1', clientState: 'a'.repeat(32), resource: 'two' },
        ],
      }),
    );
    const events = verifyMicrosoftNotification(body, mappings);
    expect(events).toHaveLength(1);
    expect(events?.[0]?.providerEventId).toMatch(/^MICROSOFT:subscription-1:[a-f0-9]{64}$/);
    expect(
      verifyMicrosoftNotification(
        Buffer.from(
          JSON.stringify({
            value: [
              { subscriptionId: 'subscription-1', clientState: 'a'.repeat(32) },
              { subscriptionId: 'untrusted', clientState: 'a'.repeat(32) },
            ],
          }),
        ),
        mappings,
      ),
    ).toBeNull();
  });
  it('uses the Google channel message number as a replay-safe provider event id', () => {
    const headers = new Headers({
      'x-goog-channel-id': 'channel-1',
      'x-goog-channel-token': 'b'.repeat(32),
      'x-goog-message-number': '17',
    });
    const event = verifyGoogleCalendarNotification(headers, Buffer.from(''), mappings);
    expect(event?.providerEventId).toBe('GOOGLE:channel-1:17');
    expect(event?.payloadHash).toHaveLength(64);
  });
  it('rejects absent Google token and compares secrets without coercion', () => {
    expect(
      verifyGoogleCalendarNotification(
        new Headers({ 'x-goog-channel-id': 'channel-1', 'x-goog-message-number': '17' }),
        Buffer.from(''),
        mappings,
      ),
    ).toBeNull();
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
  it('creates an identifier-only outbox payload', () => {
    expect(webhookOutboxPayload('00000000-0000-4000-8000-000000000099')).toEqual({
      webhookEventId: '00000000-0000-4000-8000-000000000099',
    });
    expect(() => webhookOutboxPayload('card=4111111111111111')).toThrow();
  });
});
