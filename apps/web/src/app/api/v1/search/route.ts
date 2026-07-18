import { prisma, searchOrganizations } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function GET(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const query = new URL(request.url).searchParams.get('q')?.slice(0, 500) ?? '';
    return Response.json({ query, results: await searchOrganizations(prisma, context, query) });
  } catch (error) {
    return apiError(error);
  }
}
