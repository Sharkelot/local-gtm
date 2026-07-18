import { describe, expect, it } from 'vitest';
import { assertNoMailboxWideIngestion } from '../src/services/communication-service.js';

describe('communication link guard', () => {
  it('requires provider identifiers and one explicit CRM link', () => {
    const base = {
      connectionId: '00000000-0000-4000-8000-000000000009',
      provider: 'MICROSOFT' as const,
      itemType: 'MESSAGE' as const,
      providerItemId: 'm-1',
    };
    expect(() => assertNoMailboxWideIngestion(base)).toThrow();
    expect(
      assertNoMailboxWideIngestion({
        ...base,
        matterId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toBeTruthy();
  });
});
