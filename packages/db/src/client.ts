import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const internalDatabaseUrl = process.env.INTERNAL_DATABASE_URL ?? process.env.DATABASE_URL;
export const platformPrisma = new PrismaClient({
  ...(internalDatabaseUrl ? { datasourceUrl: internalDatabaseUrl } : {}),
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
