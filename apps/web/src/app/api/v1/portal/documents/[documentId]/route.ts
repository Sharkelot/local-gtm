import {
  clientPortalDocumentInputSchema,
  getClientPortalDocumentMetadata,
  prisma,
} from '@local-gtm/db';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const { documentId } = await params;
    const input = clientPortalDocumentInputSchema.parse({ documentId });
    const document = await getClientPortalDocumentMetadata(prisma, context, input);
    return Response.json({ ...document, sizeBytes: document.sizeBytes.toString() });
  } catch (error) {
    return apiError(error);
  }
}
