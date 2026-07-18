import { prisma, withTenant, type TenantContext } from '@local-gtm/db';

export async function getDashboardData(context: TenantContext) {
  return withTenant(prisma, context, async (tx) => {
    const [organizations, deals, aiJobs, matters, auditEvents, duplicates] = await Promise.all([
      tx.organization.findMany({
        where: { tenantId: context.tenantId, archivedAt: null },
        include: { contacts: true },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
      tx.deal.findMany({
        where: { tenantId: context.tenantId, archivedAt: null },
        include: { organization: true, notes: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      tx.aiJob.findMany({
        where: { tenantId: context.tenantId },
        include: {
          suggestions: true,
          note: { include: { deal: { include: { organization: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      tx.matter.count({ where: { tenantId: context.tenantId, archivedAt: null } }),
      tx.auditEvent.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { sequence: 'desc' },
        take: 8,
      }),
      tx.duplicateCandidate.count({ where: { tenantId: context.tenantId, status: 'PENDING' } }),
    ]);
    return { organizations, deals, aiJobs, matters, auditEvents, duplicates };
  });
}
