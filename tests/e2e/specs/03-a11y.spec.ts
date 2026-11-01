import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signUp, skipOnboarding, uniqueEmail } from '../support/helpers.js';

async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${name}: ${v.id} — ${v.help} @ ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test('public pages have no serious accessibility violations', async ({ page }) => {
  for (const path of ['/login', '/signup', '/forgot-password', '/reset-password']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await scan(page, path);
  }
});

for (const mode of ['light', 'dark', 'high-contrast'] as const) {
  test(`app pages are accessible in ${mode}`, async ({ page }) => {
    await signUp(page, { email: uniqueEmail(`a11y-${mode}`) });
    await scan(page, 'onboarding');
    await skipOnboarding(page);
    if (mode !== 'light') {
      await page.goto('/settings/appearance');
      await page.getByRole('radio', { name: /^Dark/ }).click();
      await page.getByRole('button', { name: mode === 'dark' ? /^Dark theme/ : /High contrast theme/ }).click();
    }
    for (const path of ['/', '/settings/account', '/settings/security', '/settings/appearance', '/settings/usage', '/settings/privacy']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await scan(page, `${mode} ${path}`);
    }
  });
}
