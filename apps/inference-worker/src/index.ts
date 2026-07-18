import { Worker } from 'bullmq';
import { createPrivatePlatformFetch, HttpLmStudioClient, HttpPlatformClient } from './clients.js';
import {
  AI_EXTRACTION_QUEUE_NAME,
  createInferenceProcessor,
  startHeartbeat,
  type AiJobPayload,
} from './worker.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const connectHost = process.env.INTERNAL_API_CONNECT_HOST;
const platformFetch = connectHost
  ? createPrivatePlatformFetch(connectHost, process.env.INTERNAL_API_CA_PATH)
  : fetch;
const platform = new HttpPlatformClient(
  required('INTERNAL_API_URL'),
  required('INFERENCE_WORKER_TOKEN'),
  platformFetch,
);
const lmStudio = new HttpLmStudioClient(process.env.LM_STUDIO_BASE_URL ?? 'http://127.0.0.1:1234');
const connection = {
  host: required('REDIS_HOST'),
  port: Number(process.env.REDIS_PORT ?? '6379'),
  password: required('REDIS_PASSWORD'),
};

const stopHeartbeat = startHeartbeat(
  platform,
  Number(process.env.HEARTBEAT_INTERVAL_MS ?? '30000'),
);
const worker = new Worker<AiJobPayload>(
  AI_EXTRACTION_QUEUE_NAME,
  createInferenceProcessor(platform, lmStudio),
  {
    connection,
    concurrency: 1,
  },
);

const shutdown = async () => {
  stopHeartbeat();
  await worker.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
