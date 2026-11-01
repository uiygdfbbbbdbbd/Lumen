import { expect, test } from '@playwright/test';
import { linkFrom, waitForMail } from '../support/mail.js';
import { ADMIN_EMAIL, signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test.describe.configure({ mode: 'serial' });

test('the first account becomes super admin', async ({ page }) => {
  await signUp(page, { email: ADMIN_EMAIL, name: 'Instance Admin' });
  await skipOnboarding(page);
  await page.getByRole('button', { name: /Instance Admin/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Design system' })).toBeVisible();
});

test('full onboarding with avatar, unverified locks, then email verification unlocks features', async ({ page }) => {
  const email = uniqueEmail('ada');
  await signUp(page, { email, name: 'Ada Lovelace', avatar: true });

  // Step 0 -> 6, exercising each step.
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'How should we show you?' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ada Lovelace' }).locator('img')).toHaveAttribute('src', /\/api\/avatars\//);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'dark' }).click();
  await page.getByRole('button', { name: /Nord theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Coding' }).click();
  await page.getByRole('button', { name: 'Research' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Auto/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Progress is resumable: reload mid-way keeps the step.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You’re ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Start the tour' }).click();

  await expect(page.getByRole('dialog', { name: 'Your home' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.getByRole('heading', { name: /Ada/ })).toBeVisible();
  await expect(page.getByText('Explain this error')).toBeVisible(); // coding starter

  await expect(page.getByText('Verify your email to unlock everything')).toBeVisible();
  await page.goto('/settings/usage');
  const codeMode = page.locator('li', { hasText: 'Code Mode (Linux sandbox)' });
  await expect(codeMode.getByLabel('Locked')).toBeVisible();
  await expect(codeMode).toContainText('Verify your email to unlock this feature.');

  const mail = await waitForMail(email, /Verify your email/);
  await page.goto(linkFrom(mail.Text, '/verify-email'));
  await expect(page.getByRole('heading', { name: 'All set' })).toBeVisible();
  await page.goto('/settings/usage');
  await expect(page.locator('li', { hasText: 'Code Mode (Linux sandbox)' }).getByLabel('Available')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Verify your email to unlock everything')).toBeHidden();
});

test('an expired or reused verification link shows a clear state', async ({ page }) => {
  await page.goto('/verify-email?token=' + 'x'.repeat(43));
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
});
