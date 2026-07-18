import { recordRejectedWebhook, prisma } from '@local-gtm/db';
import { enforceWebhookRateLimit, webhookRateLimitResponse } from '@/lib/webhook-rate-limit';
import { readBoundedRawBody } from '../raw-body';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const limited = webhookRateLimitResponse(await enforceWebhookRateLimit(request, 'LAWPAY'));
  if (limited) return limited;
  const body = await readBoundedRawBody(request);
  if (!body) return new Response(null, { status: 413 });
  // The body is hashed only; payment instruments and raw provider contents are never retained.
  await recordRejectedWebhook(prisma, 'LAWPAY', body);
  return new Response(null, { status: 501 });
}
