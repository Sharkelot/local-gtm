import {
  explicitProviderCommunicationLinkSchema,
  linkProviderCommunication,
  prisma,
} from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function POST(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const input = explicitProviderCommunicationLinkSchema.parse(await request.json());
    return Response.json(await linkProviderCommunication(prisma, context, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
