import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integrationEnabled = Boolean(process.env.TEST_DATABASE_URL);
const adminUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/invalid';
const suite = describe.skipIf(!integrationEnabled);

suite('PostgreSQL tenant and immutability controls', () => {
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  const runtimeUrl = adminUrl.replace('test:test@', 'app_runtime:runtime-test@');
  const runtime = new PrismaClient({ datasourceUrl: runtimeUrl });
  const tenantA = '10000000-0000-4000-8000-000000000001';
  const tenantB = '20000000-0000-4000-8000-000000000002';
  const tenantBConnection = '20000000-0000-4000-8000-000000000030';

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN CREATE ROLE app_runtime LOGIN PASSWORD 'runtime-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$",
    );
    await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO app_runtime');
    await admin.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime',
    );
    await admin.$executeRawUnsafe(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime',
    );
    await admin.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A', slug: 'tenant-a' },
        { id: tenantB, name: 'Tenant B', slug: 'tenant-b' },
      ],
      skipDuplicates: true,
    });
    await admin.organization.createMany({
      data: [
        { tenantId: tenantA, name: 'Visible Firm', normalizedName: 'visiblefirm' },
        { tenantId: tenantB, name: 'Hidden Firm', normalizedName: 'hiddenfirm' },
      ],
      skipDuplicates: true,
    });
    await admin.integrationConnection.createMany({
      data: [
        {
          id: '10000000-0000-4000-8000-000000000030',
          tenantId: tenantA,
          provider: 'MICROSOFT',
          encryptedToken: 'integration-test-only',
          scopes: ['Mail.Read'],
        },
        {
          id: tenantBConnection,
          tenantId: tenantB,
          provider: 'MICROSOFT',
          encryptedToken: 'integration-test-only',
          scopes: ['Mail.Read'],
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await Promise.all([runtime.$disconnect(), admin.$disconnect()]);
  });

  it('defaults to no tenant rows without transaction context', async () => {
    expect(await runtime.organization.count()).toBe(0);
  });

  it('shows only the transaction tenant and blocks substituted writes', async () => {
    await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;
      const organizations = await tx.organization.findMany({ orderBy: { name: 'asc' } });
      expect(organizations.map((organization) => organization.name)).toContain('Visible Firm');
      expect(organizations.map((organization) => organization.name)).not.toContain('Hidden Firm');
      expect(organizations.every((organization) => organization.tenantId === tenantA)).toBe(true);
      await expect(
        tx.organization.create({
          data: { tenantId: tenantB, name: 'Injected', normalizedName: 'injected' },
        }),
      ).rejects.toThrow();
    });
  });

  it('rejects mutation of audit history', async () => {
    const latest = await admin.auditEvent.aggregate({
      where: { tenantId: tenantA },
      _max: { sequence: true },
    });
    const event = await admin.auditEvent.create({
      data: {
        tenantId: tenantA,
        sequence: (latest._max.sequence ?? 0n) + 1n,
        actorType: 'SYSTEM',
        actorId: 'integration-test',
        action: 'test.created',
        entityType: 'Organization',
        entityId: randomUUID(),
        redactedDiff: {},
        correlationId: randomUUID(),
        eventHash: 'test-hash',
      },
    });
    await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;
      await expect(
        tx.auditEvent.update({ where: { id: event.id }, data: { action: 'tampered' } }),
      ).rejects.toThrow(/immutable/i);
    });
  });

  it('rejects cross-tenant foreign IDs even when the inserted row claims the active tenant', async () => {
    const hidden = await admin.organization.findFirstOrThrow({
      where: { tenantId: tenantB, normalizedName: 'hiddenfirm' },
    });
    await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;
      await expect(
        tx.linkedCommunication.create({
          data: {
            tenantId: tenantA,
            connectionId: tenantBConnection,
            provider: 'MICROSOFT',
            itemType: 'MESSAGE',
            providerItemId: randomUUID(),
            organizationId: hidden.id,
            linkedBy: 'integration-test',
          },
        }),
      ).rejects.toThrow();
    });
  });
});
