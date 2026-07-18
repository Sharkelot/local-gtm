import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  getClientPortalDocumentMetadata,
  grantClientDocumentShare,
  grantClientMatterShare,
  listClientPortalMatters,
  recordDocumentScanResult,
  revokeClientDocumentShare,
  revokeClientMatterShare,
  uploadDocumentMetadata,
  type TenantContext,
} from '../src/index.js';

const integrationEnabled = Boolean(process.env.TEST_DATABASE_URL);
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/invalid';
const suite = describe.skipIf(!integrationEnabled);

suite('explicit-share client portal boundary', () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('requires tenant-scoped matter and clean-document shares and audits their lifecycle', async () => {
    const suffix = randomUUID();
    const [tenant, otherTenant] = await Promise.all([
      client.tenant.create({
        data: { name: `Portal tenant ${suffix}`, slug: `portal-${suffix}` },
      }),
      client.tenant.create({
        data: { name: `Other portal tenant ${suffix}`, slug: `portal-other-${suffix}` },
      }),
    ]);
    const [adminIdentity, portalIdentity] = await Promise.all([
      client.identity.create({
        data: {
          issuer: 'portal-integration',
          subject: `admin-${suffix}`,
          email: `portal-admin-${suffix}@example.test`,
          displayName: 'Portal Admin',
        },
      }),
      client.identity.create({
        data: {
          issuer: 'portal-integration',
          subject: `client-${suffix}`,
          email: `portal-client-${suffix}@example.test`,
          displayName: 'Portal Client',
        },
      }),
    ]);
    const [adminMembership, portalMembership] = await Promise.all([
      client.membership.create({
        data: { tenantId: tenant.id, identityId: adminIdentity.id, role: 'TENANT_ADMIN' },
      }),
      client.membership.create({
        data: { tenantId: tenant.id, identityId: portalIdentity.id, role: 'CLIENT' },
      }),
    ]);
    expect(adminMembership.role).toBe('TENANT_ADMIN');
    const organization = await client.organization.create({
      data: {
        tenantId: tenant.id,
        name: `Shared client ${suffix}`,
        normalizedName: `sharedclient${suffix.replaceAll('-', '')}`,
      },
    });
    const matter = await client.matter.create({
      data: {
        tenantId: tenant.id,
        organizationId: organization.id,
        matterNumber: `PORTAL-${suffix}`,
        name: 'Explicitly shared matter',
        status: 'ACTIVE',
      },
    });
    const adminContext: TenantContext = {
      tenantId: tenant.id,
      actorId: adminIdentity.id,
      actorType: 'USER',
      correlationId: randomUUID(),
    };
    const document = await uploadDocumentMetadata(client, adminContext, {
      matterId: matter.id,
      name: 'Shared clean document.pdf',
      objectKey: `${tenant.id}/${randomUUID()}`,
      objectVersion: 'portal-integration-version',
      encryptedDataKey: 'integration-encrypted-key',
      contentType: 'application/pdf',
      sizeBytes: 100n,
      sha256: 'a'.repeat(64),
      legalHold: false,
    });
    await recordDocumentScanResult(
      client,
      {
        tenantId: tenant.id,
        actorId: 'portal-integration-scanner',
        actorType: 'SYSTEM',
        correlationId: randomUUID(),
      },
      { documentId: document.id, result: 'CLEAN' },
    );
    const otherMatter = await client.matter.create({
      data: {
        tenantId: otherTenant.id,
        matterNumber: `OTHER-${suffix}`,
        name: 'Cross-tenant matter',
        status: 'ACTIVE',
      },
    });
    const otherDocument = await client.document.create({
      data: {
        tenantId: otherTenant.id,
        matterId: otherMatter.id,
        name: 'Cross-tenant document',
        createdBy: 'integration',
      },
    });

    await expect(
      grantClientDocumentShare(client, adminContext, {
        clientMembershipId: portalMembership.id,
        documentId: document.id,
        idempotencyKey: `document-before-matter-${suffix}`,
      }),
    ).rejects.toThrow(/matter share is required/i);
    await expect(
      grantClientDocumentShare(client, adminContext, {
        clientMembershipId: portalMembership.id,
        documentId: otherDocument.id,
        idempotencyKey: `cross-tenant-document-${suffix}`,
      }),
    ).rejects.toThrow(/not found/i);

    await grantClientMatterShare(client, adminContext, {
      clientMembershipId: portalMembership.id,
      matterId: matter.id,
      idempotencyKey: `matter-grant-${suffix}`,
    });
    await grantClientDocumentShare(client, adminContext, {
      clientMembershipId: portalMembership.id,
      documentId: document.id,
      idempotencyKey: `document-grant-${suffix}`,
    });
    const portalContext: TenantContext = {
      tenantId: tenant.id,
      actorId: portalIdentity.id,
      actorType: 'USER',
      correlationId: randomUUID(),
    };
    const matters = await listClientPortalMatters(client, portalContext);
    expect(matters).toHaveLength(1);
    expect(matters[0]?.documents.map((item) => item.id)).toEqual([document.id]);
    await expect(
      getClientPortalDocumentMetadata(client, portalContext, { documentId: document.id }),
    ).resolves.toMatchObject({ documentId: document.id, contentType: 'application/pdf' });

    await expect(
      revokeClientMatterShare(client, adminContext, {
        clientMembershipId: portalMembership.id,
        matterId: matter.id,
        idempotencyKey: `premature-matter-revoke-${suffix}`,
      }),
    ).rejects.toThrow(/revoke shared documents/i);
    await revokeClientDocumentShare(client, adminContext, {
      clientMembershipId: portalMembership.id,
      documentId: document.id,
      idempotencyKey: `document-revoke-${suffix}`,
    });
    await revokeClientMatterShare(client, adminContext, {
      clientMembershipId: portalMembership.id,
      matterId: matter.id,
      idempotencyKey: `matter-revoke-${suffix}`,
    });
    await expect(listClientPortalMatters(client, portalContext)).resolves.toEqual([]);
    expect(
      await client.auditEvent.count({
        where: {
          tenantId: tenant.id,
          action: {
            in: [
              'client_matter_share.granted',
              'client_document_share.granted',
              'client_document_share.revoked',
              'client_matter_share.revoked',
            ],
          },
        },
      }),
    ).toBe(4);
  });
});
