import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';
import { linkFrom, waitForMail } from '../support/mail.js';

test.describe.configure({ mode: 'serial' });
let page: Page;
const email = uniqueEmail('artist');

const composer = () => page.getByRole('textbox', { name: 'Message' });
const panel = () => page.getByRole('complementary', { name: /^Artifact:/ });
const frame = () => page.frameLocator('iframe[title="Artifact preview"]');

/** The mock model calls a tool when the message contains [tool:name {json}]. */
async function createArtifact(args: Record<string, unknown>) {
  await composer().fill(`please [tool:create_artifact ${JSON.stringify(args)}]`);
  await composer().press('Enter');
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  page = await ctx.newPage();
  await signUp(page, { email, name: 'Art User' });
  await skipOnboarding(page);
});
test.afterAll(() => page.context().close());

test('the model creates a document; it opens in the side panel and can be edited, diffed and restored', async () => {
  await createArtifact({ type: 'markdown', title: 'Trip plan', content: '# Trip\n\nDay one: museums.' });
  await page.waitForURL(/\/c\//);
  await expect(page.getByRole('button', { name: 'Created artifact: Trip plan. Open' })).toBeVisible();
  await expect(panel()).toBeVisible();
  await expect(panel().getByRole('heading', { name: 'Trip', exact: true })).toBeVisible();

  // Edit the source in the code editor and save a new version.
  await panel().getByRole('tab', { name: 'Source' }).click();
  const editor = panel().locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nDay two: beach.');
  await panel().getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText('Saved as a new version').first()).toBeVisible();
  await expect(panel().getByLabel('Version')).toHaveValue('2');

  // Compare versions, then restore the first one (which adds v3).
  await panel().getByRole('tab', { name: 'History' }).click();
  await panel().getByRole('button', { name: 'Compare version 2 with 1' }).click();
  await expect(panel().getByLabel('Changes between versions')).toContainText('+Day two: beach.');
  await panel().getByRole('button', { name: 'Restore version 1' }).click();
  await expect(page.getByText('Restored version 1').first()).toBeVisible();
  await expect(panel().getByLabel('Version')).toHaveValue('3');
  await panel().getByRole('tab', { name: 'Preview' }).click();
  await expect(panel()).not.toContainText('Day two');

  // Closing and reopening from the chat card.
  await panel().getByRole('button', { name: 'Close artifact' }).click();
  await expect(panel()).toBeHidden();
  await page.getByRole('button', { name: 'Created artifact: Trip plan. Open' }).click();
  await expect(panel()).toBeVisible();
});

test('HTML apps run sandboxed with no network, and can use AI-app storage through the bridge', async () => {
  const html = `<h1>Hello sandbox</h1><p id="c">?</p><p id="f">?</p><p id="s">?</p>
<script>
console.log('hi from app');
try { parent.document.title; document.getElementById('c').textContent = 'parent readable'; } catch (e) { document.getElementById('c').textContent = 'parent blocked'; }
fetch('/api/me').then(function () { document.getElementById('f').textContent = 'fetched'; }).catch(function () { document.getElementById('f').textContent = 'fetch blocked'; });
lumen.storage.set('visits', 41).then(function () { return lumen.storage.get('visits'); }).then(function (v) { document.getElementById('s').textContent = 'stored ' + v; });
</script>`;
  await createArtifact({ type: 'html', title: 'Sandbox probe', content: html });
  await expect(panel().getByRole('heading', { name: 'Sandbox probe' })).toBeVisible();
  await expect(frame().getByRole('heading', { name: 'Hello sandbox' })).toBeVisible();
  await expect(frame().locator('#c')).toHaveText('parent blocked');
  await expect(frame().locator('#f')).toHaveText('fetch blocked');
  await expect(frame().locator('#s')).toHaveText('stored 41');
  await panel().getByRole('button', { name: /Console/ }).click();
  await expect(panel().getByRole('list', { name: 'Console output' })).toContainText('hi from app');
});

test('React apps compile in the sandbox; runtime errors offer "Fix with AI"', async () => {
  await createArtifact({ type: 'react', title: 'Counter', content: "import { useState } from 'react';\nexport default function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>Count {n}</button>; }" });
  await expect(frame().getByRole('button', { name: 'Count 0' })).toBeVisible({ timeout: 15_000 });
  await frame().getByRole('button', { name: 'Count 0' }).click();
  await expect(frame().getByRole('button', { name: 'Count 1' })).toBeVisible();

  await createArtifact({ type: 'react', title: 'Broken', content: "export default function App() { throw new Error('kaboom'); }" });
  await expect(panel().getByRole('alert')).toContainText('kaboom');
  await panel().getByRole('button', { name: 'Fix with AI' }).click();
  await expect(page.getByRole('article', { name: 'Your message' }).last()).toContainText('kaboom');
});

