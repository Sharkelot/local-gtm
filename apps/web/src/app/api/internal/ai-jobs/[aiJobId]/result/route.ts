import { prisma, submitAiResult } from '@local-gtm/db';
import { getAiJobForInternalUse, workerContext } from '@/lib/internal-context';
import { protectValue } from '@/lib/protect-value';
import { getInternalToken } from '@/lib/request-context';

function parseModelJson(raw: string): unknown {
  const unwrapped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(unwrapped) as unknown;
}

export async function POST(request: Request, { params }: { params: Promise<{ aiJobId: string }> }) {
  if (!getInternalToken(request))
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const { aiJobId } = await params;
  const job = await getAiJobForInternalUse(aiJobId);
  if (!job) return Response.json({ message: 'AI job not found.' }, { status: 404 });
  const body = (await request.json()) as { rawOutput?: string };
  if (!body.rawOutput || body.rawOutput.length > 250_000)
    return Response.json({ message: 'Bounded rawOutput is required.' }, { status: 400 });
  const protectedRawOutput = await protectValue(body.rawOutput);
  let parsed: unknown;
  try {
    parsed = parseModelJson(body.rawOutput);
  } catch {
    parsed = body.rawOutput;
  }
  const result = await submitAiResult(prisma, workerContext(job.tenantId), {
    aiJobId,
    rawOutput: parsed,
    protectedRawOutput,
  });
  return Response.json({ accepted: true, duplicate: result.duplicate });
}
