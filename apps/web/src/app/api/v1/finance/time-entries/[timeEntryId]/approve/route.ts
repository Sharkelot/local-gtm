import { approveTimeEntry, approveTimeEntryInputSchema, prisma } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ timeEntryId: string }> },
) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const { timeEntryId } = await params;
    const input = approveTimeEntryInputSchema.parse({ timeEntryId, idempotencyKey });
    return Response.json(await approveTimeEntry(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
