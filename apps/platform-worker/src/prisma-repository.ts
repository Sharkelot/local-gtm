import { prisma } from '@local-gtm/db';
import type { OutboxEvent, OutboxRepository } from './dispatcher.js';

export const prismaOutboxRepository: OutboxRepository = {
  async listDispatchableOutboxEvents(limit, now) {
    const records = await prisma.outboxEvent.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, eventType: true, payload: true },
    });
    return records as OutboxEvent[];
  },
  async markOutboxPublished(eventId, publishedAt) {
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED', publishedAt, lastError: null },
    });
  },
  async markOutboxFailed(eventId, message, availableAt) {
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: message.slice(0, 1000),
        availableAt,
      },
    });
  },
  async listNonterminalAiJobIds(limit) {
    const jobs = await prisma.aiJob.findMany({
      where: {
        status: {
          in: [
            'QUEUED',
            'WAITING_FOR_WORKER',
            'WAITING_FOR_INFERENCE',
            'PROCESSING',
            'FAILED_VALIDATION',
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return jobs.map((job) => job.id);
  },
  async listRecoverableWebhookEventIds(limit) {
    const events = await prisma.webhookEvent.findMany({
      where: { signatureValid: true, status: { in: ['QUEUED', 'PROCESSING'] } },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return events.map((event) => event.id);
  },
  async listQuarantinedDocumentIds(limit) {
    const documents = await prisma.document.findMany({
      where: { scanStatus: 'QUARANTINED' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { tenantId: true, id: true },
    });
    return documents.map((document) => ({ tenantId: document.tenantId, documentId: document.id }));
  },
};