test('charts render as accessible SVG with a table view and data export', async () => {
  const chart = { type: 'bar', title: 'Revenue', data: [{ q: 'Q1', web: 3, app: 4 }, { q: 'Q2', web: 5, app: 2 }], x: 'q', y: ['web', 'app'] };
  await createArtifact({ type: 'chart', title: 'Revenue chart', content: JSON.stringify(chart) });
  await expect(panel().getByRole('img', { name: /Revenue: bar chart of web, app/ })).toBeVisible();
  await expect(panel().getByRole('list', { name: 'Legend' })).toContainText('web');
  const download = page.waitForEvent('download');
  await panel().getByRole('button', { name: 'Download or export' }).click();
  await page.getByRole('menuitem', { name: 'Data (.csv)' }).click();
  expect((await download).suggestedFilename()).toBe('Revenue chart.csv');
  await panel().getByRole('button', { name: 'Table view' }).click();
  await expect(panel().getByRole('table')).toContainText('Q2');

  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target}`)).toEqual([]);
});

test('spreadsheets compute formulas and save cell edits as versions', async () => {
  await createArtifact({ type: 'spreadsheet', title: 'Budget', content: 'item,cost\nrent,1000\nfood,300\ntotal,=SUM(B2:B3)' });
  const grid = panel().getByRole('grid', { name: 'Spreadsheet' });
  await expect(grid).toContainText('1,300');
  await grid.getByRole('gridcell').nth(8 * 2 + 1).click(); // B3
  await page.keyboard.type('500');
  await page.keyboard.press('Enter');
  await expect(grid).toContainText('1,500');
  await expect(panel().getByLabel('Version')).toHaveValue('2');
});

test('the gallery lists, searches and filters artifacts', async () => {
  await page.goto('/artifacts');
  await expect(page.getByRole('heading', { name: 'Artifacts' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Your artifacts' });
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await page.getByRole('group', { name: 'Filter by type' }).getByRole('button', { name: 'Chart' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('group', { name: 'Filter by type' }).getByRole('button', { name: 'All' }).click();
  await page.getByLabel('Search artifacts').fill('trip');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByRole('button', { name: 'Open Trip plan' }).click();
  await expect(panel()).toBeVisible();
  await expect(page).toHaveURL(/open=/);

  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} @ ${v.nodes[0]?.target}`)).toEqual([]);
});

test('publishing needs a verified email; published artifacts are public and remixable', async ({ browser }) => {
  await panel().getByRole('button', { name: 'Share' }).click();
  await page.getByRole('menuitem', { name: 'Publish public link' }).click();
  await expect(page.getByText(/Verify your email to publish/).first()).toBeVisible();

  const mail = await waitForMail(email, /Verify your email/);
  await page.goto(linkFrom(mail.Text, '/verify-email'));
  await expect(page.getByText(/verified/i).first()).toBeVisible();
  await page.goto('/artifacts');
  await page.getByRole('list', { name: 'Your artifacts' }).getByRole('button', { name: 'Open Trip plan' }).click();
  await panel().getByRole('button', { name: 'Share' }).click();
  await page.getByRole('menuitem', { name: 'Publish public link' }).click();
  await expect(panel().getByRole('button', { name: 'Sharing: published' })).toBeVisible();
  const items = await page.evaluate(() => fetch('/api/artifacts?q=Trip').then((r) => r.json() as Promise<{ items: { publicSlug: string | null }[] }>));
  const slug = items.items[0]!.publicSlug!;
  expect(slug).toMatch(/^[\w-]{16,}$/);

  const anon = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const visitor = await anon.newPage();
  await visitor.goto(`/a/${slug}`);
  await expect(visitor.getByRole('heading', { name: 'Trip plan' })).toBeVisible();
  await expect(visitor.getByRole('heading', { name: 'Trip', exact: true })).toBeVisible();
  await visitor.goto(`/a/${slug}?embed=1`);
  await expect(visitor.getByRole('heading', { name: 'Trip', exact: true })).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Remix' })).toBeHidden();
  await visitor.goto(`/a/${slug}`);
  await visitor.getByRole('button', { name: 'Remix' }).click();
  await visitor.waitForURL(/\/login/);
  await anon.close();

  // Unpublishing breaks the link.
  await panel().getByRole('button', { name: 'Sharing: published' }).click();
  await page.getByRole('menuitem', { name: 'Unpublish' }).click();
  await expect(page.getByText(/Unpublished/).first()).toBeVisible();
  const res = await page.request.get(`/api/public/artifacts/${slug}`);
  expect(res.status()).toBe(404);
});
