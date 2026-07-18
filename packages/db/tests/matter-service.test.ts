import { describe, expect, it } from 'vitest';
import {
  createMatterInputSchema,
  updateMatterInputSchema,
} from '../src/services/matter-service.js';

describe('matter service inputs', () => {
  it('accepts bounded legal matter metadata', () => {
    expect(
      createMatterInputSchema.parse({
        matterNumber: '2026-001',
        name: 'Acme dispute',
        status: 'OPEN',
      }),
    ).toBeTruthy();
  });

  it('requires an actual update field', () => {
    expect(() =>
      updateMatterInputSchema.parse({ matterId: '00000000-0000-4000-8000-000000000001' }),
    ).toThrow();
  });
});
