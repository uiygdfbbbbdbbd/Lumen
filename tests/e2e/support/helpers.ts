import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASSWORD = 'correct horse battery staple 42!';
/** The first account created in a run (spec 01) becomes super admin. */
export const ADMIN_EMAIL = 'admin@lumen-e2e.example.com';
export const AVATAR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'avatar.png');

export function uniqueEmail(tag: string) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function signUp(page: Page, opts: { email: string; name?: string; avatar?: boolean }) {
  await page.goto('/signup');
  if (opts.avatar) {
    await page.getByLabel('Choose profile photo').setInputFiles(AVATAR);
    const dialog = page.getByRole('dialog', { name: 'Crop your photo' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Zoom').fill('1.5');
    await dialog.getByRole('button', { name: 'Use photo' }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByLabel('Display name').fill(opts.name ?? 'E2E User');
  await page.getByLabel('Email').fill(opts.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Birth year').fill('1990');
  await page.getByRole('checkbox', { name: /I agree/ }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
}

export async function skipOnboarding(page: Page) {
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await page.waitForURL((u) => u.pathname === '/');
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
