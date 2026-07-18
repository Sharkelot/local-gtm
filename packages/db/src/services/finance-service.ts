import { createHash } from 'node:crypto';
import type { LedgerAccountType, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { type TenantContext, type TenantTransaction, withTenant } from '../tenant.js';

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const centsSchema = z.number().int().safe().nonnegative();
const uuidSchema = z.string().uuid();

export const approveTimeEntryInputSchema = z.object({
  timeEntryId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const createTimeEntryInputSchema = z
  .object({
    matterId: uuidSchema,
    minutes: z.number().int().min(1).max(1_440),
    rateCents: z.number().int().min(0).max(10_000_000),
    description: z.string().trim().min(1).max(1_000),
    occurredOn: z.coerce.date(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const createLedgerAccountInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['OPERATING', 'TRUST_BANK', 'CLIENT_TRUST_LIABILITY', 'REVENUE', 'RECEIVABLE']),
    clientId: uuidSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const createAccountingPeriodInputSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const closeAccountingPeriodInputSchema = z
  .object({
    accountingPeriodId: uuidSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const lockAccountingPeriodAccountInputSchema = z
  .object({
    accountingPeriodId: uuidSchema,
    ledgerAccountId: uuidSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const issueInvoiceInputSchema = z.object({
  matterId: uuidSchema,
  invoiceNumber: z.string().trim().min(1).max(100),
  timeEntryIds: z.array(uuidSchema).min(1).max(1_000),
  dueAt: z.coerce.date().optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const postLedgerEntryInputSchema = z.object({
  occurredAt: z.coerce.date(),
  description: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
  lines: z
    .array(
      z.object({
        accountId: uuidSchema,
        debitCents: centsSchema,
        creditCents: centsSchema,
      }),
    )
    .min(2)
    .max(100),
});

export const reconcileTrustAccountInputSchema = z.object({
  accountId: uuidSchema,
  periodEnd: z.coerce.date(),
  bankBalanceCents: centsSchema,
  bookBalanceCents: centsSchema,
  clientBalanceCents: centsSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const reverseLedgerEntryInputSchema = z
  .object({
    entryId: uuidSchema,
    idempotencyKey: idempotencyKeySchema,
    occurredAt: z.coerce.date().optional(),
  })
  .strict();

/** This input intentionally contains verified provider identifiers only; never payment instruments or raw bodies. */
export const recordVerifiedLawPayPaymentInputSchema = z
  .object({
    invoiceId: uuidSchema,
    lawPayPaymentId: z.string().trim().min(1).max(200),
    lawPayTransactionId: z.string().trim().min(1).max(200).optional(),
    providerEventId: z.string().trim().min(1).max(200).optional(),
    amountCents: z.number().int().safe().positive(),
    verifiedAt: z.coerce.date(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

type LedgerLineInput = z.infer<typeof postLedgerEntryInputSchema>['lines'][number];
type Account = { id: string; type: LedgerAccountType; clientId: string | null; active: boolean };

const financialRoles = ['TENANT_ADMIN', 'BILLING'] as const;
const timeEntryRoles = ['TENANT_ADMIN', 'ATTORNEY', 'BILLING', 'STAFF'] as const;

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** Pure invariant: every line has one positive side and the entry balances. */
export function assertBalancedLedgerLines(lines: readonly LedgerLineInput[]): void {
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    if ((line.debitCents === 0) === (line.creditCents === 0))
      throw new Error('Each ledger line must have exactly one positive side.');
    debits += line.debitCents;
    credits += line.creditCents;
  }
  if (debits !== credits) throw new Error('Ledger entry debits must equal credits.');
}

/** Pure invariant for a three-way trust reconciliation. */
export function assertThreeWayReconciliation(
  bankBalanceCents: number,
  bookBalanceCents: number,
  clientBalanceCents: number,
): void {
  if (bankBalanceCents !== bookBalanceCents || bookBalanceCents !== clientBalanceCents)
    throw new Error('Trust reconciliation requires matching bank, book, and client balances.');
}

function assertTrustSeparation(accounts: readonly Account[]): void {
  const hasTrust = accounts.some(
    (account) => account.type === 'TRUST_BANK' || account.type === 'CLIENT_TRUST_LIABILITY',
  );
  if (!hasTrust) return;
  if (
    accounts.some(
      (account) => account.type !== 'TRUST_BANK' && account.type !== 'CLIENT_TRUST_LIABILITY',
    )
  )
    throw new Error('Trust and operating accounts cannot be posted in the same ledger entry.');
  if (!accounts.some((account) => account.type === 'TRUST_BANK'))
    throw new Error('A trust entry requires a trust bank account.');
  if (!accounts.some((account) => account.type === 'CLIENT_TRUST_LIABILITY'))
    throw new Error('A trust entry requires a client trust liability account.');
  if (
    accounts.some(
      (account) =>
        (account.type === 'CLIENT_TRUST_LIABILITY' && !account.clientId) ||
        (account.type === 'TRUST_BANK' && account.clientId),
    )
  )
    throw new Error(
      'Trust liability accounts require a client and trust bank accounts cannot have one.',
    );
}

async function requireFinancialAccess(tx: TenantTransaction, context: TenantContext) {
  const tenant = await tx.tenant.findFirst({
    where: { id: context.tenantId, status: 'ACTIVE' },
    select: {
      financialFeaturesEnabled: true,
      jurisdictionCode: true,
      approvedBy: true,
      approvedAt: true,
    },
  });
  if (
    !tenant?.financialFeaturesEnabled ||
    !tenant.jurisdictionCode ||
    !tenant.approvedBy ||
    !tenant.approvedAt
  )
    throw new Error(
      'Financial features require jurisdiction configuration and legal/accounting approval.',
    );
  if (context.actorType !== 'USER')
    throw new Error('Financial mutations require an authorized user.');
  const membership = await tx.membership.findFirst({
    where: {
      tenantId: context.tenantId,
      identityId: context.actorId,
      active: true,
      role: { in: [...financialRoles] },
    },
    select: { id: true },
  });
  if (!membership) throw new Error('Billing or tenant-admin membership is required.');
}

async function requireFinancialFeature(tx: TenantTransaction, context: TenantContext) {
  const tenant = await tx.tenant.findFirst({
    where: { id: context.tenantId, status: 'ACTIVE' },
    select: {
      financialFeaturesEnabled: true,
      jurisdictionCode: true,
      approvedBy: true,
      approvedAt: true,
    },
  });
  if (
    !tenant?.financialFeaturesEnabled ||
    !tenant.jurisdictionCode ||
    !tenant.approvedBy ||
    !tenant.approvedAt
  )
    throw new Error(
      'Financial features require jurisdiction configuration and legal/accounting approval.',
    );
}

async function requireTimeEntryAccess(tx: TenantTransaction, context: TenantContext) {
  if (context.actorType !== 'USER')
    throw new Error('This financial mutation requires an authorized user.');
  const membership = await tx.membership.findFirst({
    where: {
      tenantId: context.tenantId,
      identityId: context.actorId,
      active: true,
      role: { in: [...timeEntryRoles] },
    },
    select: { id: true },
  });
  if (!membership)
    throw new Error('Attorney, staff, billing, or tenant-admin membership is required.');
}

async function requireTenantAdmin(tx: TenantTransaction, context: TenantContext) {
  if (context.actorType !== 'USER')
    throw new Error('This financial mutation requires an authorized user.');
  const membership = await tx.membership.findFirst({
    where: {
      tenantId: context.tenantId,
      identityId: context.actorId,
      active: true,
      role: 'TENANT_ADMIN',
    },
    select: { id: true },
  });
  if (!membership) throw new Error('Tenant-admin membership is required.');
}

async function findIdempotentRecord(
  tx: TenantTransaction,
  context: TenantContext,
  operation: string,
  key: string,
  requestHash: string,
) {
  const existing = await tx.idempotencyRecord.findUnique({
    where: { tenantId_operation_key: { tenantId: context.tenantId, operation, key } },
  });
  if (existing && existing.requestHash !== requestHash)
    throw new Error('Idempotency key was reused with different request data.');
  return existing;
}

async function recordIdempotency(
  tx: TenantTransaction,
  context: TenantContext,
  operation: string,
  key: string,
  requestHash: string,
  response: object,
) {
  await tx.idempotencyRecord.create({
    data: {
      tenantId: context.tenantId,
      operation,
      key,
      requestHash,
      response,
      statusCode: 200,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    },
  });
}

async function lockTenantLedgerMutations(tx: TenantTransaction, tenantId: string): Promise<void> {
  // Period closure, reconciliation, trust-balance validation, and ledger insertion must observe
  // one serial order per tenant. The lock is transaction-scoped and released automatically.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 2))`;
}

export async function approveTimeEntry(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof approveTimeEntryInputSchema>,
) {
  const input = approveTimeEntryInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialAccess(tx, context);
    const existing = await findIdempotentRecord(
      tx,
      context,
      'time_entry.approve',
      input.idempotencyKey,
      requestHash,
    );
    const entry = await tx.timeEntry.findFirstOrThrow({
      where: { id: input.timeEntryId, tenantId: context.tenantId },
    });
    if (existing) return entry;
    if (entry.approvedAt) throw new Error('Time entry is already approved.');
    if (entry.invoicedAt) throw new Error('Invoiced time entry cannot be approved again.');
    const approved = await tx.timeEntry.update({
      where: { id: entry.id },
      data: { approvedAt: new Date() },
    });
    await appendAuditEvent(tx, context, {
      action: 'time_entry.approved',
      entityType: 'TimeEntry',
      entityId: entry.id,
      diff: { minutes: entry.minutes, rateCents: entry.rateCents },
    });
    await recordIdempotency(tx, context, 'time_entry.approve', input.idempotencyKey, requestHash, {
      timeEntryId: entry.id,
    });
    return approved;
  });
}

export async function createTimeEntry(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof createTimeEntryInputSchema>,
) {
  const input = createTimeEntryInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialFeature(tx, context);
    await requireTimeEntryAccess(tx, context);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'time_entry.create',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { timeEntryId?: string } | null;
      if (!response?.timeEntryId) throw new Error('Stored idempotency response is invalid.');
      return tx.timeEntry.findFirstOrThrow({
        where: { id: response.timeEntryId, tenantId: context.tenantId },
      });
    }
    const matter = await tx.matter.findFirst({
      where: { id: input.matterId, tenantId: context.tenantId, archivedAt: null },
      select: { id: true, status: true },
    });
    if (!matter || matter.status !== 'ACTIVE') throw new Error('An active matter is required.');
    const entry = await tx.timeEntry.create({
      data: {
        tenantId: context.tenantId,
        userId: context.actorId,
        matterId: input.matterId,
        minutes: input.minutes,
        rateCents: input.rateCents,
        description: input.description,
        occurredOn: input.occurredOn,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'time_entry.created',
      entityType: 'TimeEntry',
      entityId: entry.id,
      diff: { matterId: entry.matterId, minutes: entry.minutes, rateCents: entry.rateCents },
    });
    await recordIdempotency(tx, context, 'time_entry.create', input.idempotencyKey, requestHash, {
      timeEntryId: entry.id,
    });
    return entry;
  });
}

export async function createLedgerAccount(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof createLedgerAccountInputSchema>,
) {
  const input = createLedgerAccountInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialFeature(tx, context);
    await requireFinancialAccess(tx, context);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'ledger_account.create',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { ledgerAccountId?: string } | null;
      if (!response?.ledgerAccountId) throw new Error('Stored idempotency response is invalid.');
      return tx.ledgerAccount.findFirstOrThrow({
        where: { id: response.ledgerAccountId, tenantId: context.tenantId },
      });
    }
    if (input.type === 'TRUST_BANK' && input.clientId)
      throw new Error('Trust bank accounts cannot have a client.');
    if (input.type === 'CLIENT_TRUST_LIABILITY' && !input.clientId)
      throw new Error('Client trust liability accounts require a client.');
    if (input.type !== 'CLIENT_TRUST_LIABILITY' && input.clientId)
      throw new Error('Only client trust liability accounts may have a client.');
    if (input.clientId) {
      const client = await tx.organization.findFirst({
        where: { id: input.clientId, tenantId: context.tenantId, archivedAt: null },
        select: { id: true },
      });
      if (!client) throw new Error('Client organization was not found.');
    }
    const account = await tx.ledgerAccount.create({
      data: {
        tenantId: context.tenantId,
        name: input.name,
        type: input.type,
        clientId: input.clientId ?? null,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'ledger_account.created',
      entityType: 'LedgerAccount',
      entityId: account.id,
      diff: { type: account.type, clientId: account.clientId },
    });
    await recordIdempotency(
      tx,
      context,
      'ledger_account.create',
      input.idempotencyKey,
      requestHash,
      {
        ledgerAccountId: account.id,
      },
    );
    return account;
  });
}

export async function createAccountingPeriod(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof createAccountingPeriodInputSchema>,
) {
  const input = createAccountingPeriodInputSchema.parse(unparsedInput);
  if (input.startsAt >= input.endsAt)
    throw new Error('Accounting period start must precede its end.');
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialFeature(tx, context);
    await requireFinancialAccess(tx, context);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'accounting_period.create',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { accountingPeriodId?: string } | null;
      if (!response?.accountingPeriodId) throw new Error('Stored idempotency response is invalid.');
      return tx.accountingPeriod.findFirstOrThrow({
        where: { id: response.accountingPeriodId, tenantId: context.tenantId },
      });
    }
    // Serialize period creation per tenant so concurrent range checks cannot overlap.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId}, 1))`;
    const overlap = await tx.accountingPeriod.findFirst({
      where: {
        tenantId: context.tenantId,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
      select: { id: true },
    });
    if (overlap) throw new Error('Accounting periods cannot overlap.');
    const period = await tx.accountingPeriod.create({
      data: { tenantId: context.tenantId, startsAt: input.startsAt, endsAt: input.endsAt },
    });
    await appendAuditEvent(tx, context, {
      action: 'accounting_period.created',
      entityType: 'AccountingPeriod',
      entityId: period.id,
      diff: { startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString() },
    });
    await recordIdempotency(
      tx,
      context,
      'accounting_period.create',
      input.idempotencyKey,
      requestHash,
      {
        accountingPeriodId: period.id,
      },
    );
    return period;
  });
}

export async function closeAccountingPeriod(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof closeAccountingPeriodInputSchema>,
) {
  const input = closeAccountingPeriodInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialFeature(tx, context);
    await requireTenantAdmin(tx, context);
    await lockTenantLedgerMutations(tx, context.tenantId);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'accounting_period.close',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { accountingPeriodId?: string } | null;
      if (!response?.accountingPeriodId) throw new Error('Stored idempotency response is invalid.');
      return tx.accountingPeriod.findFirstOrThrow({
        where: { id: response.accountingPeriodId, tenantId: context.tenantId },
      });
    }
    const period = await tx.accountingPeriod.findFirst({
      where: { id: input.accountingPeriodId, tenantId: context.tenantId },
    });
    if (!period) throw new Error('Accounting period was not found.');
    if (period.status === 'CLOSED') throw new Error('Accounting period is already closed.');
    const closedAt = new Date();
    const closed = await tx.accountingPeriod.update({
      where: { id: period.id },
      data: { status: 'CLOSED', closedBy: context.actorId, closedAt },
    });
    const lock = await tx.periodLock.create({
      data: {
        tenantId: context.tenantId,
        accountingPeriodId: period.id,
        lockedBy: context.actorId,
        reason: input.reason ?? 'Accounting period closed',
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'accounting_period.closed',
      entityType: 'AccountingPeriod',
      entityId: closed.id,
      diff: { closedAt: closedAt.toISOString(), periodLockId: lock.id },
      ...(input.reason ? { reason: input.reason } : {}),
    });
    await recordIdempotency(
      tx,
      context,
      'accounting_period.close',
      input.idempotencyKey,
      requestHash,
      {
        accountingPeriodId: closed.id,
      },
    );
    return closed;
  });
}

export async function lockAccountingPeriodAccount(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof lockAccountingPeriodAccountInputSchema>,
) {
  const input = lockAccountingPeriodAccountInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialFeature(tx, context);
    await requireTenantAdmin(tx, context);
    await lockTenantLedgerMutations(tx, context.tenantId);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'accounting_period.account_lock',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { periodLockId?: string } | null;
      if (!response?.periodLockId) throw new Error('Stored idempotency response is invalid.');
      return tx.periodLock.findFirstOrThrow({
        where: { id: response.periodLockId, tenantId: context.tenantId },
      });
    }
    const period = await tx.accountingPeriod.findFirst({
      where: { id: input.accountingPeriodId, tenantId: context.tenantId },
      select: { id: true, status: true },
    });
    if (!period) throw new Error('Accounting period was not found.');
    if (period.status === 'CLOSED')
      throw new Error('Closed accounting periods already have a global lock.');
    const account = await tx.ledgerAccount.findFirst({
      where: { id: input.ledgerAccountId, tenantId: context.tenantId, active: true },
      select: { id: true },
    });
    if (!account) throw new Error('An active tenant ledger account is required.');
    const lock = await tx.periodLock.create({
      data: {
        tenantId: context.tenantId,
        accountingPeriodId: period.id,
        ledgerAccountId: account.id,
        lockedBy: context.actorId,
        reason: input.reason ?? null,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'accounting_period.account_locked',
      entityType: 'PeriodLock',
      entityId: lock.id,
      diff: { accountingPeriodId: period.id, ledgerAccountId: account.id },
      ...(input.reason ? { reason: input.reason } : {}),
    });
    await recordIdempotency(
      tx,
      context,
      'accounting_period.account_lock',
      input.idempotencyKey,
      requestHash,
      { periodLockId: lock.id },
    );
    return lock;
  });
}

export async function issueInvoice(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof issueInvoiceInputSchema>,
) {
  const input = issueInvoiceInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialAccess(tx, context);
    const existing = await findIdempotentRecord(
      tx,
      context,
      'invoice.issue',
      input.idempotencyKey,
      requestHash,
    );
    if (existing) {
      const response = existing.response as { invoiceId?: string } | null;
      if (!response?.invoiceId) throw new Error('Stored idempotency response is invalid.');
      return tx.invoice.findFirstOrThrow({
        where: { id: response.invoiceId, tenantId: context.tenantId },
      });
    }
    const matter = await tx.matter.findFirst({
      where: { id: input.matterId, tenantId: context.tenantId, archivedAt: null },
    });
    if (!matter) throw new Error('Matter not found.');
    const entries = await tx.timeEntry.findMany({
      where: {
        id: { in: input.timeEntryIds },
        tenantId: context.tenantId,
        matterId: input.matterId,
      },
    });
    if (entries.length !== input.timeEntryIds.length)
      throw new Error('One or more time entries were not found for the matter.');
    if (new Set(input.timeEntryIds).size !== input.timeEntryIds.length)
      throw new Error('Time entries must be unique.');
    if (entries.some((entry) => !entry.approvedAt || entry.invoicedAt))
      throw new Error('Invoices require approved, uninvoiced time entries.');
    const amountCents = entries.reduce((total, entry) => {
      const numerator = entry.minutes * entry.rateCents;
      if (numerator % 60 !== 0) throw new Error('Time entry billing must resolve to whole cents.');
      if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(total + numerator / 60))
        throw new Error('Time entry billing amount exceeds supported precision.');
      return total + numerator / 60;
    }, 0);
    const invoice = await tx.invoice.create({
      data: {
        tenantId: context.tenantId,
        matterId: input.matterId,
        invoiceNumber: input.invoiceNumber,
        amountCents,
        idempotencyKey: input.idempotencyKey,
        status: 'ISSUED',
        issuedAt: new Date(),
        dueAt: input.dueAt ?? null,
        lines: {
          create: entries.map((entry) => {
            const amountCents = (entry.minutes * entry.rateCents) / 60;
            return {
              tenantId: context.tenantId,
              timeEntryId: entry.id,
              description: entry.description,
              minutes: entry.minutes,
              rateCents: entry.rateCents,
              amountCents,
            };
          }),
        },
      },
    });
    const invoiced = await tx.timeEntry.updateMany({
      where: {
        id: { in: entries.map((entry) => entry.id) },
        tenantId: context.tenantId,
        approvedAt: { not: null },
        invoicedAt: null,
      },
      data: { invoicedAt: new Date() },
    });
    if (invoiced.count !== entries.length)
      throw new Error('One or more time entries were invoiced concurrently.');
    await appendAuditEvent(tx, context, {
      action: 'invoice.issued',
      entityType: 'Invoice',
      entityId: invoice.id,
      diff: {
        matterId: input.matterId,
        invoiceNumber: invoice.invoiceNumber,
        amountCents,
        timeEntryIds: entries.map((entry) => entry.id),
      },
    });
    for (const entry of entries) {
      await appendAuditEvent(tx, context, {
        action: 'time_entry.invoiced',
        entityType: 'TimeEntry',
        entityId: entry.id,
        diff: { invoiceId: invoice.id },
      });
    }
    await recordIdempotency(tx, context, 'invoice.issue', input.idempotencyKey, requestHash, {
      invoiceId: invoice.id,
    });
    return invoice;
  });
}

