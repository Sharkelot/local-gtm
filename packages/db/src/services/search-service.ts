import type { PrismaClient } from '@prisma/client';
import { searchPlanSchema, type SearchPlan } from '@local-gtm/contracts';
import { normalizeSearchIntent } from '@local-gtm/domain';
import { type TenantContext, withTenant } from '../tenant.js';

export async function searchOrganizations(
  client: PrismaClient,
  context: TenantContext,
  query: string,
  aiPlan?: SearchPlan,
) {
  const plan = searchPlanSchema.parse(aiPlan ?? normalizeSearchIntent(query));
  return withTenant(client, context, (tx) =>
    tx.organization.findMany({
      where: {
        tenantId: context.tenantId,
        archivedAt: null,
        ...(plan.insightCategories.includes('SECURITY_CONCERN') ? { securityConcern: true } : {}),
        ...(plan.terms.length > 0
          ? {
              OR: plan.terms.flatMap((term) => [
                { name: { contains: term, mode: 'insensitive' as const } },
                { securityConcerns: { has: term } },
                { integrationRequirements: { has: term } },
              ]),
            }
          : {}),
      },
      include: { deals: { where: { archivedAt: null } } },
      orderBy: plan.sort === 'NAME_ASC' ? { name: 'asc' } : { updatedAt: 'desc' },
      take: plan.limit,
    }),
  );
}
