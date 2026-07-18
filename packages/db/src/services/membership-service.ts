import type { PrismaClient } from '@prisma/client';

export async function resolveActiveMembership(client: PrismaClient, email: string) {
  const identity = await client.identity.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (!identity) return null;
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_identity_id', ${identity.id}, true)`;
    return tx.membership.findFirst({
      where: { identityId: identity.id, active: true },
      include: { tenant: true, identity: true },
      orderBy: { createdAt: 'asc' },
    });
  });
}
