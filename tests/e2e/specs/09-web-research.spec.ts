import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN_EMAIL, signIn, signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';
import { linkFrom, waitForMail } from '../support/mail.js';

test.describe.configure({ mode: 'serial' });
let page: Page;
const email = uniqueEmail('researcher');

const composer = () => page.getByRole('textbox', { name: 'Message' });
const lastResponse = () => page.getByRole('article', { name: /^Response/ }).last();
async function newChat(text: string) {
  await page.goto('/');
  await composer().fill(text);
  await composer().press('Enter');
  await page.waitForURL(/\/c\//);
}
const axe = async (p: Page) => {
  const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target}`)).toEqual([]);
};

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const admin = await ctx.newPage();
  await signIn(admin, ADMIN_EMAIL);
  await admin.waitForURL((u) => u.pathname === '/');
  await admin.goto('/admin/web');
  await admin.getByLabel('Search provider').selectOption('searxng');
  await admin.getByLabel('SearXNG URL').fill('http://127.0.0.1:4020');
  await admin.getByRole('button', { name: 'Save web search' }).click();
  await expect(admin.getByText('Web search settings saved').first()).toBeVisible();
  await admin.getByRole('button', { name: 'Test search' }).click();
  await expect(admin.getByText(/Search works/)).toBeVisible();
  await expect(admin.getByText('How Tides Work')).toBeVisible();
  await axe(admin);
  await ctx.close();

  const userCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await userCtx.newPage();
  await signUp(page, { email, name: 'Research User' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

test('web search results are cited with links to the pages', async () => {
  await newChat('[tool:web_search {"query":"tides"}]');
  await expect(lastResponse().getByText('Searched the web for “tides”')).toBeVisible();
  await expect(lastResponse().getByText('4 results')).toBeVisible();
  await expect(lastResponse().getByRole('button', { name: 'Source 1: How Tides Work' }).first()).toBeVisible();
  await lastResponse().getByText('4 sources').click();
  await expect(lastResponse().getByRole('link', { name: /\[2\] The Moon and the Sea/ })).toHaveAttribute('href', 'http://127.0.0.1:4020/moon');
});

test('clarifying questions are answered with a click', async () => {
  await newChat('[tool:ask_user {"question":"Which coast?","options":[{"label":"Atlantic"},{"label":"Pacific","description":"West coast"}]}]');
  const card = page.getByRole('group', { name: 'Which coast?' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Atlantic/ }).click();
  await expect(page.getByRole('article', { name: 'Your message' }).last()).toContainText('Atlantic');
  await expect(lastResponse()).toContainText('You said: Atlantic');
  await expect(card.getByText(/^Answer(ed| sent)\.$/)).toBeVisible();
  await expect(card.getByRole('button', { name: /Pacific/ })).toBeDisabled();
});

test('inline charts render in the reply', async () => {
  await newChat('[tool:show_chart {"type":"bar","title":"Tide heights","data":[{"day":"Mon","m":2.1},{"day":"Tue","m":2.4}],"x":"day","y":["m"]}]');
  await expect(lastResponse().getByRole('img', { name: /Tide heights: bar chart/ })).toBeVisible();
  await axe(page);
});

test('Deep Research needs a verified email, then writes a cited report', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deep research' }).click();
  await expect(page.getByText('Verify your email to use Deep Research.')).toBeVisible();
  await page.keyboard.press('Escape');

  const mail = await waitForMail(email, /Verify your email/);
  await page.goto(linkFrom(mail.Text, '/verify-email'));
  await expect(page.getByText(/verified/i).first()).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Deep research' }).click();
  await page.getByRole('radio', { name: /Quick/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Deep research: quick' })).toBeVisible();
  await composer().fill('How do tides work?');
  await composer().press('Enter');
  await page.waitForURL(/\/c\//);

  await expect(lastResponse()).toContainText('across 3 sources', { timeout: 30_000 });
  await expect(lastResponse().getByText(/Deep research · 3 sources/)).toBeVisible();
  await expect(lastResponse().getByRole('button', { name: /Created artifact: Research: How do tides work\?/ })).toBeVisible();
  const panel = page.getByRole('complementary', { name: /^Artifact:/ });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Sources');
  await lastResponse().getByText('3 sources', { exact: true }).click();
  await expect(lastResponse().getByRole('link', { name: /An Independent Review of Tide Science/ })).toBeVisible();
});
