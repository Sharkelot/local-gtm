import { describe, expect, it } from 'vitest';
import { apiError } from './api-response';

describe('apiError', () => {
  it.each([
    ['Record not found', 404, 'NOT_FOUND'],
    ['Idempotency key used with different input', 409, 'CONFLICT'],
    ['Forbidden for this role', 403, 'FORBIDDEN'],
    ['Invalid request', 400, 'VALIDATION_ERROR'],
  ])('maps %s to a stable HTTP error contract', async (message, status, code) => {
    const response = apiError(new Error(message));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code, message });
  });
});
