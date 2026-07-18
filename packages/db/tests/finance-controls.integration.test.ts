import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeAccountingPeriod,
  createAccountingPeriod,
  createLedgerAccount,
  createTimeEntry,
  postLedgerEntry,
  type TenantContext,
} from '../src/index.js';

const integrationEnabled = Boolean(process.env.TEST_DATABASE_URL);
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/invalid';
const suite = describe.skipIf(!integrationEnabled);

suite('finance lifecycle database controls', () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('audits lifecycle operations and enforces role, closed-period, and global-lock invariants', async () => {
    const suffix = randomUUID();
    const tenant = await client.tenant.create({
      data: {
        name: `Finance integration ${suffix}`,
        slug: `finance-integration-${suffix}`,
        financialFeaturesEnabled: true,
        jurisdictionCode: 'US-TEST',
        approvedBy: 'integration-specialist',
        approvedAt: new Date('2026-07-17T00:00:00.000Z'),
      },
    });
    const [adminIdentity, clientIdentity] = await Promise.all([
      client.identity.create({
        data: {
          issuer: 'integration-test',
          subject: `admin-${suffix}`,
          email: `admin-${suffix}@example.test`,
          displayName: 'Finance Admin',
        },
      }),
      client.identity.create({
        data: {
          issuer: 'integration-test',
          subject: `client-${suffix}`,
          email: `client-${suffix}@example.test`,
          displayName: 'Portal Client',
        },
      }),
    ]);
    await client.membership.createMany({
      data: [
        { tenantId: tenant.id, identityId: adminIdentity.id, role: 'TENANT_ADMIN' },
        { tenantId: tenant.id, identityId: clientIdentity.id, role: 'CLIENT' },
      ],
    });
    const organization = await client.organization.create({
      data: {
        tenantId: tenant.id,
        name: `Finance Client ${suffix}`,
        normalizedName: `financeclient${suffix.replaceAll('-', '')}`,
      },
    });
    const matter = await client.matter.create({
      data: {
        tenantId: tenant.id,
        organizationId: organization.id,
        matterNumber: `MAT-${suffix}`,
        name: 'Finance control matter',
        status: 'ACTIVE',
      },
    });
    const context: TenantContext = {
      tenantId: tenant.id,
      actorId: adminIdentity.id,
      actorType: 'USER',
      correlationId: randomUUID(),
    };

    const timeEntry = await createTimeEntry(client, context, {
      matterId: matter.id,
      minutes: 30,
      rateCents: 30_000,
      description: 'Prepare integration test evidence',
      occurredOn: new Date('2026-07-17T12:00:00.000Z'),
      idempotencyKey: `time-${suffix}`,
    });
    expect(timeEntry.userId).toBe(adminIdentity.id);
    await expect(
      createTimeEntry(
        client,
        { ...context, actorId: clientIdentity.id, correlationId: randomUUID() },
        {
          matterId: matter.id,
          minutes: 15,
          rateCents: 10_000,
          description: 'A portal client must not record billable time',
          occurredOn: new Date('2026-07-17T12:00:00.000Z'),
          idempotencyKey: `client-time-${suffix}`,
        },
      ),
    ).rejects.toThrow(/membership is required/i);

    const operating = await createLedgerAccount(client, context, {
      name: `Operating ${suffix}`,
      type: 'OPERATING',
      idempotencyKey: `account-${suffix}`,
    });
    const revenue = await createLedgerAccount(client, context, {
      name: `Revenue ${suffix}`,
      type: 'REVENUE',
      idempotencyKey: `revenue-${suffix}`,
    });
    const period = await createAccountingPeriod(client, context, {
      startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-01T00:00:00.000Z'),
      idempotencyKey: `period-${suffix}`,
    });
    const closed = await closeAccountingPeriod(client, context, {
      accountingPeriodId: period.id,
      reason: 'Integration close evidence',
      idempotencyKey: `period-close-${suffix}`,
    });
    expect(closed.status).toBe('CLOSED');
    expect(
      await client.auditEvent.count({
        where: {
          tenantId: tenant.id,
          action: {
            in: [
              'time_entry.created',
              'ledger_account.created',
              'accounting_period.created',
              'accounting_period.closed',
            ],
          },
        },
      }),
    ).toBe(5);

    await expect(
      client.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN' },
      }),
    ).rejects.toThrow(/closed accounting periods/i);
    await expect(
      client.periodLock.create({
        data: {
          tenantId: tenant.id,
          accountingPeriodId: period.id,
          lockedBy: adminIdentity.id,
          reason: 'Duplicate global lock',
        },
      }),
    ).rejects.toThrow();

    await createAccountingPeriod(client, context, {
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-09-01T00:00:00.000Z'),
      idempotencyKey: `august-period-${suffix}`,
    });
    await expect(
      postLedgerEntry(client, context, {
        occurredAt: new Date('2026-08-01T00:00:00.000Z'),
        description: 'Adjacent-period boundary posting',
        idempotencyKey: `boundary-post-${suffix}`,
        lines: [
          { accountId: operating.id, debitCents: 100, creditCents: 0 },
          { accountId: revenue.id, debitCents: 0, creditCents: 100 },
        ],
      }),
    ).resolves.toMatchObject({ description: 'Adjacent-period boundary posting' });

    const trustBank = await createLedgerAccount(client, context, {
      name: `Trust bank ${suffix}`,
      type: 'TRUST_BANK',
      idempotencyKey: `trust-bank-${suffix}`,
    });
    const clientTrust = await createLedgerAccount(client, context, {
      name: `Client trust ${suffix}`,
      type: 'CLIENT_TRUST_LIABILITY',
      clientId: organization.id,
      idempotencyKey: `client-trust-${suffix}`,
    });
    await postLedgerEntry(client, context, {
      occurredAt: new Date('2026-08-02T00:00:00.000Z'),
      description: 'Initial client trust deposit',
      idempotencyKey: `trust-deposit-${suffix}`,
      lines: [
        { accountId: trustBank.id, debitCents: 100, creditCents: 0 },
        { accountId: clientTrust.id, debitCents: 0, creditCents: 100 },
      ],
    });
    const withdrawals = await Promise.allSettled(
      ['a', 'b'].map((label) =>
        postLedgerEntry(
          client,
          { ...context, correlationId: randomUUID() },
          {
            occurredAt: new Date('2026-08-03T00:00:00.000Z'),
            description: `Concurrent client trust withdrawal ${label}`,
            idempotencyKey: `trust-withdrawal-${label}-${suffix}`,
            lines: [
              { accountId: trustBank.id, debitCents: 0, creditCents: 80 },
              { accountId: clientTrust.id, debitCents: 80, creditCents: 0 },
            ],
          },
        ),
      ),
    );
    expect(withdrawals.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(withdrawals.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