async function assertAccountsUnlocked(
  tx: TenantTransaction,
  tenantId: string,
  accountIds: string[],
  occurredAt: Date,
) {
  const lock = await tx.reconciliation.findFirst({
    where: {
      tenantId,
      accountId: { in: accountIds },
      status: 'APPROVED',
      periodEnd: { gte: occurredAt },
    },
    select: { accountId: true, periodEnd: true },
  });
  if (lock)
    throw new Error(
      `Ledger posting is blocked by the approved reconciliation through ${lock.periodEnd.toISOString()}.`,
    );
}

async function assertAccountingPeriodUnlocked(
  tx: TenantTransaction,
  tenantId: string,
  accountIds: string[],
  occurredAt: Date,
) {
  const closedPeriod = await tx.accountingPeriod.findFirst({
    where: {
      tenantId,
      status: 'CLOSED',
      startsAt: { lte: occurredAt },
      endsAt: { gt: occurredAt },
    },
    select: { endsAt: true },
  });
  if (closedPeriod)
    throw new Error(
      `Ledger posting is blocked by a closed accounting period through ${closedPeriod.endsAt.toISOString()}.`,
    );
  const periodLock = await tx.periodLock.findFirst({
    where: {
      tenantId,
      accountingPeriod: { startsAt: { lte: occurredAt }, endsAt: { gt: occurredAt } },
      OR: [{ ledgerAccountId: null }, { ledgerAccountId: { in: accountIds } }],
    },
    select: { ledgerAccountId: true },
  });
  if (periodLock)
    throw new Error(
      periodLock.ledgerAccountId
        ? 'Ledger posting is blocked by an account period lock.'
        : 'Ledger posting is blocked by a global period lock.',
    );
}

