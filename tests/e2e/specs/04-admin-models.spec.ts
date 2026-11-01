import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, signIn, signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

const MOCK_KEY = 'sk-e2e-mock-key-0001';

test.describe.configure({ mode: 'serial' });

test('admin adds a provider, tests it, imports and enables models; key is never shown again', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.waitForURL((u) => u.pathname === '/');
  await page.getByRole('link', { name: 'Admin' }).click();
  await page.waitForURL('**/admin/providers');

  await page.getByRole('button', { name: 'Add provider' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add provider' });
  await dialog.getByLabel('Type').selectOption('openai');
  await dialog.getByLabel('Name').fill('Mock Cloud');
  await dialog.getByLabel('Description').fill('Deterministic E2E provider');
  await dialog.getByLabel('Base API URL').fill('http://127.0.0.1:4010/v1');
  await dialog.getByLabel('API key').fill(MOCK_KEY);
  await dialog.getByRole('switch', { name: 'Allow private network address' }).click();
  await dialog.getByRole('button', { name: 'Add provider' }).click();
  await expect(dialog).toBeHidden();

  const card = page.locator('li', { hasText: 'Mock Cloud' });
  await card.getByRole('button', { name: 'Test' }).click();
  await expect(card.getByText(/Connected in \d+ ms/)).toBeVisible();
  await expect(card.getByText(/Found 6 models/)).toBeVisible();
  await card.getByRole('button', { name: 'Import models' }).click();
  await expect(page.getByText('Imported 6 new models').first()).toBeVisible();

  // Editing shows only the masked key with a "Replace key" flow.
  await card.getByRole('button', { name: 'Edit Mock Cloud' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Mock Cloud' });
  await expect(edit.getByText('sk-••••0001')).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Replace key' })).toBeVisible();
  expect(await page.content()).not.toContain(MOCK_KEY);
  await edit.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Models' }).click();
  await page.getByRole('switch', { name: 'Enable mock-fast' }).click();
  await page.getByRole('switch', { name: 'Enable mock-smart' }).click();
  await page.getByRole('switch', { name: 'Enable mock-image' }).click();
  await expect(page.getByRole('switch', { name: 'Enable mock-image' })).toBeChecked();
  await page.getByRole('switch', { name: 'Recommend mock-smart' }).click();
  await page.getByLabel('Visibility of mock-smart').selectOption('verified');
  await expect(page.getByRole('switch', { name: 'Enable mock-smart' })).toBeChecked();
});

test('users see enabled models in the selector with locks, search and favorites', async ({ page }) => {
  await signUp(page, { email: uniqueEmail('picker') });
  await skipOnboarding(page);
  await page.goto('/settings/chat');
  await page.getByRole('button', { name: /^Model:/ }).click();
  const list = page.getByRole('listbox', { name: 'Models' });
  await expect(list.getByRole('option', { name: /mock-fast/ })).toBeVisible();
  const smart = list.getByRole('option', { name: /mock-smart/ });
  await expect(smart).toHaveAttribute('aria-disabled', 'true');
  await expect(smart).toContainText('Verify email to unlock');
  await expect(list.getByRole('option', { name: /mock-reasoning/ })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Search models' }).fill('fast');
  await expect(list.getByRole('option')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Search models' }).press('Alt+f');
  await page.getByRole('combobox', { name: 'Search models' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Model: mock-fast' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Model: mock-fast' })).toBeVisible();
  await page.getByRole('button', { name: 'Model: mock-fast' }).click();
  await expect(page.getByRole('group', { name: 'Favorites' })).toContainText('mock-fast');
});

test('admin pages and the model selector are accessible', async ({ page }) => {
  const AxeBuilder = (await import('@axe-core/playwright')).default;
  const scan = async (name: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${name}: ${v.id} @ ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  };
  await signIn(page, ADMIN_EMAIL);
  await page.waitForURL((u) => u.pathname === '/');
  for (const path of ['/admin/providers', '/admin/models']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await scan(path);
  }
  await page.goto('/settings/chat');
  await page.getByRole('button', { name: /^Model:/ }).click();
  await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible();
  await scan('model selector');
});
