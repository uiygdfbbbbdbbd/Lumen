import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await ctx.newPage();
  await signUp(page, { email: uniqueEmail('chatter'), name: 'Chat Tester' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

const composer = () => page.getByRole('textbox', { name: 'Message' });
const lastResponse = () => page.getByRole('article', { name: /^Response/ }).last();

async function sendText(text: string) {
  await composer().fill(text);
  await composer().press('Enter');
}

test('send a message, stream the reply, auto-title the chat', async () => {
  await expect(page.getByRole('heading', { name: /Chat/ })).toBeVisible();
  await sendText('hello there **friend** and `code`');
  await page.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  await expect(lastResponse()).toContainText('You said: hello there friend and code');
  await expect(lastResponse().locator('strong')).toHaveText('friend');
  await expect(lastResponse().locator('code')).toHaveText('code');
  await expect(lastResponse()).toContainText('mock-fast');
  // Auto-title appears in the sidebar.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /You said/ })).toBeVisible();
});

test('tool calls render as an expandable card', async () => {
  await sendText('what is [tool:calculator {"expression":"6*7"}]');
  await expect(lastResponse()).toContainText('Tool calculator returned: 6*7 = 42');
  const card = lastResponse().getByRole('button', { name: /calculator/ });
  await card.click();
  await expect(lastResponse().getByText('"expression": "6*7"')).toBeVisible();
});

test('edit a message to branch, then navigate between versions', async () => {
  await sendText('original question');
  await expect(lastResponse()).toContainText('You said: original question');
  const userMsg = page.getByRole('article', { name: 'Your message' }).last();
  await userMsg.hover();
  await userMsg.getByRole('button', { name: 'Edit message' }).click();
  await page.getByRole('textbox', { name: 'Edit message' }).fill('edited question');
  await page.getByRole('button', { name: 'Save & resend' }).click();
  await expect(lastResponse()).toContainText('You said: edited question');
  const versions = page.getByRole('article', { name: 'Your message' }).last().getByRole('group', { name: 'Versions' });
  await expect(versions).toContainText('2 / 2');
  await versions.getByRole('button', { name: 'Previous version' }).click();
  await expect(lastResponse()).toContainText('You said: original question');
});

test('regenerate creates a second version of the response', async () => {
  await lastResponse().hover();
  await lastResponse().getByRole('button', { name: 'Regenerate' }).click();
  await expect(lastResponse().getByRole('group', { name: 'Versions' })).toContainText('2 / 2');
});

test('stop a slow response', async () => {
  await sendText('one two three four five six seven eight nine ten [slow:400]');
  await expect(lastResponse()).toContainText('You said');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(lastResponse()).toContainText('Stopped.');
});

test('provider errors show a clear message with retry', async () => {
  await sendText('break please [error:400]');
  await expect(lastResponse().getByRole('alert')).toContainText('The response failed');
  await expect(lastResponse().getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(lastResponse().getByRole('button', { name: 'Try another model' })).toBeVisible();
});

test('command palette finds chats by content and navigates', async () => {
  const before = page.url();
  await page.goto('/');
  await sendText('the quokka is a small marsupial');
  await page.waitForURL((u) => u.href !== before && /\/c\//.test(u.pathname));
  await expect(lastResponse()).toContainText('quokka');
  const quokkaUrl = page.url();
  await page.goto(before);
  await expect(lastResponse()).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('combobox', { name: 'Search commands and chats' });
  await palette.fill('quokka');
  await expect(page.getByRole('option').filter({ hasText: 'quokka' }).first()).toBeVisible();
  await palette.press('ArrowDown');
  const target = page.getByRole('option', { name: /quokka/ }).first();
  await target.click();
  await page.waitForURL(quokkaUrl);
});

test('delete a chat and undo', async () => {
  const url = page.url();
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForURL(url);
  await expect(lastResponse()).toContainText('quokka');
});

test('temporary chats are labeled and stay out of the history list', async () => {
  await page.goto('/temporary');
  await expect(page.getByRole('heading', { name: 'Temporary chat', level: 2 })).toBeVisible();
  await sendText('secret temporary note');
  await expect(lastResponse()).toContainText('secret temporary note');
  await expect(page.getByText('Temporary — not saved to history')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /secret temporary/ })).toHaveCount(0);
});

test('keyboard shortcut help opens with ?', async () => {
  await page.goto('/');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('Shift+Escape');
  await expect(composer()).toBeFocused();
  await page.locator('h2').first().click();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('chat pages have no serious accessibility violations', async () => {
  await page.goto('/');
  await sendText('accessibility check');
  await expect(lastResponse()).toContainText('accessibility check');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});
