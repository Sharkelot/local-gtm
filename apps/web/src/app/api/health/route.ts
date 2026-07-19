import { prisma } from '@local-gtm/db';

/** Combined health probe retained for existing Compose health checks. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
