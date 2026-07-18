import { getCleanDocumentVersionForAccess, prisma } from '@local-gtm/db';
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
    const version = await getCleanDocumentVersionForAccess(prisma, context, documentId);
    // Deliberately no object bytes, signed URL, or encrypted data key: the storage boundary owns those.
    return Response.json({
      documentId: version.documentId,
      version: version.version,
      objectKey: version.objectKey,
      objectVersion: version.objectVersion,
      contentType: version.contentType,
      sizeBytes: version.sizeBytes.toString(),
      sha256: version.sha256,
    });
  } catch (error) {
    return apiError(error);
  }
}