async function assertNonnegativeClientTrust(
  tx: TenantTransaction,
  tenantId: string,
  lines: readonly LedgerLineInput[],
  accounts: readonly Account[],
) {
  for (const account of accounts.filter((account) => account.type === 'CLIENT_TRUST_LIABILITY')) {
    const posted = await tx.ledgerLine.aggregate({
      where: { tenantId, accountId: account.id },
      _sum: { debitCents: true, creditCents: true },
    });
    const delta = lines
      .filter((line) => line.accountId === account.id)
      .reduce((sum, line) => sum + line.creditCents - line.debitCents, 0);
    const balance = (posted._sum.creditCents ?? 0) - (posted._sum.debitCents ?? 0) + delta;
    if (balance < 0) throw new Error('Client trust ledger balance cannot become negative.');
  }
}

export async function postLedgerEntry(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof postLedgerEntryInputSchema>,
) {
  const input = postLedgerEntryInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  assertBalancedLedgerLines(input.lines);
  return withTenant(client, context, async (tx) => {
    await requireFinancialAccess(tx, context);
    await lockTenantLedgerMutations(tx, context.tenantId);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'ledger.post',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { ledgerEntryId?: string } | null;
      if (!response?.ledgerEntryId) throw new Error('Stored idempotency response is invalid.');
      return tx.ledgerEntry.findFirstOrThrow({
        where: { id: response.ledgerEntryId, tenantId: context.tenantId },
      });
    }
    const legacyEntry = await tx.ledgerEntry.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: context.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (legacyEntry)
      throw new Error('Ledger idempotency evidence is missing; a new idempotency key is required.');
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
    const accounts = await tx.ledgerAccount.findMany({
      where: { tenantId: context.tenantId, id: { in: accountIds } },
      select: { id: true, type: true, clientId: true, active: true },
    });
    if (accounts.length !== accountIds.length || accounts.some((account) => !account.active))
      throw new Error('Ledger accounts must exist and be active.');
    assertTrustSeparation(accounts);
    await assertAccountsUnlocked(tx, context.tenantId, accountIds, input.occurredAt);
    await assertAccountingPeriodUnlocked(tx, context.tenantId, accountIds, input.occurredAt);
    await assertNonnegativeClientTrust(tx, context.tenantId, input.lines, accounts);
    const entry = await tx.ledgerEntry.create({
      data: {
        tenantId: context.tenantId,
        occurredAt: input.occurredAt,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        createdBy: context.actorId,
        lines: { create: input.lines.map((line) => ({ tenantId: context.tenantId, ...line })) },
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'ledger_entry.posted',
      entityType: 'LedgerEntry',
      entityId: entry.id,
      diff: { occurredAt: input.occurredAt.toISOString(), accountIds },
    });
    await recordIdempotency(tx, context, 'ledger.post', input.idempotencyKey, requestHash, {
      ledgerEntryId: entry.id,
    });
    return entry;
  });
}

