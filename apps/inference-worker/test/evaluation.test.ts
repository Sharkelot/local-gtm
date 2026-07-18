import { describe, expect, it } from 'vitest';
import { expectedAiExtraction } from '@local-gtm/fixtures';
import {
  evaluateModelCandidate,
  scoreExtractionFields,
  selectSmallestQualifiedModel,
} from '../src/evaluation.js';

describe('model evaluation gate', () => {
  it('computes exact field F1 independently of advisory metadata', () => {
    expect(scoreExtractionFields(expectedAiExtraction, expectedAiExtraction).f1).toBe(1);
    expect(
      scoreExtractionFields(expectedAiExtraction, {
        ...expectedAiExtraction,
        suggestions: expectedAiExtraction.suggestions.slice(0, 3),
      }).f1,
    ).toBeCloseTo(6 / 7);
  });

  it('requires schema validity, field F1, and latency before selecting the smallest model', async () => {
    let time = 0;
    const evaluation = await evaluateModelCandidate(
      { modelId: 'qwen-4b', parameterBillions: 4 },
      [{ caseId: 'eve', noteText: 'note', expected: expectedAiExtraction }],
      () => Promise.resolve(JSON.stringify(expectedAiExtraction)),
      () => {
        time += 1_000;
        return time;
      },
    );
    expect(evaluation).toMatchObject({
      schemaValidityRate: 1,
      fieldF1: 1,
      p95CompletionMs: 1_000,
      qualifies: true,
    });
    expect(
      selectSmallestQualifiedModel([
        { ...evaluation, modelId: 'qwen-27b', parameterBillions: 27 },
        evaluation,
      ])?.modelId,
    ).toBe('qwen-4b');
  });

  it('retains invalid model output as a failed evaluation', async () => {
    const evaluation = await evaluateModelCandidate(
      { modelId: 'bad', parameterBillions: 4 },
      [{ caseId: 'eve', noteText: 'note', expected: expectedAiExtraction }],
      () => Promise.resolve('{not-json}'),
    );
    expect(evaluation.qualifies).toBe(false);
    expect(evaluation.failures).toHaveLength(1);
  });
});
