import { z } from 'zod';

export const tenantRoleSchema = z.enum([
  'platform_admin',
  'tenant_admin',
  'attorney',
  'sales',
  'billing',
  'staff',
  'auditor',
  'client',
]);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export const auditActorSchema = z.object({
  actorId: z.string().uuid().nullable(),
  actorType: z.enum(['USER', 'SYSTEM', 'AI_WORKER', 'INTEGRATION']),
  displayName: z.string().trim().min(1).max(200).optional(),
});

export const auditEventInputSchema = z.object({
  tenantId: z.string().uuid(),
  actor: auditActorSchema,
  action: z.string().trim().min(3).max(120),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().uuid(),
  entityVersion: z.number().int().positive().nullable(),
  diff: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().min(1).max(1000).optional(),
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type AuditEventInput = z.infer<typeof auditEventInputSchema>;

export const aiJobStateSchema = z.enum([
  'QUEUED',
  'WAITING_FOR_WORKER',
  'WAITING_FOR_INFERENCE',
  'PROCESSING',
  'COMPLETED',
  'FAILED_VALIDATION',
  'FAILED_TERMINAL',
]);
export type AiJobState = z.infer<typeof aiJobStateSchema>;

const evidenceSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().trim().min(1).max(2000),
  })
  .refine((value) => value.end > value.start, { message: 'Evidence end must follow start.' });
const baseSuggestionSchema = z.object({
  suggestionId: z.string().uuid(),
  sourceNoteId: z.string().uuid(),
  sourceNoteVersion: z.number().int().positive(),
  evidence: evidenceSchema,
  confidence: z.number().min(0).max(1),
  promptVersion: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(200),
  schemaVersion: z.literal('1'),
});
export const aiSuggestionSchema = z.discriminatedUnion('type', [
  baseSuggestionSchema.extend({
    type: z.literal('INTEGRATION_REQUIREMENT'),
    target: z.literal('organization.integrationRequirements'),
    value: z.string().trim().min(1).max(500),
  }),
  baseSuggestionSchema.extend({
    type: z.literal('SECURITY_CONCERN'),
    target: z.literal('organization.securityConcerns'),
    value: z.string().trim().min(1).max(500),
  }),
  baseSuggestionSchema.extend({
    type: z.literal('FOLLOW_UP_DATE'),
    target: z.literal('deal.followUpDate'),
    value: z.string().date(),
  }),
  baseSuggestionSchema.extend({
    type: z.literal('DECISION_MAKER'),
    target: z.literal('deal.decisionMaker'),
    value: z.string().trim().min(1).max(200),
  }),
  baseSuggestionSchema.extend({
    type: z.literal('GENERAL_FIELD_UPDATE'),
    target: z.enum(['organization.industry', 'deal.nextStep', 'contact.title']),
    value: z.string().trim().min(1).max(500),
  }),
]);
export const aiExtractionResultSchema = z.object({
  schemaVersion: z.literal('1'),
  suggestions: z.array(aiSuggestionSchema).max(25),
});
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;
export type AiExtractionResult = z.infer<typeof aiExtractionResultSchema>;

/** JSON-generation constraint paired with the authoritative Zod validator above. */
export const aiExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', enum: ['1'] },
    suggestions: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          suggestionId: {
            type: 'string',
            pattern:
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          },
          sourceNoteId: {
            type: 'string',
            pattern:
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          },
          sourceNoteVersion: { type: 'integer' },
          evidence: {
            type: 'object',
            additionalProperties: false,
            properties: {
              start: { type: 'integer' },
              end: { type: 'integer' },
              quote: { type: 'string' },
            },
            required: ['start', 'end', 'quote'],
          },
          confidence: { type: 'number' },
          promptVersion: { type: 'string' },
          modelId: { type: 'string' },
          schemaVersion: { type: 'string', enum: ['1'] },
          type: {
            type: 'string',
            enum: [
              'INTEGRATION_REQUIREMENT',
              'SECURITY_CONCERN',
              'FOLLOW_UP_DATE',
              'DECISION_MAKER',
              'GENERAL_FIELD_UPDATE',
            ],
          },
          target: {
            type: 'string',
            enum: [
              'organization.integrationRequirements',
              'organization.securityConcerns',
              'deal.followUpDate',
              'deal.decisionMaker',
              'organization.industry',
              'deal.nextStep',
              'contact.title',
            ],
          },
          value: { type: 'string' },
        },
        required: [
          'suggestionId',
          'sourceNoteId',
          'sourceNoteVersion',
          'evidence',
          'confidence',
          'promptVersion',
          'modelId',
          'schemaVersion',
          'type',
          'target',
          'value',
        ],
      },
    },
  },
  required: ['schemaVersion', 'suggestions'],
} as const;

const noSql = (value: string) =>
  !/\b(select|insert|update|delete|drop|alter|create|grant|revoke|union|--|;|\/\*)\b/i.test(value);
export const searchPlanSchema = z
  .object({
    entityTypes: z
      .array(z.enum(['organization', 'contact', 'deal', 'matter']))
      .min(1)
      .max(4),
    insightCategories: z
      .array(z.enum(['SECURITY_CONCERN', 'INTEGRATION_REQUIREMENT']))
      .max(5)
      .default([]),
    terms: z
      .array(
        z.string().trim().min(1).max(100).refine(noSql, 'Search terms may not contain SQL syntax.'),
      )
      .max(10)
      .default([]),
    dateRange: z
      .object({ from: z.string().date().optional(), to: z.string().date().optional() })
      .optional(),
    sort: z.enum(['RELEVANCE', 'UPDATED_AT_DESC', 'NAME_ASC']).default('RELEVANCE'),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type SearchPlan = z.infer<typeof searchPlanSchema>;

export const apiErrorSchema = z.object({
  code: z.enum([
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
  ]),
  message: z.string().min(1).max(1000),
  requestId: z.string().uuid(),
  details: z
    .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
    .optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency key has unsupported characters.');
