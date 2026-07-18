import { describe, expect, it } from 'vitest';
import { aiExtractionResultSchema } from '@local-gtm/contracts';
import { scoreContactDuplicate } from '@local-gtm/domain';
import { discoveryNoteText, eveContacts, expectedAiExtraction } from '../src/index.js';

describe('Eve Legal Services demo fixture', () => {
  it('yields exactly two review-only duplicate candidates', () => {
    const pairs = eveContacts.flatMap((left, index) =>
      eveContacts.slice(index + 1).map((right) => ({ left, right })),
    );
    const candidates = pairs.filter(
      ({ left, right }) => scoreContactDuplicate(left, right).isCandidate,
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ left, right }) => [left.id, right.id])).toEqual([
      [eveContacts[0]!.id, eveContacts[1]!.id],
      [eveContacts[2]!.id, eveContacts[3]!.id],
    ]);
  });

  it('contains four schema-valid, evidence-backed advisory suggestions', () => {
    expect(aiExtractionResultSchema.parse(expectedAiExtraction).suggestions).toHaveLength(4);
    for (const suggestion of expectedAiExtraction.suggestions) {
      expect(discoveryNoteText.slice(suggestion.evidence.start, suggestion.evidence.end)).toBe(
        suggestion.evidence.quote,
      );
    }
  });
});
