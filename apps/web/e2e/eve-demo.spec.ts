import { expect, test } from '@playwright/test';

const dealId = '10000000-0000-4000-8000-000000000003';
const workerHeaders = { authorization: 'Bearer e2e-worker-token' };

test('Eve CRM approval, deterministic search, inference outage recovery, and audit timeline', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByText('Eve Legal Services')).toBeVisible();
  await expect(page.getByText('Duplicate review').locator('..').getByText('2')).toBeVisible();

  await page.goto(`/deals/${dealId}`);
  await expect(page.getByRole('heading', { name: /Harbor Point Injury Law/ })).toBeVisible();
  await expect(page.locator('.suggestion')).toHaveCount(4);

  for (const kind of ['SECURITY CONCERN', 'FOLLOW UP DATE', 'DECISION MAKER']) {
    const suggestion = page.locator('.suggestion').filter({ hasText: kind });
    await suggestion.getByRole('button', { name: 'Approve' }).click();
    await expect(suggestion.getByText('approved')).toBeVisible();
  }
  await expect(
    page
      .locator('.suggestion')
      .filter({ hasText: 'INTEGRATION REQUIREMENT' })
      .getByRole('button', { name: 'Approve' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText('SSO/SAML required for IT security review')).toBeVisible();
  await expect(page.getByText('Decision maker', { exact: true })).toBeVisible();
  await expect(page.getByText(/follow-up 8\/14\/2026/)).toBeVisible();

  await page.goto('/search?q=Which%20firms%20have%20security%20concerns%3F');
  await expect(page.getByText('Harbor Point Injury Law')).toBeVisible();
  await expect(page.getByText('Security concern', { exact: true })).toBeVisible();

  const noteResponse = await request.post(`/api/v1/deals/${dealId}/notes`, {
    data: { body: 'LM Studio outage recovery demo note.' },
  });
  expect(noteResponse.status()).toBe(201);
  const created = (await noteResponse.json()) as { aiJob: { id: string } };
  const aiJobId = created.aiJob.id;
  const nextRetryAt = new Date(Date.now() + 60_000).toISOString();

  const waitingResponse = await request.post(`/api/internal/ai-jobs/${aiJobId}/status`, {
    headers: workerHeaders,
    data: { state: 'WAITING_FOR_INFERENCE', nextRetryAt },
  });
  expect(waitingResponse.ok()).toBeTruthy();
  await page.goto('/ai');
  const jobPanel = page.locator('.panel').filter({ hasText: aiJobId });
  await expect(jobPanel.getByText('WAITING FOR INFERENCE')).toBeVisible();
  await expect(jobPanel.getByText(/LM_STUDIO_OFFLINE/)).toBeVisible();

  const completionResponse = await request.post(`/api/internal/ai-jobs/${aiJobId}/result`, {
    headers: workerHeaders,
    data: { rawOutput: JSON.stringify({ schemaVersion: '1', suggestions: [] }) },
  });
  expect(completionResponse.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.locator('.panel').filter({ hasText: aiJobId }).getByText('COMPLETED'),
  ).toBeVisible();

  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Complete timeline' })).toBeVisible();
  await expect(page.getByText('ai_job.waiting')).toBeVisible();
  await expect(page.getByText('ai_job.completed').first()).toBeVisible();
  await expect(page.getByText('ai_suggestion.approved').first()).toBeVisible();
});
