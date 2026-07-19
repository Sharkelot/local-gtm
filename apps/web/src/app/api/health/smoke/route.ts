import { prisma } from '@local-gtm/db';

const requiredEnv = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'KEYCLOAK_ISSUER',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_CLIENT_SECRET',
] as const;

export async function GET() {
  const checks: Record<string, 'ok' | 'failed'> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'failed';
  }

  for (const name of requiredEnv) {
    checks[name.toLowerCase()] = process.env[name] ? 'ok' : 'failed';
  }

  const healthy = Object.values(checks).every((value) => value === 'ok');
  return Response.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 },
  );
}