export async function reverseLedgerEntry(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof reverseLedgerEntryInputSchema>,
) {
  const input = reverseLedgerEntryInputSchema.parse(unparsedInput);
  const requestHash = hashInput({
    sourceId: input.entryId,
    occurredAt: input.occurredAt?.toISOString() ?? null,
  });
  return withTenant(client, context, async (tx) => {
    await requireFinancialAccess(tx, context);
    await lockTenantLedgerMutations(tx, context.tenantId);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'ledger.reverse',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { ledgerEntryId?: string } | null;
      if (!response?.ledgerEntryId) throw new Error('Stored idempotency response is invalid.');
      return tx.ledgerEntry.findFirstOrThrow({
        where: { id: response.ledgerEntryId, tenantId: context.tenantId },
      });
    }
    const legacyEntry = await tx.ledgerEntry.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: context.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (legacyEntry)
      throw new Error('Ledger idempotency evidence is missing; a new idempotency key is required.');
    const source = await tx.ledgerEntry.findFirstOrThrow({
      where: { id: input.entryId, tenantId: context.tenantId },
      include: { lines: true },
    });
    const priorReversal = await tx.ledgerEntry.findFirst({
      where: { tenantId: context.tenantId, reversedEntryId: source.id },
    });
    if (priorReversal) throw new Error('Ledger entry has already been reversed.');
    const lines = source.lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
    }));
    assertBalancedLedgerLines(lines);
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await tx.ledgerAccount.findMany({
      where: { tenantId: context.tenantId, id: { in: accountIds } },
      select: { id: true, type: true, clientId: true, active: true },
    });
    if (accounts.length !== accountIds.length || accounts.some((account) => !account.active))
      throw new Error('Ledger accounts must exist and be active.');
    assertTrustSeparation(accounts);
    const reversalOccurredAt = input.occurredAt ?? new Date();
    await assertAccountsUnlocked(tx, context.tenantId, accountIds, reversalOccurredAt);
    await assertAccountingPeriodUnlocked(tx, context.tenantId, accountIds, reversalOccurredAt);
    await assertNonnegativeClientTrust(tx, context.tenantId, lines, accounts);
    const reversal = await tx.ledgerEntry.create({
      data: {
        tenantId: context.tenantId,
        occurredAt: reversalOccurredAt,
        description: `Reversal of ${source.id}: ${source.description}`,
        idempotencyKey: input.idempotencyKey,
        reversedEntryId: source.id,
        createdBy: context.actorId,
        lines: { create: lines.map((line) => ({ tenantId: context.tenantId, ...line })) },
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'ledger_entry.reversed',
      entityType: 'LedgerEntry',
      entityId: reversal.id,
      diff: { reversedEntryId: source.id, accountIds },
    });
    await recordIdempotency(tx, context, 'ledger.reverse', input.idempotencyKey, requestHash, {
      ledgerEntryId: reversal.id,
    });
    return reversal;
  });
}

