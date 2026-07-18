import {
  grantClientMatterShare,
  grantClientMatterShareInputSchema,
  prisma,
  revokeClientMatterShare,
  revokeClientMatterShareInputSchema,
} from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

async function contextOrUnauthorized() {
  return getActiveRequestContext({ redirectOnMissing: false });
}

export async function POST(request: Request) {
  try {
    const context = await contextOrUnauthorized();
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const input = grantClientMatterShareInputSchema.parse({
      ...(await request.json()),
      idempotencyKey,
    });
    return Response.json(await grantClientMatterShare(prisma, context, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await contextOrUnauthorized();
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const input = revokeClientMatterShareInputSchema.parse({
      ...(await request.json()),
      idempotencyKey,
    });
    return Response.json(await revokeClientMatterShare(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
