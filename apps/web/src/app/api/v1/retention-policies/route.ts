import { prisma, upsertRetentionPolicy, upsertRetentionPolicyInputSchema } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function PUT(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const input = upsertRetentionPolicyInputSchema.parse(await request.json());
    return Response.json(await upsertRetentionPolicy(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
