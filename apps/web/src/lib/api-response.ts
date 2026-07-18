import { randomUUID } from 'node:crypto';

export function apiError(error: unknown, fallback = 'Request failed.') {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found/i.test(message)
    ? 404
    : /already|stale|idempotency|different input/i.test(message)
      ? 409
      : /unauthorized|not authorized|authorization|forbidden|membership.*required/i.test(message)
        ? 403
        : 400;
  return Response.json(
    {
      code:
        status === 404
          ? 'NOT_FOUND'
          : status === 409
            ? 'CONFLICT'
            : status === 403
              ? 'FORBIDDEN'
              : 'VALIDATION_ERROR',
      message,
      requestId: randomUUID(),
    },
    { status },
  );
}
