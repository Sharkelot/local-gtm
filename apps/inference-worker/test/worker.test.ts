import { DelayedError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_EXTRACTION_QUEUE_NAME,
  InferenceUnavailableError,
  availabilityRetryDelay,
  createInferenceProcessor,
  type InferenceJob,
  type LmStudioClient,
  type PlatformClient,
} from '../src/worker.js';

const platform = () => {
  const submitRawResult = vi.fn().mockResolvedValue(undefined);
  const reportStatus = vi.fn().mockResolvedValue(undefined);
  const api: PlatformClient = {
    getPrompt: vi
      .fn()
      .mockResolvedValue({ modelId: 'qwen', messages: [{ role: 'user', content: 'extract' }] }),
    submitRawResult,
    reportStatus,
    heartbeat: vi.fn().mockResolvedValue(undefined),
  };
  return { api, submitRawResult, reportStatus };
};
const job = (attemptsMade = 0, attemptsStarted = attemptsMade + 1): InferenceJob => ({
  data: { aiJobId: 'job-1' },
  attemptsMade,
  attemptsStarted,
  moveToDelayed: vi.fn().mockResolvedValue(undefined),
});

describe('inference processor', () => {
  it('consumes the queue published by the transactional outbox dispatcher', () => {
    expect(AI_EXTRACTION_QUEUE_NAME).toBe('ai-extraction');
  });

  it('submits raw output and never receives CRM write capabilities', async () => {
    const { api, submitRawResult, reportStatus } = platform();
    const lm: LmStudioClient = { complete: vi.fn().mockResolvedValue('{"suggestions":[]}') };
    await createInferenceProcessor(api, lm)(job());
    expect(submitRawResult).toHaveBeenCalledWith('job-1', '{"suggestions":[]}');
    expect(reportStatus).toHaveBeenCalledWith({ aiJobId: 'job-1', state: 'PROCESSING' });
  });

  it('delays an unavailable LM Studio job without submitting a result', async () => {
    const { api, submitRawResult, reportStatus } = platform();
    const lm: LmStudioClient = {
      complete: vi.fn().mockRejectedValue(new InferenceUnavailableError('connection refused')),
    };
    const queued = job(2);
    await expect(
      createInferenceProcessor(
        api,
        lm,
        () => 1_000,
        () => 0,
      )(queued),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(queued.moveToDelayed).toHaveBeenCalledWith(17_000);
    expect(submitRawResult).not.toHaveBeenCalled();
    expect(reportStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'WAITING_FOR_INFERENCE',
        nextRetryAt: new Date(17_000).toISOString(),
      }),
    );
  });

  it('caps availability backoff at five minutes', () => {
    expect(availabilityRetryDelay(99, () => 1)).toBe(300_000);
  });

  it('backs off delayed availability retries using processing starts', async () => {
    const { api } = platform();
    const lm: LmStudioClient = {
      complete: vi.fn().mockRejectedValue(new InferenceUnavailableError('connection refused')),
    };
    const delayed = job(0, 4);
    await expect(
      createInferenceProcessor(
        api,
        lm,
        () => 1_000,
        () => 0,
      )(delayed),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(delayed.moveToDelayed).toHaveBeenCalledWith(33_000);
  });
});
