import { markAiJobProcessing, markAiJobWaiting, prisma } from '@local-gtm/db';
import { getAiJobForInternalUse, workerContext } from '@/lib/internal-context';
import { getInternalToken } from '@/lib/request-context';

export async function POST(request: Request, { params }: { params: Promise<{ aiJobId: string }> }) {
  if (!getInternalToken(request))
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const { aiJobId } = await params;
  const job = await getAiJobForInternalUse(aiJobId);
  if (!job) return Response.json({ message: 'AI job not found.' }, { status: 404 });
  const body = (await request.json()) as { state?: string; nextRetryAt?: string };
  const context = workerContext(job.tenantId);
  if (body.state === 'PROCESSING') await markAiJobProcessing(prisma, context, aiJobId);
  else if (body.state === 'WAITING_FOR_INFERENCE')
    await markAiJobWaiting(
      prisma,
      context,
      aiJobId,
      'LM_STUDIO_OFFLINE',
      body.nextRetryAt ? new Date(body.nextRetryAt) : undefined,
    );
  else return Response.json({ message: 'Unsupported state.' }, { status: 400 });
  return Response.json({ accepted: true });
}
