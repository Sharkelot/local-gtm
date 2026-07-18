import { aiExtractionResultSchema, type AiExtractionResult } from '@local-gtm/contracts';

export interface GoldenExtractionCase {
  caseId: string;
  noteText: string;
  expected: AiExtractionResult;
}

export interface ModelCandidate {
  modelId: string;
  parameterBillions: number;
}

export interface ModelEvaluation {
  modelId: string;
  parameterBillions: number;
  caseCount: number;
  schemaValidityRate: number;
  fieldF1: number;
  p95CompletionMs: number;
  qualifies: boolean;
  failures: Array<{ caseId: string; reason: string }>;
}

interface FieldCounts {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

const normalizedValue = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const fieldKey = (suggestion: AiExtractionResult['suggestions'][number]) =>
  `${suggestion.type}\u0000${suggestion.target}\u0000${normalizedValue(suggestion.value)}`;

export function scoreExtractionFields(
  expected: AiExtractionResult,
  actual: AiExtractionResult,
): FieldCounts & { f1: number } {
  const expectedKeys = new Set(expected.suggestions.map(fieldKey));
  const actualKeys = new Set(actual.suggestions.map(fieldKey));
  const truePositive = [...actualKeys].filter((key) => expectedKeys.has(key)).length;
  const falsePositive = actualKeys.size - truePositive;
  const falseNegative = expectedKeys.size - truePositive;
  const denominator = 2 * truePositive + falsePositive + falseNegative;
  return {
    truePositive,
    falsePositive,
    falseNegative,
    f1: denominator === 0 ? 1 : (2 * truePositive) / denominator,
  };
}

export function parseModelExtraction(rawOutput: string): AiExtractionResult {
  const unwrapped = rawOutput
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return aiExtractionResultSchema.parse(JSON.parse(unwrapped) as unknown);
}

function percentile95(durations: readonly number[]): number {
  if (durations.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

export async function evaluateModelCandidate(
  candidate: ModelCandidate,
  cases: readonly GoldenExtractionCase[],
  complete: (candidate: ModelCandidate, extractionCase: GoldenExtractionCase) => Promise<string>,
  now: () => number = Date.now,
): Promise<ModelEvaluation> {
  if (cases.length === 0) throw new Error('At least one golden extraction case is required.');
  const durations: number[] = [];
  const failures: ModelEvaluation['failures'] = [];
  let validCases = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const extractionCase of cases) {
    const startedAt = now();
    try {
      const rawOutput = await complete(candidate, extractionCase);
      durations.push(Math.max(0, now() - startedAt));
      const actual = parseModelExtraction(rawOutput);
      validCases += 1;
      const score = scoreExtractionFields(extractionCase.expected, actual);
      truePositive += score.truePositive;
      falsePositive += score.falsePositive;
      falseNegative += score.falseNegative;
    } catch (error) {
      durations.push(Math.max(0, now() - startedAt));
      failures.push({
        caseId: extractionCase.caseId,
        reason: error instanceof Error ? error.message : 'Unknown evaluation failure.',
      });
      falseNegative += extractionCase.expected.suggestions.length;
    }
  }

  const denominator = 2 * truePositive + falsePositive + falseNegative;
  const fieldF1 = denominator === 0 ? 1 : (2 * truePositive) / denominator;
  const schemaValidityRate = validCases / cases.length;
  const p95CompletionMs = percentile95(durations);
  return {
    modelId: candidate.modelId,
    parameterBillions: candidate.parameterBillions,
    caseCount: cases.length,
    schemaValidityRate,
    fieldF1,
    p95CompletionMs,
    qualifies: schemaValidityRate === 1 && fieldF1 >= 0.9 && p95CompletionMs < 60_000,
    failures,
  };
}

export function selectSmallestQualifiedModel(
  evaluations: readonly ModelEvaluation[],
): ModelEvaluation | null {
  return (
    evaluations
      .filter((evaluation) => evaluation.qualifies)
      .sort(
        (left, right) =>
          left.parameterBillions - right.parameterBillions ||
          left.modelId.localeCompare(right.modelId),
      )[0] ?? null
  );
}
