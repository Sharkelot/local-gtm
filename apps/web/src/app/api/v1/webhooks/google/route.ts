import {
  enqueueVerifiedWebhook,
  parseTrustedWebhookMappings,
  recordRejectedWebhook,
  verifyGoogleCalendarNotification,
  prisma,
} from '@local-gtm/db';
import { enforceWebhookRateLimit, webhookRateLimitResponse } from '@/lib/webhook-rate-limit';
import { readBoundedRawBody } from '../raw-body';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const limited = webhookRateLimitResponse(await enforceWebhookRateLimit(request, 'GOOGLE'));
  if (limited) return limited;
  const body = await readBoundedRawBody(request);
  if (!body) return new Response(null, { status: 413 });
  const verified = verifyGoogleCalendarNotification(
    request.headers,
    body,
    parseTrustedWebhookMappings(process.env.WEBHOOK_TRUSTED_MAPPINGS),
  );
  if (!verified) {
    await recordRejectedWebhook(prisma, 'GOOGLE', body);
    return new Response(null, { status: 401 });
  }
  await enqueueVerifiedWebhook(prisma, verified);
  return new Response(null, { status: 202 });
}
