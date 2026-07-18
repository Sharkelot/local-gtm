import { describe, expect, it } from 'vitest';
import {
  assertClientPortalMembership,
  clientPortalDocumentInputSchema,
  grantClientDocumentShareInputSchema,
  grantClientMatterShareInputSchema,
  listClientPortalMattersInputSchema,
} from '../src/services/client-portal-service.js';

describe('client portal boundaries', () => {
  it('requires an active CLIENT membership', () => {
    expect(() => assertClientPortalMembership({ role: 'CLIENT', active: true })).not.toThrow();
    expect(() => assertClientPortalMembership({ role: 'ATTORNEY', active: true })).toThrow(
      /client membership/i,
    );
    expect(() => assertClientPortalMembership({ role: 'CLIENT', active: false })).toThrow(
      /client membership/i,
    );
  });
  it('accepts only a bounded document identifier and no list filters', () => {
    expect(
      clientPortalDocumentInputSchema.parse({ documentId: '00000000-0000-4000-8000-000000000001' }),
    ).toBeTruthy();
    expect(() => clientPortalDocumentInputSchema.parse({ documentId: 'bad' })).toThrow();
    expect(() => listClientPortalMattersInputSchema.parse({ tenantId: 'forbidden' })).toThrow();
  });
  it('requires bounded idempotent explicit grant targets', () => {
    const base = {
      clientMembershipId: '00000000-0000-4000-8000-000000000002',
      idempotencyKey: 'share-grant-1234',
    };
    expect(
      grantClientMatterShareInputSchema.parse({
        ...base,
        matterId: '00000000-0000-4000-8000-000000000003',
      }),
    ).toBeTruthy();
    expect(
      grantClientDocumentShareInputSchema.parse({
        ...base,
        documentId: '00000000-0000-4000-8000-000000000004',
      }),
    ).toBeTruthy();
    expect(() => grantClientMatterShareInputSchema.parse({ ...base, matterId: 'bad' })).toThrow();
  });
});
