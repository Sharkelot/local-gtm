import { createAccountingPeriod, createAccountingPeriodInputSchema, prisma } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const input = createAccountingPeriodInputSchema.parse({
      ...(await request.json()),
      idempotencyKey,
    });
    return Response.json(await createAccountingPeriod(prisma, context, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