export async function recordVerifiedLawPayPayment(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof recordVerifiedLawPayPaymentInputSchema>,
) {
  const input = recordVerifiedLawPayPaymentInputSchema.parse(unparsedInput);
  if (context.actorType !== 'INTEGRATION')
    throw new Error('Verified LawPay payments require an integration actor.');
  const requestHash = hashInput(input);
  return withTenant(client, context, async (tx) => {
    await requireFinancialFeature(tx, context);
    const replay = await findIdempotentRecord(
      tx,
      context,
      'payment.lawpay.record',
      input.idempotencyKey,
      requestHash,
    );
    if (replay) {
      const response = replay.response as { paymentId?: string } | null;
      if (!response?.paymentId) throw new Error('Stored idempotency response is invalid.');
      return tx.payment.findFirstOrThrow({
        where: { id: response.paymentId, tenantId: context.tenantId },
      });
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.invoiceId}, 0))`;
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, tenantId: context.tenantId },
    });
    if (!invoice || invoice.status === 'VOID') throw new Error('Invoice is not payable.');
    if (input.amountCents > invoice.amountCents - invoice.paidCents)
      throw new Error('Verified payment would overpay the invoice.');
    const payment = await tx.payment.create({
      data: {
        tenantId: context.tenantId,
        invoiceId: invoice.id,
        lawPayPaymentId: input.lawPayPaymentId,
        lawPayTransactionId: input.lawPayTransactionId ?? null,
        providerEventId: input.providerEventId ?? null,
        idempotencyKey: input.idempotencyKey,
        amountCents: input.amountCents,
        status: 'SUCCEEDED',
        verifiedAt: input.verifiedAt,
      },
    });
    const paidCents = invoice.paidCents + input.amountCents;
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: { paidCents, status: paidCents === invoice.amountCents ? 'PAID' : 'PARTIALLY_PAID' },
    });
    await appendAuditEvent(tx, context, {
      action: 'payment.lawpay_verified',
      entityType: 'Payment',
      entityId: payment.id,
      diff: {
        invoiceId: invoice.id,
        amountCents: payment.amountCents,
        lawPayPaymentId: payment.lawPayPaymentId,
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'invoice.payment_applied',
      entityType: 'Invoice',
      entityId: updatedInvoice.id,
      diff: { paymentId: payment.id, paidCents, status: updatedInvoice.status },
    });
    await recordIdempotency(
      tx,
      context,
      'payment.lawpay.record',
      input.idempotencyKey,
      requestHash,
      {
        paymentId: payment.id,
      },
    );
    return payment;
  });
}

export async function reconcileTrustAccount(
  client: PrismaClient,
  context: TenantContext,
  unparsedInput: z.infer<typeof reconcileTrustAccountInputSchema>,
) {
  const input = reconcileTrustAccountInputSchema.parse(unparsedInput);
  const requestHash = hashInput(input);
  assertThreeWayReconciliation(
    input.bankBalanceCents,
    input.bookBalanceCents,
    input.clientBalanceCents,
  );
  return withTenant(client, context, async (tx) => {
    await requireFinancialAccess(tx, context);
    await lockTenantLedgerMutations(tx, context.tenantId);
    const existing = await findIdempotentRecord(
      tx,
      context,
      'trust.reconcile',
      input.idempotencyKey,
      requestHash,
    );
    if (existing)
      return tx.reconciliation.findFirstOrThrow({
        where: {
          tenantId: context.tenantId,
          accountId: input.accountId,
          periodEnd: input.periodEnd,
        },
      });
    const account = await tx.ledgerAccount.findFirst({
      where: { id: input.accountId, tenantId: context.tenantId, type: 'TRUST_BANK', active: true },
    });
    if (!account) throw new Error('An active trust bank account is required for reconciliation.');
    const lines = await tx.ledgerLine.findMany({
      where: {
        tenantId: context.tenantId,
        accountId: account.id,
        entry: { occurredAt: { lte: input.periodEnd } },
      },
      select: { debitCents: true, creditCents: true },
    });
    const calculatedBook = lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
    const clientLines = await tx.ledgerLine.findMany({
      where: {
        tenantId: context.tenantId,
        account: { type: 'CLIENT_TRUST_LIABILITY' },
        entry: { occurredAt: { lte: input.periodEnd } },
      },
      select: { debitCents: true, creditCents: true },
    });
    const calculatedClients = clientLines.reduce(
      (sum, line) => sum + line.creditCents - line.debitCents,
      0,
    );
    assertThreeWayReconciliation(input.bankBalanceCents, calculatedBook, calculatedClients);
    const reconciliation = await tx.reconciliation.create({
      data: {
        tenantId: context.tenantId,
        accountId: account.id,
        periodEnd: input.periodEnd,
        bankBalanceCents: input.bankBalanceCents,
        bookBalanceCents: calculatedBook,
        clientBalanceCents: calculatedClients,
        status: 'APPROVED',
        approvedBy: context.actorId,
        approvedAt: new Date(),
      },
    });
    await appendAuditEvent(tx, context, {
      action: 'trust.reconciled',
      entityType: 'Reconciliation',
      entityId: reconciliation.id,
      diff: {
        accountId: account.id,
        periodEnd: input.periodEnd.toISOString(),
        balanceCents: calculatedBook,
      },
    });
    await recordIdempotency(tx, context, 'trust.reconcile', input.idempotencyKey, requestHash, {
      reconciliationId: reconciliation.id,
    });
    return reconciliation;
  });
}
