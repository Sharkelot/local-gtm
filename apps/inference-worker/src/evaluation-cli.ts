import { discoveryNoteText, expectedAiExtraction } from '@local-gtm/fixtures';
import { HttpLmStudioClient } from './clients.js';
import {
  evaluateModelCandidate,
  selectSmallestQualifiedModel,
  type GoldenExtractionCase,
  type ModelCandidate,
} from './evaluation.js';

function readCandidates(): ModelCandidate[] {
  const raw = process.env.QWEN_MODEL_CANDIDATES_JSON;
  if (!raw) throw new Error('QWEN_MODEL_CANDIDATES_JSON is required.');
  const parsed: unknown = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error('QWEN_MODEL_CANDIDATES_JSON must be a non-empty array.');
  const candidates: unknown[] = parsed;
  return candidates.map((candidate: unknown) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('modelId' in candidate) ||
      typeof candidate.modelId !== 'string' ||
      !('parameterBillions' in candidate) ||
      typeof candidate.parameterBillions !== 'number' ||
      candidate.parameterBillions <= 0
    )
      throw new Error('Each model candidate requires modelId and positive parameterBillions.');
    return { modelId: candidate.modelId, parameterBillions: candidate.parameterBillions };
  });
}

const cases: GoldenExtractionCase[] = [
  {
    caseId: 'eve-discovery-note-v1',
    noteText: discoveryNoteText,
    expected: expectedAiExtraction,
  },
];

const client = new HttpLmStudioClient(process.env.LM_STUDIO_URL ?? 'http://127.0.0.1:1234');
const evaluations = [];
for (const candidate of readCandidates()) {
  evaluations.push(
    await evaluateModelCandidate(candidate, cases, async (model, extractionCase) =>
      client.complete({
        modelId: model.modelId,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Return JSON only. Use schemaVersion "1" and a suggestions array. Every suggestion must include a UUID suggestionId, sourceNoteId 10000000-0000-4000-8000-000000000004, sourceNoteVersion 1, exact evidence start/end/quote, confidence, promptVersion "model-eval-v1", your modelId, schemaVersion "1", one allowed type/target, and its value.',
          },
          { role: 'user', content: extractionCase.noteText },
        ],
      }),
    ),
  );
}

const selected = selectSmallestQualifiedModel(evaluations);
process.stdout.write(`${JSON.stringify({ evaluations, selected }, null, 2)}\n`);
if (!selected) process.exitCode = 1;
