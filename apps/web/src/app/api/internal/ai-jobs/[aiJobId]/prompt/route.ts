import { aiExtractionJsonSchema } from '@local-gtm/contracts';
import { getAiJobForInternalUse } from '@/lib/internal-context';
import { getInternalToken } from '@/lib/request-context';

export async function GET(request: Request, { params }: { params: Promise<{ aiJobId: string }> }) {
  if (!getInternalToken(request))
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const { aiJobId } = await params;
  const job = await getAiJobForInternalUse(aiJobId);
  if (!job) return Response.json({ message: 'AI job not found.' }, { status: 404 });
  const schemaGuide = `Return JSON only with schemaVersion "1" and suggestions. Each suggestion needs suggestionId UUID, sourceNoteId "${job.noteId}", sourceNoteVersion ${job.note.version}, evidence {start,end,quote}, confidence 0..1, promptVersion "${job.promptVersion}", modelId matching the configured model, schemaVersion "1", type, target, and value. Allowed types/targets: INTEGRATION_REQUIREMENT/organization.integrationRequirements, SECURITY_CONCERN/organization.securityConcerns, FOLLOW_UP_DATE/deal.followUpDate (YYYY-MM-DD), DECISION_MAKER/deal.decisionMaker, GENERAL_FIELD_UPDATE with its allowed target. Do not propose database queries or record deletion.`;
  const correction = job.validationRetries
    ? `A previous response failed schema validation: ${job.attempts[0]?.errorMessage ?? 'unknown schema error'}. Correct every issue and return a complete replacement JSON object.`
    : null;
  const modelId = process.env.AI_MODEL_ID ?? 'qwen3-4b-instruct-2507';
  const suggestionSchema = aiExtractionJsonSchema.properties.suggestions.items;
  const jobExtractionJsonSchema = {
    ...aiExtractionJsonSchema,
    properties: {
      ...aiExtractionJsonSchema.properties,
      suggestions: {
        ...aiExtractionJsonSchema.properties.suggestions,
        items: {
          ...suggestionSchema,
          properties: {
            ...suggestionSchema.properties,
            sourceNoteId: { type: 'string', enum: [job.noteId] },
            sourceNoteVersion: { type: 'integer', enum: [job.note.version] },
            promptVersion: { type: 'string', enum: [job.promptVersion] },
            modelId: { type: 'string', enum: [modelId] },
          },
        },
      },
    },
  } as const;
  return Response.json({
    modelId,
    temperature: 0,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'ai_extraction_result',
        strict: true,
        schema: jobExtractionJsonSchema,
      },
    },
    messages: [
      {
        role: 'system',
        content: `You extract advisory CRM suggestions from legal sales discovery notes. ${schemaGuide}${correction ? ` ${correction}` : ''}`,
      },
      {
        role: 'user',
        content: `Organization: ${job.note.deal.organization.name}\nDeal: ${job.note.deal.name}\nNote:\n${job.note.body}`,
      },
    ],
  });
}
