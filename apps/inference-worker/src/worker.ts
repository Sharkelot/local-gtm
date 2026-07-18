import { DelayedError, type Job } from 'bullmq';

export interface AiJobPayload {
  aiJobId: string;
}

export const AI_EXTRACTION_QUEUE_NAME = 'ai-extraction';

export interface ScopedPrompt {
  modelId: string;
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  responseFormat?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict: boolean;
      schema: Readonly<Record<string, unknown>>;
    };
  };
}

export interface PlatformClient {
  getPrompt(aiJobId: string): Promise<ScopedPrompt>;
  submitRawResult(aiJobId: string, rawOutput: string): Promise<void>;
  reportStatus(input: {
    aiJobId: string;
    state: 'PROCESSING' | 'WAITING_FOR_INFERENCE';
    reason?: string;
    nextRetryAt?: string;
  }): Promise<void>;
  heartbeat(): Promise<void>;
}

export class InferenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InferenceUnavailableError';
  }
}

export interface LmStudioClient {
  complete(prompt: ScopedPrompt): Promise<string>;
}

export type InferenceJob = Pick<
  Job<AiJobPayload>,
  'data' | 'attemptsMade' | 'attemptsStarted' | 'moveToDelayed'
>;

export const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Jittered exponential delay for availability failures, deliberately independent of validation retries. */
export function availabilityRetryDelay(attemptsMade: number, random = Math.random): number {
  const exponent = Math.min(Math.max(attemptsMade, 0), 8);
  const base = Math.min(5_000 * 2 ** exponent, MAX_RETRY_DELAY_MS);
  return Math.min(Math.round(base * (0.8 + random() * 0.4)), MAX_RETRY_DELAY_MS);
}

export function createInferenceProcessor(
  platform: PlatformClient,
  lmStudio: LmStudioClient,
  now: () => number = Date.now,
  random: () => number = Math.random,
) {
  return async (job: InferenceJob): Promise<void> => {
    const aiJobId = job.data?.aiJobId;
    if (!aiJobId || typeof aiJobId !== 'string')
      throw new Error('AI queue job requires aiJobId only.');

    try {
      await platform.reportStatus({ aiJobId, state: 'PROCESSING' });
      const prompt = await platform.getPrompt(aiJobId);
      const rawOutput = await lmStudio.complete(prompt);
      await platform.submitRawResult(aiJobId, rawOutput);
    } catch (error) {
      if (!(error instanceof InferenceUnavailableError)) throw error;
      // DelayedError intentionally does not increment attemptsMade. BullMQ does
      // increment attemptsStarted for every processing pass, including manual
      // delays, so it provides durable exponential availability backoff.
      const availabilityAttempt = Math.max(job.attemptsMade, job.attemptsStarted - 1);
      const delay = availabilityRetryDelay(availabilityAttempt, random);
      const retryAt = now() + delay;
      await platform.reportStatus({
        aiJobId,
        state: 'WAITING_FOR_INFERENCE',
        reason: error.message,
        nextRetryAt: new Date(retryAt).toISOString(),
      });
      await job.moveToDelayed(retryAt);
      throw new DelayedError('LM Studio unavailable; job delayed for retry.');
    }
  };
}

export function startHeartbeat(
  platform: Pick<PlatformClient, 'heartbeat'>,
  intervalMs: number,
  onError: (error: unknown) => void = console.error,
): () => void {
  const tick = () => void platform.heartbeat().catch(onError);
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
