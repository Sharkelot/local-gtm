import { describe, expect, it } from 'vitest';
import {
  approveTimeEntryInputSchema,
  assertBalancedLedgerLines,
  assertThreeWayReconciliation,
  closeAccountingPeriodInputSchema,
  createAccountingPeriodInputSchema,
  createLedgerAccountInputSchema,
  createTimeEntryInputSchema,
  issueInvoiceInputSchema,
  lockAccountingPeriodAccountInputSchema,
  postLedgerEntryInputSchema,
  reconcileTrustAccountInputSchema,
  recordVerifiedLawPayPaymentInputSchema,
  reverseLedgerEntryInputSchema,
} from '../src/services/finance-service.js';

const accountA = '00000000-0000-4000-8000-000000000001';
const accountB = '00000000-0000-4000-8000-000000000002';

describe('finance service validation', () => {
  it('requires bounded idempotency keys for approved financial mutations', () => {
    expect(() =>
      approveTimeEntryInputSchema.parse({ timeEntryId: accountA, idempotencyKey: 'short' }),
    ).toThrow();
    expect(() =>
      issueInvoiceInputSchema.parse({
        matterId: accountA,
        invoiceNumber: 'INV-1',
        timeEntryIds: [accountB],
        idempotencyKey: 'invoice-1234',
      }),
    ).not.toThrow();
  });

  it('accepts only balanced, one-sided double-entry lines', () => {
    const lines = [
      { accountId: accountA, debitCents: 500, creditCents: 0 },
      { accountId: accountB, debitCents: 0, creditCents: 500 },
    ];
    expect(() => assertBalancedLedgerLines(lines)).not.toThrow();
    expect(() =>
      assertBalancedLedgerLines([
        { accountId: accountA, debitCents: 500, creditCents: 100 },
        { accountId: accountB, debitCents: 0, creditCents: 400 },
      ]),
    ).toThrow(/exactly one positive side/i);
    expect(() =>
      assertBalancedLedgerLines([
        lines[0]!,
        { accountId: accountB, debitCents: 0, creditCents: 499 },
      ]),
    ).toThrow(/debits must equal credits/i);
  });

  it('rejects ledger postings without two lines before database work', () => {
    expect(() =>
      postLedgerEntryInputSchema.parse({
        occurredAt: '2026-07-01T00:00:00.000Z',
        description: 'One-sided posting',
        idempotencyKey: 'ledger-1234',
        lines: [{ accountId: accountA, debitCents: 1, creditCents: 0 }],
      }),
    ).toThrow();
  });

  it('requires three-way reconciliation equality', () => {
    expect(() => assertThreeWayReconciliation(100, 100, 100)).not.toThrow();
    expect(() => assertThreeWayReconciliation(100, 100, 99)).toThrow(
      /matching bank, book, and client/i,
    );
    expect(() =>
      reconcileTrustAccountInputSchema.parse({
        accountId: accountA,
        periodEnd: '2026-06-30T23:59:59.999Z',
        bankBalanceCents: -1,
        bookBalanceCents: 0,
        clientBalanceCents: 0,
        idempotencyKey: 'reconcile-1234',
      }),
    ).toThrow();
  });

  it('strictly validates reversal requests before ledger access', () => {
    expect(() =>
      reverseLedgerEntryInputSchema.parse({
        entryId: accountA,
        idempotencyKey: 'reverse-1234',
        unknown: true,
      }),
    ).toThrow();
    expect(() =>
      reverseLedgerEntryInputSchema.parse({ entryId: accountA, idempotencyKey: 'reverse-1234' }),
    ).not.toThrow();
  });

  it('accepts only minimal, already-verified LawPay success evidence', () => {
    const verified = {
      invoiceId: accountA,
      lawPayPaymentId: 'lawpay-payment-123',
      providerEventId: 'lawpay-event-123',
      amountCents: 500,
      verifiedAt: '2026-07-17T00:00:00.000Z',
      idempotencyKey: 'lawpay-payment-1234',
    };
    expect(() => recordVerifiedLawPayPaymentInputSchema.parse(verified)).not.toThrow();
    expect(() =>
      recordVerifiedLawPayPaymentInputSchema.parse({ ...verified, status: 'SUCCEEDED' }),
    ).toThrow();
    expect(() =>
      recordVerifiedLawPayPaymentInputSchema.parse({ ...verified, amountCents: 0 }),
    ).toThrow();
  });

  it('strictly validates bounded time entry creation without a request user id', () => {
    const input = {
      matterId: accountA,
      minutes: 60,
      rateCents: 25_000,
      description: 'Matter work',
      occurredOn: '2026-07-17T00:00:00.000Z',
      idempotencyKey: 'time-entry-1234',
    };
    expect(() => createTimeEntryInputSchema.parse(input)).not.toThrow();
    expect(() => createTimeEntryInputSchema.parse({ ...input, userId: accountB })).toThrow();
    expect(() => createTimeEntryInputSchema.parse({ ...input, minutes: 1_441 })).toThrow();
  });

  it('enforces trust ledger account client shape at the input boundary', () => {
    const base = { name: 'Client trust', idempotencyKey: 'account-create-1234' };
    expect(() =>
      createLedgerAccountInputSchema.parse({
        ...base,
        type: 'CLIENT_TRUST_LIABILITY',
        clientId: accountA,
      }),
    ).not.toThrow();
    expect(() => createLedgerAccountInputSchema.parse({ ...base, type: 'NOT_REAL' })).toThrow();
  });

  it('strictly validates accounting period lifecycle requests', () => {
    const period = {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.999Z',
      idempotencyKey: 'period-create-1234',
    };
    expect(() => createAccountingPeriodInputSchema.parse(period)).not.toThrow();
    expect(() =>
      closeAccountingPeriodInputSchema.parse({
        accountingPeriodId: accountA,
        idempotencyKey: 'period-close-1234',
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      lockAccountingPeriodAccountInputSchema.parse({
        accountingPeriodId: accountA,
        ledgerAccountId: accountB,
        idempotencyKey: 'period-lock-1234',
      }),
    ).not.toThrow();
  });
});
