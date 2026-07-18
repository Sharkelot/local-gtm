import { ClientPortal } from '@/components/client-portal';
import { getActiveRequestContext } from '@/lib/request-context';
import { listClientPortalMatters, prisma } from '@local-gtm/db';

export const dynamic = 'force-dynamic';

export default async function PortalPage() {
  const context = await getActiveRequestContext();
  const matters = await listClientPortalMatters(prisma, context);
  return <ClientPortal matters={matters} />;
}
