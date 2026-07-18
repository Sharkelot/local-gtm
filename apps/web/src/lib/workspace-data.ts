import { prisma, searchOrganizations, withTenant, type TenantContext } from '@local-gtm/db';

export function getDeals(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.deal.findMany({
      where: { tenantId: context.tenantId, archivedAt: null },
      include: { organization: true },
      orderBy: { updatedAt: 'desc' },
    }),
  );
}
export function getDeal(context: TenantContext, id: string) {
  return withTenant(prisma, context, (tx) =>
    tx.deal.findFirst({
      where: { id, tenantId: context.tenantId, archivedAt: null },
      include: {
        organization: { include: { contacts: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { aiJobs: { include: { suggestions: true } } },
        },
      },
    }),
  );
}
export function getOrganizations(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.organization.findMany({
      where: { tenantId: context.tenantId, archivedAt: null },
      include: { contacts: true, deals: true },
      orderBy: { name: 'asc' },
    }),
  );
}
export function getAiQueue(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.aiJob.findMany({
      where: { tenantId: context.tenantId },
      include: {
        note: { include: { deal: { include: { organization: true } } } },
        suggestions: true,
        attempts: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );
}
export function getAuditTimeline(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.auditEvent.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { sequence: 'desc' },
      take: 250,
    }),
  );
}
export function getMatters(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.matter.findMany({
      where: { tenantId: context.tenantId, archivedAt: null },
      include: { organization: true, documents: true, timeEntries: true, invoices: true },
      orderBy: { updatedAt: 'desc' },
    }),
  );
}
export function getInvoices(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.invoice.findMany({
      where: { tenantId: context.tenantId },
      include: { matter: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
}
export function getTimeEntries(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.timeEntry.findMany({
      where: { tenantId: context.tenantId },
      include: { matter: true },
      orderBy: { occurredOn: 'desc' },
      take: 100,
    }),
  );
}
export function getLedgerAccounts(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.ledgerAccount.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { name: 'asc' },
    }),
  );
}
export function getAccountingPeriods(context: TenantContext) {
  return withTenant(prisma, context, (tx) =>
    tx.accountingPeriod.findMany({
      where: { tenantId: context.tenantId },
      include: { locks: true },
      orderBy: { startsAt: 'desc' },
    }),
  );
}
export function runWorkspaceSearch(context: TenantContext, query: string) {
  return searchOrganizations(prisma, context, query);
}
