import { describe, expect, it } from 'vitest';
import { createNoteInputSchema } from '../src/services/note-service.js';

describe('note service input', () => {
  it('accepts a bounded note tied to a deal', () => {
    expect(
      createNoteInputSchema.parse({
        dealId: '00000000-0000-4000-8000-000000000001',
        body: 'The firm requires SSO.',
      }),
    ).toBeTruthy();
  });

  it('rejects blank and unbounded content', () => {
    expect(() =>
      createNoteInputSchema.parse({
        dealId: '00000000-0000-4000-8000-000000000001',
        body: '   ',
      }),
    ).toThrow();
    expect(() =>
      createNoteInputSchema.parse({
        dealId: '00000000-0000-4000-8000-000000000001',
        body: 'x'.repeat(50_001),
      }),
    ).toThrow();
  });
});
