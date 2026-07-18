import { describe, expect, it } from 'vitest';
import { importProspectsInputSchema } from '../src/services/import-service.js';

describe('prospect import validation', () => {
  it('rejects unbounded or malformed imports before database work', () => {
    expect(() =>
      importProspectsInputSchema.parse({
        filename: 'prospects.csv',
        idempotencyKey: 'import-1234',
        rows: [],
      }),
    ).toThrow();
    expect(() =>
      importProspectsInputSchema.parse({
        filename: 'prospects.csv',
        idempotencyKey: 'import-1234',
        rows: [{ organization: 'Firm', firstName: 'A', lastName: 'B', email: 'not-email' }],
      }),
    ).toThrow();
  });
});
