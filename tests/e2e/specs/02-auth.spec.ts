import { expect, test } from '@playwright/test';
import { linkFrom, waitForMail } from '../support/mail.js';
import { PASSWORD, signIn, signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test('sign out, wrong password, sign back in', async ({ page }) => {
  const email = uniqueEmail('bob');
  await signUp(page, { email, name: 'Bob Builder' });
  await skipOnboarding(page);
  await page.getByRole('button', { name: /Bob Builder/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login**');

  await signIn(page, email, 'not the password');
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await signIn(page, email);
  await page.waitForURL((u) => u.pathname === '/');
});

test('protected pages redirect to sign in and come back afterwards', async ({ page }) => {
  const email = uniqueEmail('carol');
  await signUp(page, { email });
  await skipOnboarding(page);
  await page.context().clearCookies();
  await page.goto('/settings/security');
  await page.waitForURL(/\/login\?redirect=/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/settings/security');
});

test('forgot + reset password via email', async ({ page }) => {
  const email = uniqueEmail('dan');
  await signUp(page, { email });
  await skipOnboarding(page);
  await page.context().clearCookies();
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
  const mail = await waitForMail(email, /Reset your/);
  await page.goto(linkFrom(mail.Text, '/reset-password'));
  await page.getByLabel('New password').fill('a brand new passphrase 77');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  await signIn(page, email, 'a brand new passphrase 77');
  await page.waitForURL((u) => u.pathname === '/');
});

test('sessions list shows this device and profile edits persist', async ({ page }) => {
  await signUp(page, { email: uniqueEmail('erin'), name: 'Erin' });
  await skipOnboarding(page);
  await page.goto('/settings/security');
  await expect(page.getByText('This device')).toBeVisible();
  await page.goto('/settings/account');
  await page.getByLabel('Bio').fill('Loves compilers');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Bio')).toHaveValue('Loves compilers');
});

test('theme preference persists across reloads', async ({ page }) => {
  await signUp(page, { email: uniqueEmail('fay') });
  await skipOnboarding(page);
  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: /Dark/ }).click();
  await page.getByRole('button', { name: /Midnight theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lm-bg').trim());
  expect(bg).toBe('#0b0e17');
});
