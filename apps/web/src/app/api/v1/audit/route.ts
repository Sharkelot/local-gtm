import { prisma, withTenant } from '@local-gtm/db';
import { getActiveRequestContext } from '@/lib/request-context';

export async function GET() {
  const context = await getActiveRequestContext({ redirectOnMissing: false });
  if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const events = await withTenant(prisma, context, (tx) =>
    tx.auditEvent.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { sequence: 'desc' },
      take: 250,
    }),
  );
  return Response.json(events.map((event) => ({ ...event, sequence: event.sequence.toString() })));
}
