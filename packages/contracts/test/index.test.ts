import { describe, expect, it } from 'vitest';
import {
  aiExtractionJsonSchema,
  aiExtractionResultSchema,
  idempotencyKeySchema,
  searchPlanSchema,
} from '../src/index.js';

describe('contracts', () => {
  it('accepts an evidence-backed AI extraction', () =>
    expect(
      aiExtractionResultSchema.parse({
        schemaVersion: '1',
        suggestions: [
          {
            suggestionId: '00000000-0000-4000-8000-000000000001',
            sourceNoteId: '00000000-0000-4000-8000-000000000002',
            sourceNoteVersion: 1,
            evidence: { start: 0, end: 4, quote: 'SSO?' },
            confidence: 0.9,
            promptVersion: 'v1',
            modelId: 'qwen',
            schemaVersion: '1',
            type: 'SECURITY_CONCERN',
            target: 'organization.securityConcerns',
            value: 'Requires SSO',
          },
        ],
      }),
    ).toBeTruthy());
  it('blocks SQL-shaped search and limits results', () => {
    expect(() =>
      searchPlanSchema.parse({ entityTypes: ['organization'], terms: ['select * from contacts'] }),
    ).toThrow();
    expect(() => searchPlanSchema.parse({ entityTypes: ['organization'], limit: 101 })).toThrow();
  });
  it('validates idempotency keys', () => {
    expect(idempotencyKeySchema.parse('import-1234')).toBe('import-1234');
    expect(() => idempotencyKeySchema.parse('bad key')).toThrow();
  });
  it('publishes a structured-output schema with string version literals', () => {
    expect(aiExtractionJsonSchema.properties.schemaVersion).toEqual({
      type: 'string',
      enum: ['1'],
    });
    expect(aiExtractionJsonSchema.properties.suggestions.items.properties.type.enum).toHaveLength(
      5,
    );
  });
});
