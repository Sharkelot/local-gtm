import { platformPrisma } from '@local-gtm/db';
import { getInternalToken } from '@/lib/request-context';

export async function POST(request: Request) {
  if (!getInternalToken(request))
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const workerId = process.env.INFERENCE_WORKER_ID ?? 'windows-lm-studio-primary';
  await platformPrisma.workerHeartbeat.upsert({
    where: { workerId },
    create: {
      workerId,
      workerType: 'INFERENCE',
      modelIds: [process.env.AI_MODEL_ID ?? 'unselected'],
      status: 'ONLINE',
      lastSeenAt: new Date(),
      metadata: { platform: 'windows' },
    },
    update: {
      modelIds: [process.env.AI_MODEL_ID ?? 'unselected'],
      status: 'ONLINE',
      lastSeenAt: new Date(),
      metadata: { platform: 'windows' },
    },
  });
  return Response.json({ accepted: true });
}
