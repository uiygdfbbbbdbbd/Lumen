import { expect, test, type Page } from '@playwright/test';
import { signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test.describe.configure({ mode: 'serial' });
let page: Page;

async function ask(text: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.waitForURL(/\/c\//);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await ctx.newPage();
  await signUp(page, { email: uniqueEmail('coder'), name: 'Code User' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

test('Python runs in the browser with Pyodide and the output can be shared', async () => {
  test.setTimeout(90_000);
  await ask('[tool:run_code {"language":"python","code":"import statistics\\nprint(statistics.mean([2, 4, 9]))\\nsum(range(10))"}]');
  const card = page.getByRole('region', { name: 'Python code to run' });
  await expect(card.getByText('Runs in your browser · sandboxed · no network')).toBeVisible();
  await card.getByRole('button', { name: 'Run' }).click();
  const out = card.getByLabel('Output');
  await expect(out).toContainText('5', { timeout: 60_000 });
  await expect(out).toContainText('→ 45');
  await expect(out).toContainText(/Finished in/);
  await card.getByRole('button', { name: 'Share output with AI' }).click();
  await expect(page.getByRole('article', { name: 'Your message' }).last()).toContainText('Here’s the output of the python code');
});

test('JavaScript runs without network access and can be stopped', async () => {
  await ask('[tool:run_code {"language":"javascript","code":"console.log(6 * 7); try { await fetch(\\"https://example.com\\"); } catch (e) { console.error(e.message) } return \\"ok\\""}]');
  const card = page.getByRole('region', { name: 'JavaScript code to run' });
  await card.getByRole('button', { name: 'Run' }).click();
  const out = card.getByLabel('Output');
  await expect(out).toContainText('42');
  await expect(out).toContainText('Network access is disabled');
  await expect(out).toContainText('→ ok');

  await ask('[tool:run_code {"language":"javascript","code":"while (true) {}"}]');
  const loop = page.getByRole('region', { name: 'JavaScript code to run' });
  await loop.getByRole('button', { name: 'Run' }).click();
  await loop.getByRole('button', { name: 'Stop' }).click();
  await expect(loop.getByLabel('Output')).toContainText('Stopped.');
});
