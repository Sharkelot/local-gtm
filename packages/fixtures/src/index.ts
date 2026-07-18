import { aiExtractionResultSchema, type AiExtractionResult } from '@local-gtm/contracts';
import type { ContactIdentity } from '@local-gtm/domain';

export const eveIds = {
  tenant: '10000000-0000-4000-8000-000000000001',
  organization: '10000000-0000-4000-8000-000000000002',
  deal: '10000000-0000-4000-8000-000000000003',
  discoveryNote: '10000000-0000-4000-8000-000000000004',
  contacts: [
    '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000015',
  ],
  suggestions: [
    '10000000-0000-4000-8000-000000000020',
    '10000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000023',
  ],
} as const;

export const eveTenant = { id: eveIds.tenant, name: 'Eve Legal Services' } as const;
export const harborPointOrganization = {
  id: eveIds.organization,
  tenantId: eveIds.tenant,
  name: 'Harbor Point Injury Law',
  industry: 'Personal injury law',
} as const;
export const harborPointDeal = {
  id: eveIds.deal,
  tenantId: eveIds.tenant,
  organizationId: eveIds.organization,
  name: 'Harbor Point Injury Law — case-management evaluation',
  stage: 'DISCOVERY',
} as const;

export const discoveryNoteText =
  'Harbor Point requires a case-management integration before moving forward. ' +
  'They have an SSO/SAML security concern for their IT review. ' +
  'Follow up with Alex Morgan on 2026-08-14.';

const evidence = (quote: string) => {
  const start = discoveryNoteText.indexOf(quote);
  if (start < 0) throw new Error(`Fixture evidence quote not found: ${quote}`);
  return { start, end: start + quote.length, quote };
};

export const eveContacts: readonly ContactIdentity[] = [
  {
    id: eveIds.contacts[0],
    firstName: 'Alex',
    lastName: 'Morgan',
    email: 'alex.morgan@harborpoint.test',
    phone: '+1-312-555-0101',
    organizationName: 'Harbor Point Injury Law',
  },
  {
    id: eveIds.contacts[1],
    firstName: 'Alex',
    lastName: 'Morgan',
    email: 'alex.morgan@harborpoint.test',
    phone: '+1-312-555-0199',
    organizationName: 'Harbor Point Injury Law',
  },
  {
    id: eveIds.contacts[2],
    firstName: 'Priya',
    lastName: 'Shah',
    email: 'priya@lakefrontlegal.test',
    phone: '+1-312-555-0202',
    organizationName: 'Lakefront Legal Group',
  },
  {
    id: eveIds.contacts[3],
    firstName: 'Priya',
    lastName: 'Singh',
    email: 'priya.singh@lakefrontlegal.test',
    phone: '+1-312-555-0202',
    organizationName: 'Lakefront Legal Group',
  },
  {
    id: eveIds.contacts[4],
    firstName: 'Miles',
    lastName: 'Reed',
    email: 'miles@northstar.test',
    phone: '+1-312-555-0303',
    organizationName: 'Northstar Family Law',
  },
  {
    id: eveIds.contacts[5],
    firstName: 'Nora',
    lastName: 'Chen',
    email: 'nora@cedar.test',
    phone: '+1-312-555-0404',
    organizationName: 'Cedar Hill Counsel',
  },
];

export const expectedAiExtraction: AiExtractionResult = aiExtractionResultSchema.parse({
  schemaVersion: '1',
  suggestions: [
    {
      suggestionId: eveIds.suggestions[0],
      sourceNoteId: eveIds.discoveryNote,
      sourceNoteVersion: 1,
      evidence: evidence('requires a case-management integration'),
      confidence: 0.98,
      promptVersion: 'eve-demo-v1',
      modelId: 'qwen-demo-fixture',
      schemaVersion: '1',
      type: 'INTEGRATION_REQUIREMENT',
      target: 'organization.integrationRequirements',
      value: 'Case-management integration required',
    },
    {
      suggestionId: eveIds.suggestions[1],
      sourceNoteId: eveIds.discoveryNote,
      sourceNoteVersion: 1,
      evidence: evidence('SSO/SAML security concern'),
      confidence: 0.97,
      promptVersion: 'eve-demo-v1',
      modelId: 'qwen-demo-fixture',
      schemaVersion: '1',
      type: 'SECURITY_CONCERN',
      target: 'organization.securityConcerns',
      value: 'SSO/SAML required for IT security review',
    },
    {
      suggestionId: eveIds.suggestions[2],
      sourceNoteId: eveIds.discoveryNote,
      sourceNoteVersion: 1,
      evidence: evidence('Follow up with Alex Morgan on 2026-08-14'),
      confidence: 0.99,
      promptVersion: 'eve-demo-v1',
      modelId: 'qwen-demo-fixture',
      schemaVersion: '1',
      type: 'FOLLOW_UP_DATE',
      target: 'deal.followUpDate',
      value: '2026-08-14',
    },
    {
      suggestionId: eveIds.suggestions[3],
      sourceNoteId: eveIds.discoveryNote,
      sourceNoteVersion: 1,
      evidence: evidence('Alex Morgan'),
      confidence: 0.96,
      promptVersion: 'eve-demo-v1',
      modelId: 'qwen-demo-fixture',
      schemaVersion: '1',
      type: 'DECISION_MAKER',
      target: 'deal.decisionMaker',
      value: 'Alex Morgan',
    },
  ],
});
