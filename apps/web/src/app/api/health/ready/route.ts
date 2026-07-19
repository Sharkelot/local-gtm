import { prisma } from '@local-gtm/db';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok', checks: { database: 'reachable' } });
  } catch {
    return Response.json(
      { status: 'degraded', checks: { database: 'unreachable' } },
      { status: 503 },
    );
  }
}
