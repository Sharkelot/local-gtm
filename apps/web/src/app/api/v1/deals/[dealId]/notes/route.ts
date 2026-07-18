import { createNoteWithAiJob, prisma } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const { dealId } = await params;
    const body = (await request.json()) as { body?: string };
    const result = await createNoteWithAiJob(prisma, context, { dealId, body: body.body ?? '' });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
