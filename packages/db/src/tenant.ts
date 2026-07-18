import type { Prisma, PrismaClient } from '@prisma/client';

export type TenantTransaction = Prisma.TransactionClient;

export interface TenantContext {
  tenantId: string;
  actorId: string;
  actorType: 'USER' | 'SYSTEM' | 'AI_WORKER' | 'INTEGRATION';
  correlationId: string;
}

export async function withTenant<T>(
  client: PrismaClient,
  context: TenantContext,
  operation: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${context.tenantId}, true)`;
    return operation(tx);
  });
}
