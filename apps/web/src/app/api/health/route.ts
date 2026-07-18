import { prisma } from '@local-gtm/db';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok', database: 'reachable' });
  } catch {
    return Response.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}
