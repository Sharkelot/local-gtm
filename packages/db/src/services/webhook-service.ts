import { createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { withTenant } from '../tenant.js';

const uuid = z.string().uuid();
const providerSchema = z.enum(['MICROSOFT', 'GOOGLE', 'LAWPAY']);

export type WebhookProvider = z.infer<typeof providerSchema>;

export interface TrustedWebhookMapping {
  provider: WebhookProvider;
  /** Provider subscription, channel, or merchant identifier. Never supplied by a tenant request. */
  externalId: string;
  tenantId: string;
  secret: string;
}

export interface VerifiedWebhook {
  provider: WebhookProvider;
  providerEventId: string;
  tenantId: string;
  payloadHash: string;
  aggregateId: string;
}

export function webhookOutboxPayload(webhookEventId: string) {
  return { webhookEventId: uuid.parse(webhookEventId) };
}

export const webhookMappingSchema = z
  .object({
    provider: providerSchema,
    externalId: z.string().trim().min(1).max(500),
    tenantId: uuid,
    secret: z.string().min(16).max(4096),
  })
  .strict();

export function parseTrustedWebhookMappings(value: string | undefined): TrustedWebhookMapping[] {
  if (!value) return [];
  return z.array(webhookMappingSchema).max(1_000).parse(JSON.parse(value));
}

export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function mappingFor(
  mappings: readonly TrustedWebhookMapping[],
  provider: WebhookProvider,
  externalId: string,
) {
  return mappings.find(
    (mapping) => mapping.provider === provider && mapping.externalId === externalId,
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function eventId(provider: WebhookProvider, externalId: string, notificationGroup: unknown) {
  // Graph has no signed per-delivery ID. Coalesce each verified subscription's batch entries
  // into a canonical digest: identifiers remain durable and no notification body is persisted.
  return `${provider}:${externalId}:${createHash('sha256').update(stableJson(notificationGroup)).digest('hex')}`;
}

export function verifyMicrosoftNotification(
  rawBody: Uint8Array,
  mappings: readonly TrustedWebhookMapping[],
): VerifiedWebhook[] | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return null;
  }
  const parsed = z
    .object({
      value: z
        .array(
          z
            .object({
              subscriptionId: z.string().min(1).max(500),
              clientState: z.string().min(1).max(4096),
            })
            .passthrough(),
        )
        .min(1)
        .max(100),
    })
    .passthrough()
    .safeParse(value);
  if (!parsed.success) return null;
  const grouped = new Map<string, typeof parsed.data.value>();
  for (const notification of parsed.data.value) {
    const mapping = mappingFor(mappings, 'MICROSOFT', notification.subscriptionId);
    // Verify every entry before returning any tenant-associated event. A mixed batch cannot
    // cause trusted entries to be accepted while silently dropping an untrusted entry.
    if (!mapping || !constantTimeEqual(notification.clientState, mapping.secret)) return null;
    const group = grouped.get(mapping.externalId) ?? [];
    group.push(notification);
    grouped.set(mapping.externalId, group);
  }
  const payloadHash = sha256(rawBody);
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([externalId, notifications]) => {
      const mapping = mappingFor(mappings, 'MICROSOFT', externalId);
      if (!mapping) throw new Error('Verified mapping unexpectedly missing.');
      return {
        provider: 'MICROSOFT',
        tenantId: mapping.tenantId,
        payloadHash,
        providerEventId: eventId('MICROSOFT', externalId, notifications),
        aggregateId: externalId,
      };
    });
}

export function verifyGoogleCalendarNotification(
  headers: Headers,
  rawBody: Uint8Array,
  mappings: readonly TrustedWebhookMapping[],
): VerifiedWebhook | null {
  const channelId = headers.get('x-goog-channel-id');
  const channelToken = headers.get('x-goog-channel-token');
  const messageNumber = headers.get('x-goog-message-number');
  if (!channelId || !channelToken || !messageNumber || !/^\d{1,20}$/.test(messageNumber))
    return null;
  const mapping = mappingFor(mappings, 'GOOGLE', channelId);
  if (!mapping || !constantTimeEqual(channelToken, mapping.secret)) return null;
  return {
    provider: 'GOOGLE',
    tenantId: mapping.tenantId,
    payloadHash: sha256(rawBody),
    providerEventId: `GOOGLE:${channelId}:${messageNumber}`,
    aggregateId: channelId,
  };
}

/**
 * LawPay authentication is intentionally unsupported until its contracted webhook signature
 * scheme and replay headers are configured. Rejecting it is safer than inventing HMAC semantics.
 */
export function verifyLawPayNotification(): null {
  return null;
}

export async function recordRejectedWebhook(
  client: PrismaClient,
  provider: WebhookProvider,
  rawBody: Uint8Array,
) {
  const payloadHash = sha256(rawBody);
  return client.webhookEvent.upsert({
    where: { provider_providerEventId: { provider, providerEventId: `rejected:${payloadHash}` } },
    create: {
      provider,
      providerEventId: `rejected:${payloadHash}`,
      signatureValid: false,
      payloadHash,
      status: 'REJECTED',
    },
    update: {},
  });
}

export async function enqueueVerifiedWebhook(client: PrismaClient, verified: VerifiedWebhook) {
  return withTenant(
    client,
    {
      tenantId: verified.tenantId,
      actorId: verified.aggregateId,
      actorType: 'INTEGRATION',
      correlationId: crypto.randomUUID(),
    },
    async (tx) => {
      try {
        const webhook = await tx.webhookEvent.create({
          data: {
            provider: verified.provider,
            providerEventId: verified.providerEventId,
            signatureValid: true,
            payloadHash: verified.payloadHash,
            status: 'QUEUED',
          },
        });
        const outbox = await tx.outboxEvent.create({
          data: {
            tenantId: verified.tenantId,
            aggregateType: 'WebhookEvent',
            aggregateId: webhook.id,
            eventType: 'PROVIDER_WEBHOOK_RECEIVED',
            payload: webhookOutboxPayload(webhook.id),
          },
        });
        await appendAuditEvent(
          tx,
          {
            tenantId: verified.tenantId,
            actorId: verified.aggregateId,
            actorType: 'INTEGRATION',
            correlationId: crypto.randomUUID(),
          },
          {
            action: 'webhook.accepted',
            entityType: 'WebhookEvent',
            entityId: webhook.id,
            diff: { provider: verified.provider, payloadHash: verified.payloadHash },
          },
        );
        return { duplicate: false, webhookEventId: webhook.id, outboxEventId: outbox.id };
      } catch (error: unknown) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
          return { duplicate: true, webhookEventId: null, outboxEventId: null };
        }
        throw error;
      }
    },
  );
}
