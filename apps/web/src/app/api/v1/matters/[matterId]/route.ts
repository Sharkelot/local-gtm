import { prisma, updateMatter, updateMatterInputSchema } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ matterId: string }> },
) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const { matterId } = await params;
    const input = updateMatterInputSchema.parse({ ...(await request.json()), matterId });
    return Response.json(await updateMatter(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
