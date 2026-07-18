import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  eveContacts,
  eveIds,
  eveTenant,
  expectedAiExtraction,
  harborPointDeal,
  harborPointOrganization,
  discoveryNoteText,
} from '@local-gtm/fixtures';
import { scoreContactDuplicate } from '@local-gtm/domain';
import { appendAuditEvent } from '../src/audit.js';

const db = new PrismaClient();
const adminIdentityId = '10000000-0000-4000-8000-000000000090';
const aiJobId = '10000000-0000-4000-8000-000000000030';
const orgIds: Record<string, string> = {
  'Harbor Point Injury Law': eveIds.organization,
  'Lakefront Legal Group': '10000000-0000-4000-8000-000000000005',
  'Northstar Family Law': '10000000-0000-4000-8000-000000000006',
  'Cedar Hill Counsel': '10000000-0000-4000-8000-000000000007',
};
const normalize = (value: string | null | undefined) =>
  value?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';

await db.tenant.upsert({
  where: { id: eveIds.tenant },
  create: { id: eveIds.tenant, name: eveTenant.name, slug: 'eve-legal-services' },
  update: { name: eveTenant.name },
});
await db.identity.upsert({
  where: { id: adminIdentityId },
  create: {
    id: adminIdentityId,
    issuer: 'demo',
    subject: 'eve-admin',
    email: 'eve.admin@example.test',
    displayName: 'Eve Administrator',
  },
  update: { email: 'eve.admin@example.test', displayName: 'Eve Administrator' },
});
await db.membership.upsert({
  where: { tenantId_identityId: { tenantId: eveIds.tenant, identityId: adminIdentityId } },
  create: { tenantId: eveIds.tenant, identityId: adminIdentityId, role: 'TENANT_ADMIN' },
  update: { active: true, role: 'TENANT_ADMIN' },
});

// The demo fixture is intentionally rerunnable; approval keys must not replay a prior run.
await db.idempotencyRecord.deleteMany({ where: { tenantId: eveIds.tenant } });

for (const [name, id] of Object.entries(orgIds)) {
  await db.organization.upsert({
    where: { id },
    create: {
      id,
      tenantId: eveIds.tenant,
      name,
      normalizedName: normalize(name),
      industry:
        name === harborPointOrganization.name ? harborPointOrganization.industry : 'Law firm',
    },
    update: {
      name,
      normalizedName: normalize(name),
      securityConcern: false,
      securityConcerns: [],
      integrationRequirements: [],
    },
  });
}
for (const contact of eveContacts) {
  const organizationId = orgIds[contact.organizationName ?? ''];
  if (!organizationId)
    throw new Error(`Missing organization fixture for ${contact.organizationName ?? 'unknown'}.`);
  await db.contact.upsert({
    where: { id: contact.id },
    create: {
      id: contact.id,
      tenantId: eveIds.tenant,
      organizationId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email ?? null,
      normalizedEmail: normalize(contact.email),
      phone: contact.phone ?? null,
      normalizedPhone: normalize(contact.phone),
      title: contact.id === eveIds.contacts[0] ? 'Managing Partner' : 'Attorney',
    },
    update: {
      organizationId,
      email: contact.email ?? null,
      normalizedEmail: normalize(contact.email),
      phone: contact.phone ?? null,
      normalizedPhone: normalize(contact.phone),
      isDecisionMaker: false,
    },
  });
}

