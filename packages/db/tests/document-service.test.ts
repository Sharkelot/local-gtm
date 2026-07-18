import { describe, expect, it } from 'vitest';
import {
  assertDocumentBytesAccessible,
  assertDocumentDestructionAllowed,
  assertDocumentScanTransition,
  documentScanResultInputSchema,
} from '../src/services/document-service.js';

describe('document service state guards', () => {
  it('only releases quarantined documents after a clean scan', () => {
    expect(assertDocumentScanTransition('QUARANTINED', 'CLEAN')).toBe('CLEAN');
    expect(() => assertDocumentBytesAccessible('QUARANTINED')).toThrow();
    expect(() => assertDocumentScanTransition('CLEAN', 'REJECTED')).toThrow();
  });

  it('requires a reason for rejection and protects held documents', () => {
    expect(() =>
      documentScanResultInputSchema.parse({
        documentId: '00000000-0000-4000-8000-000000000001',
        result: 'REJECTED',
      }),
    ).toThrow();
    expect(() =>
      assertDocumentDestructionAllowed({ legalHold: true, retentionAt: null }),
    ).toThrow();
  });
});
