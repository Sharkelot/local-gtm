import { describe, expect, it } from 'vitest';
import {
  assertAiJobTransition,
  createReversal,
  normalizeSearchIntent,
  scoreContactDuplicate,
  validateLedgerEntry,
} from '../src/index.js';

describe('duplicate scoring', () => {
  it('flags exact email but never automatically merges', () =>
    expect(
      scoreContactDuplicate(
        { id: 'a', firstName: 'A', lastName: 'One', email: 'a@example.test' },
        { id: 'b', firstName: 'Other', lastName: 'Name', email: 'A@example.test' },
      ),
    ).toMatchObject({ score: 1, isCandidate: true }));
  it('requires both similar name and organization for fuzzy candidate', () =>
    expect(
      scoreContactDuplicate(
        { id: 'a', firstName: 'Sam', lastName: 'Lee', organizationName: 'Harbor Law' },
        { id: 'b', firstName: 'Sam', lastName: 'Lee', organizationName: 'Harbor Law' },
      ).isCandidate,
    ).toBe(true));
});
describe('AI queue and search', () => {
  it('prevents terminal job transitions', () =>
    expect(() => assertAiJobTransition('COMPLETED', 'QUEUED')).toThrow());
  it('maps security questions to safe deterministic insight search', () =>
    expect(normalizeSearchIntent('Which firms have security concerns?')).toMatchObject({
      entityTypes: ['organization', 'deal'],
      insightCategories: ['SECURITY_CONCERN'],
      terms: [],
    }));
});
describe('trust ledger invariants', () => {
  const entry = {
    id: 'e1',
    tenantId: 't1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    memo: 'Deposit',
    lines: [
      { accountId: 'cash', debitCents: 100, creditCents: 0 },
      { accountId: 'trust', debitCents: 0, creditCents: 100 },
    ],
  };
  it('requires balanced double-entry lines', () => {
    validateLedgerEntry(entry);
    expect(() =>
      validateLedgerEntry({
        ...entry,
        lines: [entry.lines[0]!, { accountId: 'trust', debitCents: 0, creditCents: 99 }],
      }),
    ).toThrow();
  });
  it('creates balanced linked reversals', () => {
    const reversal = createReversal(entry, 'e2', '2026-01-02T00:00:00.000Z');
    validateLedgerEntry(reversal);
    expect(reversal.reversalOfId).toBe('e1');
    expect(reversal.lines).toEqual([
      { accountId: 'cash', debitCents: 0, creditCents: 100 },
      { accountId: 'trust', debitCents: 100, creditCents: 0 },
    ]);
  });
});
