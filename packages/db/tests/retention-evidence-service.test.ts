import { describe, expect, it } from 'vitest';
import {
  assertDocumentPurgeEligible,
  registerEvidenceInputSchema,
  upsertRetentionPolicyInputSchema,
} from '../src/services/retention-evidence-service.js';

describe('retention and evidence contracts', () => {
  it('accepts bounded retention policies and rejects unknown fields', () => {
    expect(
      upsertRetentionPolicyInputSchema.parse({ recordType: 'DOCUMENT', retentionDays: 365 }),
    ).toBeTruthy();
    expect(() =>
      upsertRetentionPolicyInputSchema.parse({ recordType: 'DOCUMENT', retentionDays: 0 }),
    ).toThrow();
  });

  it('requires matching evidence object references and a digest', () => {
    const base = {
      recordType: 'DOCUMENT' as const,
      recordId: '00000000-0000-4000-8000-000000000001',
      evidenceType: 'MALWARE_SCAN',
      sha256: 'a'.repeat(64),
    };
    expect(
      registerEvidenceInputSchema.parse({ ...base, objectKey: 'evidence/a', objectVersion: 'v1' }),
    ).toBeTruthy();
    expect(() => registerEvidenceInputSchema.parse({ ...base, objectKey: 'evidence/a' })).toThrow();
  });

  it('requires confirmation, no holds, and elapsed retention before a purge can proceed', () => {
    const base = {
      documentCreatedAt: '2020-01-01T00:00:00.000Z',
      documentRetentionAt: null,
      documentLegalHold: false,
      policyRetentionDays: 30,
      policyLegalHold: false,
      secondConfirmation: true as const,
      now: '2021-01-01T00:00:00.000Z',
    };
    expect(() => assertDocumentPurgeEligible(base)).not.toThrow();
    expect(() => assertDocumentPurgeEligible({ ...base, documentLegalHold: true })).toThrow(
      /legal hold/i,
    );
    expect(() => assertDocumentPurgeEligible({ ...base, now: '2020-01-02T00:00:00.000Z' })).toThrow(
      /not elapsed/i,
    );
    expect(() =>
      assertDocumentPurgeEligible({
        ...base,
        documentRetentionAt: '2020-02-01T00:00:00.000Z',
        policyRetentionDays: 365,
        now: '2020-03-01T00:00:00.000Z',
      }),
    ).toThrow(/not elapsed/i);
  });
});
