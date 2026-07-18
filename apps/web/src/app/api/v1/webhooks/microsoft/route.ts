import {
  enqueueVerifiedWebhook,
  parseTrustedWebhookMappings,
  recordRejectedWebhook,
  verifyMicrosoftNotification,
  prisma,
} from '@local-gtm/db';
import { enforceWebhookRateLimit, webhookRateLimitResponse } from '@/lib/webhook-rate-limit';
import { readBoundedRawBody } from '../raw-body';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const limited = webhookRateLimitResponse(await enforceWebhookRateLimit(request, 'MICROSOFT'));
  if (limited) return limited;
  const validationToken = new URL(request.url).searchParams.get('validationToken');
  if (validationToken !== null)
    return new Response(validationToken, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  const body = await readBoundedRawBody(request);
  if (!body) return new Response(null, { status: 413 });
  const verifiedEvents = verifyMicrosoftNotification(
    body,
    parseTrustedWebhookMappings(process.env.WEBHOOK_TRUSTED_MAPPINGS),
  );
  if (!verifiedEvents) {
    await recordRejectedWebhook(prisma, 'MICROSOFT', body);
    return new Response(null, { status: 401 });
  }
  await Promise.all(verifiedEvents.map((verified) => enqueueVerifiedWebhook(prisma, verified)));
  return new Response(null, { status: 202 });
}
