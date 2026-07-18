import { randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { prisma, resolveActiveMembership, type TenantContext } from '@local-gtm/db';
import { authOptions } from '@/auth';

const demo = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  actorId: '10000000-0000-4000-8000-000000000090',
  tenantName: 'Eve Legal Services',
  role: 'TENANT_ADMIN',
  email: 'eve.admin@example.test',
};

export interface ActiveRequestContext extends TenantContext {
  tenantName: string;
  role: string;
  email: string;
}

export function getActiveRequestContext(): Promise<ActiveRequestContext>;
export function getActiveRequestContext(options: {
  redirectOnMissing: false;
}): Promise<ActiveRequestContext | null>;
export async function getActiveRequestContext(
  options: { redirectOnMissing?: boolean } = {},
): Promise<ActiveRequestContext | null> {
  if (process.env.DEMO_AUTH_BYPASS === 'true') {
    if (process.env.NODE_ENV === 'production')
      throw new Error('DEMO_AUTH_BYPASS is forbidden in production.');
    return { ...demo, actorType: 'USER' as const, correlationId: randomUUID() };
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    if (options.redirectOnMissing ?? true) redirect('/api/auth/signin');
    return null;
  }
  const membership = await resolveActiveMembership(prisma, email);
  if (!membership) throw new Error('Authenticated identity has no active tenant membership.');
  return {
    tenantId: membership.tenantId,
    actorId: membership.identityId,
    actorType: 'USER' as const,
    correlationId: randomUUID(),
    tenantName: membership.tenant.name,
    role: membership.role,
    email: membership.identity.email,
  };
}

export function getInternalToken(request: Request): boolean {
  const configured = process.env.INFERENCE_WORKER_TOKEN;
  if (!configured) return false;
  return request.headers.get('authorization') === `Bearer ${configured}`;
}
