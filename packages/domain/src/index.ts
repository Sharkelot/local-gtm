import { aiJobStateSchema, type AiJobState, type SearchPlan } from '@local-gtm/contracts';

export interface ContactIdentity {
  id: string;
  email?: string | null;
  phone?: string | null;
  firstName: string;
  lastName: string;
  organizationName?: string | null;
}
export interface DuplicateScore {
  score: number;
  reasons: readonly string[];
  isCandidate: boolean;
}
const normalized = (value: string | null | undefined) =>
  value?.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
const tokens = (value: string | null | undefined) =>
  new Set((value ?? '').toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []);
const similarity = (a: Set<string>, b: Set<string>) => {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return [...a].filter((item) => b.has(item)).length / union.size;
};

/** Conservative scoring: exact normalized email/phone are strong signals; fuzzy matches only create review candidates. */
export function scoreContactDuplicate(
  left: ContactIdentity,
  right: ContactIdentity,
): DuplicateScore {
  if (left.id === right.id) return { score: 0, reasons: ['same_record'], isCandidate: false };
  const reasons: string[] = [];
  const emailMatch =
    normalized(left.email) !== '' && normalized(left.email) === normalized(right.email);
  const phoneMatch =
    normalized(left.phone) !== '' && normalized(left.phone) === normalized(right.phone);
  if (emailMatch) reasons.push('exact_email');
  if (phoneMatch) reasons.push('exact_phone');
  if (emailMatch) return { score: 1, reasons, isCandidate: true };
  if (phoneMatch) return { score: 0.95, reasons, isCandidate: true };
  const nameScore = similarity(
    tokens(`${left.firstName} ${left.lastName}`),
    tokens(`${right.firstName} ${right.lastName}`),
  );
  const organizationScore = similarity(
    tokens(left.organizationName),
    tokens(right.organizationName),
  );
  const score = Number((nameScore * 0.7 + organizationScore * 0.3).toFixed(3));
  if (nameScore >= 0.8) reasons.push('similar_name');
  if (organizationScore >= 0.8) reasons.push('similar_organization');
  return {
    score,
    reasons,
    isCandidate: nameScore >= 0.8 && organizationScore >= 0.8 && score >= 0.85,
  };
}

const transitions: Readonly<Record<AiJobState, readonly AiJobState[]>> = {
  QUEUED: ['WAITING_FOR_WORKER', 'WAITING_FOR_INFERENCE', 'PROCESSING', 'FAILED_TERMINAL'],
  WAITING_FOR_WORKER: ['QUEUED', 'WAITING_FOR_INFERENCE', 'PROCESSING', 'FAILED_TERMINAL'],
  WAITING_FOR_INFERENCE: ['QUEUED', 'PROCESSING', 'FAILED_TERMINAL'],
  PROCESSING: ['COMPLETED', 'WAITING_FOR_INFERENCE', 'FAILED_VALIDATION', 'FAILED_TERMINAL'],
  COMPLETED: [],
  FAILED_VALIDATION: ['QUEUED', 'FAILED_TERMINAL'],
  FAILED_TERMINAL: [],
};
export function canTransitionAiJob(from: AiJobState, to: AiJobState): boolean {
  return transitions[aiJobStateSchema.parse(from)].includes(aiJobStateSchema.parse(to));
}
export function assertAiJobTransition(from: AiJobState, to: AiJobState): void {
  if (!canTransitionAiJob(from, to)) throw new Error(`Invalid AI job transition: ${from} -> ${to}`);
}

export function normalizeSearchIntent(input: string): SearchPlan {
  const text = input
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const security = /\b(security|sso|saml|soc ?2|privacy|compliance)\b/.test(text);
  const integration = /\b(integration|integrate|case management|clio)\b/.test(text);
  const intentWords = new Set([
    'which',
    'firms',
    'have',
    'with',
    'about',
    'what',
    'show',
    'security',
    'concern',
    'concerns',
    'sso',
    'saml',
    'privacy',
    'compliance',
    'integration',
    'integrate',
    'requirements',
  ]);
  const terms = text
    .split(' ')
    .filter((term) => term.length >= 3 && !intentWords.has(term))
    .slice(0, 10);
  return {
    entityTypes: ['organization', 'deal'],
    insightCategories: [
      ...(security ? ['SECURITY_CONCERN' as const] : []),
      ...(integration ? ['INTEGRATION_REQUIREMENT' as const] : []),
    ],
    terms,
    sort: 'RELEVANCE',
    limit: 25,
  };
}

export interface LedgerLine {
  accountId: string;
  debitCents: number;
  creditCents: number;
  clientId?: string;
}
export interface LedgerEntry {
  id: string;
  tenantId: string;
  occurredAt: string;
  memo: string;
  lines: readonly LedgerLine[];
  reversalOfId?: string;
}
export function validateLedgerEntry(entry: LedgerEntry): void {
  if (!entry.id || !entry.tenantId || !entry.memo || entry.lines.length < 2)
    throw new Error('Ledger entry requires identity, memo, and at least two lines.');
  let debits = 0;
  let credits = 0;
  for (const line of entry.lines) {
    if (
      !line.accountId ||
      !Number.isSafeInteger(line.debitCents) ||
      !Number.isSafeInteger(line.creditCents) ||
      line.debitCents < 0 ||
      line.creditCents < 0 ||
      (line.debitCents === 0) === (line.creditCents === 0)
    )
      throw new Error('Each ledger line must have exactly one positive integer side.');
    debits += line.debitCents;
    credits += line.creditCents;
  }
  if (debits !== credits) throw new Error('Ledger entry debits must equal credits.');
}
export function createReversal(
  entry: LedgerEntry,
  reversalId: string,
  occurredAt: string,
): LedgerEntry {
  validateLedgerEntry(entry);
  if (!reversalId || reversalId === entry.id)
    throw new Error('A reversal must have a distinct identity.');
  return {
    id: reversalId,
    tenantId: entry.tenantId,
    occurredAt,
    memo: `Reversal of ${entry.id}: ${entry.memo}`,
    reversalOfId: entry.id,
    lines: entry.lines.map((line) => ({
      ...line,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
    })),
  };
}
