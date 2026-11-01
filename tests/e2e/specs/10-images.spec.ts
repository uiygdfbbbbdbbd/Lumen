import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test.describe.configure({ mode: 'serial' });
let page: Page;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await ctx.newPage();
  await signUp(page, { email: uniqueEmail('painter'), name: 'Paint User' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

test('generate, vary and delete images on the Images page', async () => {
  await page.getByRole('link', { name: 'Images' }).click();
  await expect(page.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
  await page.getByLabel('Describe an image').fill('A lighthouse at dusk');
  await page.getByLabel('Aspect ratio').selectOption('16:9');
  await page.getByLabel('Images', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Generate' }).click();
  const gallery = page.getByRole('list', { name: 'Your images' });
  await expect(gallery.getByRole('img', { name: 'A lighthouse at dusk (mock)' })).toHaveCount(2);
  // The image really loads (a PNG from the provider, served from storage).
  await expect.poll(() => gallery.getByRole('img').first().evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await gallery.getByRole('button', { name: 'Make variations' }).first().click();
  await expect(gallery.getByRole('listitem')).toHaveCount(4, { timeout: 15_000 });
  await gallery.getByRole('button', { name: 'Delete image' }).first().click();
  await expect(gallery.getByRole('listitem')).toHaveCount(3);

  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target}`)).toEqual([]);
});

test('the AI can draw in chat', async () => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message' }).fill('draw [tool:generate_image {"prompt":"a red fox in snow"}]');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.waitForURL(/\/c\//);
  const images = page.getByRole('list', { name: 'Generated images' });
  await expect(images.getByRole('img', { name: 'a red fox in snow (mock)' })).toBeVisible();
});
