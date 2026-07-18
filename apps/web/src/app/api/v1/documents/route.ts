import { prisma, uploadDocumentMetadata, uploadDocumentMetadataInputSchema } from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

/** Registers already-stored object metadata; byte upload and malware scanning remain separate services. */
export async function POST(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { sizeBytes?: unknown } & Record<string, unknown>;
    if (typeof body.sizeBytes === 'string' && /^\d{1,19}$/.test(body.sizeBytes))
      body.sizeBytes = BigInt(body.sizeBytes);
    const input = uploadDocumentMetadataInputSchema.parse(body);
    return Response.json(await uploadDocumentMetadata(prisma, context, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
