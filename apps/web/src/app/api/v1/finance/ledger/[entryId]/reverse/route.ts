import { prisma, reverseLedgerEntry, reverseLedgerEntryInputSchema } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const { entryId } = await params;
    const body: unknown = await request.json();
    const input = reverseLedgerEntryInputSchema.parse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      entryId,
      idempotencyKey,
    });
    return Response.json(await reverseLedgerEntry(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