await db.deal.upsert({
  where: { id: eveIds.deal },
  create: {
    id: eveIds.deal,
    tenantId: eveIds.tenant,
    organizationId: eveIds.organization,
    name: harborPointDeal.name,
    stage: 'DISCOVERY',
    valueCents: 120_000_00,
  },
  update: {
    stage: 'DISCOVERY',
    valueCents: 120_000_00,
    followUpAt: null,
  },
});
await db.note.upsert({
  where: { id: eveIds.discoveryNote },
  create: {
    id: eveIds.discoveryNote,
    tenantId: eveIds.tenant,
    dealId: eveIds.deal,
    body: discoveryNoteText,
    createdBy: adminIdentityId,
  },
  update: { body: discoveryNoteText },
});
await db.aiJob.upsert({
  where: { id: aiJobId },
  create: {
    id: aiJobId,
    tenantId: eveIds.tenant,
    noteId: eveIds.discoveryNote,
    status: 'COMPLETED',
    modelId: 'qwen-demo-fixture',
    promptVersion: 'eve-demo-v1',
    completedAt: new Date(),
  },
  update: { status: 'COMPLETED', completedAt: new Date() },
});
for (const suggestion of expectedAiExtraction.suggestions) {
  await db.aiSuggestion.upsert({
    where: { id: suggestion.suggestionId },
    create: {
      id: suggestion.suggestionId,
      tenantId: eveIds.tenant,
      aiJobId,
      kind: suggestion.type,
      evidenceText: suggestion.evidence.quote,
      confidence: suggestion.confidence,
      targetEntityType: suggestion.target.split('.')[0] ?? 'unknown',
      targetEntityId:
        suggestion.type === 'FOLLOW_UP_DATE' || suggestion.type === 'DECISION_MAKER'
          ? eveIds.deal
          : eveIds.organization,
      targetField: suggestion.target.split('.')[1] ?? 'unknown',
      proposedValue: suggestion.value,
      sourceVersion: 1,
    },
    update: {
      evidenceText: suggestion.evidence.quote,
      confidence: suggestion.confidence,
      proposedValue: suggestion.value,
      status: 'PENDING',
      decidedAt: null,
      decidedBy: null,
    },
  });
}

const candidatePairs: Array<{
  left: (typeof eveContacts)[number];
  right: (typeof eveContacts)[number];
  score: number;
  reasons: readonly string[];
}> = [];
for (let leftIndex = 0; leftIndex < eveContacts.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < eveContacts.length; rightIndex += 1) {
    const left = eveContacts[leftIndex]!;
    const right = eveContacts[rightIndex]!;
    const result = scoreContactDuplicate(left, right);
    if (result.isCandidate)
      candidatePairs.push({ left, right, score: result.score, reasons: result.reasons });
  }
}
if (candidatePairs.length !== 2)
  throw new Error(`Expected two demo duplicate pairs, received ${candidatePairs.length}.`);
for (const candidate of candidatePairs) {
  await db.duplicateCandidate.upsert({
    where: {
      tenantId_leftContactId_rightContactId: {
        tenantId: eveIds.tenant,
        leftContactId: candidate.left.id,
        rightContactId: candidate.right.id,
      },
    },
    create: {
      tenantId: eveIds.tenant,
      organizationId: orgIds[candidate.left.organizationName ?? ''] ?? null,
      leftContactId: candidate.left.id,
      rightContactId: candidate.right.id,
      score: candidate.score,
      reasons: [...candidate.reasons],
    },
    update: { score: candidate.score, reasons: [...candidate.reasons] },
  });
}
const importRun = await db.importRun.upsert({
  where: {
    tenantId_idempotencyKey: { tenantId: eveIds.tenant, idempotencyKey: 'eve-demo-prospects-v1' },
  },
  create: {
    id: '10000000-0000-4000-8000-000000000040',
    tenantId: eveIds.tenant,
    filename: 'eve-legal-services-prospects.csv',
    idempotencyKey: 'eve-demo-prospects-v1',
    requestHash: 'fixture-v1',
    status: 'COMPLETED',
    rowsTotal: eveContacts.length,
    rowsImported: eveContacts.length,
    duplicateCount: 2,
    createdBy: adminIdentityId,
    completedAt: new Date(),
  },
  update: { duplicateCount: 2, status: 'COMPLETED' },
});

if ((await db.auditEvent.count({ where: { tenantId: eveIds.tenant } })) === 0) {
  const context = {
    tenantId: eveIds.tenant,
    actorId: adminIdentityId,
    actorType: 'USER' as const,
    correlationId: randomUUID(),
  };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${eveIds.tenant}, true)`;
    await appendAuditEvent(tx, context, {
      action: 'import.completed',
      entityType: 'ImportRun',
      entityId: importRun.id,
      diff: { rows: eveContacts.length, duplicates: 2 },
    });
    await appendAuditEvent(tx, context, {
      action: 'deal.created',
      entityType: 'Deal',
      entityId: eveIds.deal,
      entityVersion: 1,
      diff: { stage: 'DISCOVERY' },
    });
    await appendAuditEvent(tx, context, {
      action: 'note.created',
      entityType: 'Note',
      entityId: eveIds.discoveryNote,
      entityVersion: 1,
      diff: { aiJobId },
    });
    await appendAuditEvent(
      tx,
      { ...context, actorType: 'AI_WORKER' },
      {
        action: 'ai_job.completed',
        entityType: 'AiJob',
        entityId: aiJobId,
        diff: { suggestions: 4 },
      },
    );
  });
}

await db.$disconnect();
