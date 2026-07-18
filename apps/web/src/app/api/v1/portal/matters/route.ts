import { listClientPortalMatters, listClientPortalMattersInputSchema, prisma } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function GET() {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const input = listClientPortalMattersInputSchema.parse({});
    return Response.json(await listClientPortalMatters(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
