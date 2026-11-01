import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test.describe.configure({ mode: 'serial' });
let page: Page;

const composer = () => page.getByRole('textbox', { name: 'Message' });
const lastResponse = () => page.getByRole('article', { name: /^Response/ }).last();
const memories = () => page.getByRole('list', { name: 'Memories' });

async function newChat(text: string) {
  await page.goto('/');
  await composer().fill(text);
  await composer().press('Enter');
  await page.waitForURL(/\/c\//);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await ctx.newPage();
  await signUp(page, { email: uniqueEmail('rememberer'), name: 'Memo User' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

test('the AI saves a memory and later responses show which memories they used', async () => {
  await newChat('remember this [tool:memory_write {"content":"Prefers metric units.","category":"preferences"}]');
  await expect(lastResponse().getByText('Saved to memory: Prefers metric units.')).toBeVisible();

  await newChat('how far is 5 miles?');
  await expect(lastResponse()).toContainText('You said: how far is 5 miles?');
  await lastResponse().getByRole('button', { name: 'Memory used (1)' }).click();
  await expect(page.getByRole('dialog').getByText('Prefers metric units.')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('settings: edit, pin, add, search and delete with undo', async () => {
  await page.goto('/settings/memory');
  await expect(page.getByRole('heading', { name: 'Your memories' })).toBeVisible();
  const row = memories().getByRole('listitem').filter({ hasText: 'Prefers metric units.' });
  await expect(row).toContainText('Saved by AI');
  await expect(row.getByRole('link', { name: 'Source chat' })).toHaveAttribute('href', /\/c\//);

  await row.getByRole('button', { name: 'Edit memory' }).click();
  await memories().getByLabel('Memory text').fill('Prefers metric units and 24-hour time.');
  await memories().getByRole('button', { name: 'Save' }).click();
  const edited = memories().getByRole('listitem').filter({ hasText: '24-hour time' });
  await expect(edited).toBeVisible();
  await edited.getByRole('button', { name: 'Pin memory' }).click();
  await expect(edited.getByText('Pinned')).toBeVisible();

  await page.getByLabel('Add a memory').fill('Has a cat named Miso.');
  await page.getByLabel('Category', { exact: true }).first().selectOption('people');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(memories().getByText('Has a cat named Miso.')).toBeVisible();
  await page.getByLabel('Search memories').fill('miso');
  await expect(memories().getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Search memories').fill('');
  await expect(memories().getByRole('listitem')).toHaveCount(2);

  await memories().getByRole('listitem').filter({ hasText: 'Miso' }).getByRole('button', { name: 'Delete memory' }).click();
  await expect(memories().getByText('Has a cat named Miso.')).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(memories().getByText('Has a cat named Miso.')).toBeVisible();

  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target}`)).toEqual([]);
});

test('import another assistant’s memories after reviewing them', async () => {
  await page.getByLabel('Memories to import').fill('- Works as a product designer\n- My password is swordfish\n- Has a cat named Miso.');
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('list', { name: 'Import preview' });
  await expect(preview.getByRole('listitem')).toHaveCount(3);
  await expect(preview.getByRole('checkbox', { name: /swordfish/ })).toBeDisabled();
  await expect(preview).toContainText('Won’t import: looks like a password');
  await expect(preview.getByRole('checkbox', { name: /Miso/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Import 1 selected' }).click();
  await expect(page.getByText('Imported 1 memory').first()).toBeVisible();
  await expect(memories().getByText('Works as a product designer')).toBeVisible();
});

test('tidy up writes a summary; pausing memory and forgetting everything', async () => {
  await page.getByRole('button', { name: 'Tidy up now' }).click();
  await expect(page.getByText('Memory tidied up').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();

  await page.getByRole('switch', { name: 'Use memory' }).click();
  await expect(page.getByText('Memory is paused.')).toBeVisible();
  await page.getByRole('switch', { name: 'Use memory' }).click();
  await expect(page.getByText('Memory is paused.')).toBeHidden();

  await page.getByRole('button', { name: 'Forget everything' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forget everything?' });
  await expect(dialog.getByRole('button', { name: 'Forget everything' })).toBeDisabled();
  await dialog.getByRole('textbox').fill('forget everything');
  await dialog.getByRole('button', { name: 'Forget everything' }).click();
  await expect(page.getByText(/Forgot \d+ memories/).first()).toBeVisible();
  await expect(page.getByText('Nothing remembered yet')).toBeVisible();
});

test('a chat can opt out of memory from its menu', async () => {
  await newChat('hello again');
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: 'Don’t use memory in this chat' }).click();
  await page.getByRole('button', { name: 'Chat options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Use memory in this chat' })).toBeVisible();
  await page.keyboard.press('Escape');
});
