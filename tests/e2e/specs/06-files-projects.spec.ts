import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN_EMAIL, signIn, signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test.describe.configure({ mode: 'serial' });
let page: Page;

test.beforeAll(async ({ browser }) => {
  // Admin turns on embeddings with the mock embedding model.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const admin = await ctx.newPage();
  await signIn(admin, ADMIN_EMAIL);
  await admin.waitForURL((u) => u.pathname === '/');
  await admin.goto('/admin/rag');
  await admin.getByLabel('Embedding model').selectOption({ label: 'mock-embed (mock-embed)' });
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Settings saved').first()).toBeVisible();
  await ctx.close();

  const userCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await userCtx.newPage();
  await signUp(page, { email: uniqueEmail('filer'), name: 'File User' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

test('attach a file in chat; the model sees its contents', async () => {
  await page.getByLabel('Choose files to attach').setInputFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('The launch code word is PELICAN.') });
  const chip = page.getByRole('list', { name: 'Attachments' }).getByText('memo.txt');
  await expect(chip).toBeVisible();
  await expect(page.getByRole('list', { name: 'Attachments' })).not.toContainText('Processing', { timeout: 15_000 });
  await page.getByRole('textbox', { name: 'Message' }).fill('what is in the memo?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.waitForURL(/\/c\//);
  const userMsg = page.getByRole('article', { name: 'Your message' }).last();
  await expect(userMsg.getByRole('link', { name: /memo\.txt/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /^Response/ }).last()).toContainText('what is in the memo?');
});

test('files page lists uploads with preview', async () => {
  await page.goto('/files');
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
  const row = page.getByRole('row', { name: /memo\.txt/ });
  await expect(row.getByText('Ready')).toBeVisible();
  await row.getByRole('button', { name: 'Preview memo.txt' }).click();
  await expect(page.getByRole('dialog', { name: 'memo.txt' })).toContainText('PELICAN');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('meter', { name: 'Storage' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target}`)).toEqual([]);
});

test('create a project from a template, add knowledge, and chat inside it', async () => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('radio', { name: /Research assistant/ }).click();
  await page.getByLabel('Name').fill('Ornithology');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Ornithology' })).toBeVisible();
  await expect(page.getByLabel('Project instructions')).toHaveValue(/research assistant/);

  await page.getByRole('button', { name: 'Add text' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add text to knowledge' });
  await dlg.getByLabel('Title').fill('Penguins');
  await dlg.getByLabel('Text', { exact: true }).fill('Emperor penguins huddle together to survive Antarctic winters.');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('row', { name: /Penguins\.md/ }).getByText('Ready')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('main').getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByRole('link', { name: 'Ornithology' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('How do emperor penguins survive winter?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.waitForURL(/\/c\//);
  await expect(page.getByRole('article', { name: /^Response/ }).last()).toContainText('emperor penguins');
  await page.getByRole('link', { name: 'Ornithology' }).click();
  await expect(page.getByRole('main').getByRole('link', { name: /emperor penguins/ })).toBeVisible();
});
