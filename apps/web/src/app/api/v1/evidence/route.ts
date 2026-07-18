import {
  listEvidence,
  listEvidenceInputSchema,
  prisma,
  registerEvidence,
  registerEvidenceInputSchema,
} from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const input = registerEvidenceInputSchema.parse(await request.json());
    return Response.json(await registerEvidence(prisma, context, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const raw = {
      ...(searchParams.has('recordType') ? { recordType: searchParams.get('recordType') } : {}),
      ...(searchParams.has('recordId') ? { recordId: searchParams.get('recordId') } : {}),
      ...(searchParams.has('take') ? { take: Number(searchParams.get('take')) } : {}),
    };
    const input = listEvidenceInputSchema.parse(raw);
    return Response.json(await listEvidence(prisma, context, input));
  } catch (error) {
    return apiError(error);
  }
}
