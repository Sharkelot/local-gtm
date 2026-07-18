import { decideAiSuggestion, prisma } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const { suggestionId } = await params;
    const body = (await request.json()) as { decision?: 'APPROVE' | 'REJECT'; reason?: string };
    const suggestion = await decideAiSuggestion(prisma, context, {
      suggestionId,
      decision: body.decision ?? 'REJECT',
      reason: body.reason ?? 'Reviewed by user.',
      idempotencyKey,
    });
    return Response.json(suggestion);
  } catch (error) {
    return apiError(error);
  }
}
