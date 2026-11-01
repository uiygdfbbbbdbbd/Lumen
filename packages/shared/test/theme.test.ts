import { describe, expect, it } from 'vitest';
import {
  autoFixContrast,
  BUILTIN_THEMES,
  checkContrast,
  contrastRatio,
  cssVarsToString,
  ensureContrast,
  flatten,
  getBuiltinTheme,
  isDark,
  mix,
  parseHex,
  themeSchema,
  themeToCssVars,
  toHex,
  MAX_THEME_BYTES,
} from '../src/index.js';

describe('color utils', () => {
  it('parses and formats hex', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseHex('#ff800080').a).toBeCloseTo(0.5, 1);
    expect(toHex({ r: 255, g: 128, b: 0, a: 1 })).toBe('#ff8000');
    expect(toHex({ r: 300, g: -5, b: 0, a: 0.5 })).toBe('#ff000080');
    expect(() => parseHex('red')).toThrow();
  });
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });
  it('composites translucent colors', () => {
    expect(flatten(parseHex('#00000080'), parseHex('#ffffff')).r).toBeCloseTo(127, 0);
  });
  it('mixes and detects dark', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(isDark('#111111')).toBe(true);
    expect(isDark('#eeeeee')).toBe(false);
  });
  it('ensureContrast reaches targets on light and dark backgrounds', () => {
    const fixedLight = ensureContrast('#bbbbbb', '#ffffff', 4.5);
    expect(contrastRatio(fixedLight, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const fixedDark = ensureContrast('#333333', '#000000', 4.5);
    expect(contrastRatio(fixedDark, '#000000')).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast('#000000', '#ffffff', 4.5)).toBe('#000000');
    const mid = ensureContrast('#777777', '#777777', 4.5);
    expect(contrastRatio(mid, '#777777')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('built-in themes', () => {
  it('ships at least 12 themes with unique ids', () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BUILTIN_THEMES.map((b) => b.id)).size).toBe(BUILTIN_THEMES.length);
    expect(getBuiltinTheme('nord')?.name).toBe('Nord');
    expect(getBuiltinTheme('nope')).toBeUndefined();
  });
  for (const b of BUILTIN_THEMES) {
    it(`${b.id} passes every WCAG AA contrast rule`, () => {
      expect(checkContrast(b.theme.colors).map((i) => `${i.label}: ${i.ratio}`)).toEqual([]);
    });
  }
});

describe('theme schema', () => {
  const base = getBuiltinTheme('light')!;
  it('clamps numeric values instead of rejecting', () => {
    const t = themeSchema.parse({ ...base, typography: { ...base.typography, baseSize: 99, lineHeight: 0 }, radius: { sm: -4, md: 50, lg: 10 }, blur: 1000 });
    expect(t.typography.baseSize).toBe(20);
    expect(t.typography.lineHeight).toBe(1.2);
    expect(t.radius).toEqual({ sm: 0, md: 20, lg: 10 });
    expect(t.blur).toBe(24);
  });
  it('rejects non-hex colors, CSS injection, unknown fonts and URLs', () => {
    expect(themeSchema.safeParse({ ...base, colors: { ...base.colors, background: 'red' } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...base, colors: { ...base.colors, accent: '#fff;}body{display:none' } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...base, typography: { ...base.typography, fontSans: "x'); @import url(evil" } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...base, background: { type: 'image', assetId: 'https://evil/x.png', dim: 0.3 } }).success).toBe(false);
  });
  it('fills defaults for minimal input', () => {
    const t = themeSchema.parse({ name: 'Mini', mode: 'dark', colors: base.colors });
    expect(t.density).toBe('comfortable');
    expect(t.background).toEqual({ type: 'solid' });
    expect(JSON.stringify(t).length).toBeLessThan(MAX_THEME_BYTES);
  });
});

describe('contrast auto-fix', () => {
  it('repairs a low-contrast AI-style theme', () => {
    const base = getBuiltinTheme('light')!;
    const bad = { ...base, colors: { ...base.colors, textPrimary: '#cccccc', textSecondary: '#dddddd', accentForeground: '#6655ee', code: '#eeeeee' } };
    expect(checkContrast(bad.colors).length).toBeGreaterThan(0);
    const { theme, fixed } = autoFixContrast(bad);
    expect(checkContrast(theme.colors)).toEqual([]);
    expect(fixed).toEqual(expect.arrayContaining(['textPrimary', 'textSecondary', 'accentForeground', 'code']));
  });
  it('is a no-op on compliant themes', () => {
    const t = getBuiltinTheme('dark')!;
    expect(autoFixContrast(t).fixed).toEqual([]);
  });
});

describe('css variables', () => {
  it('picks a readable danger foreground', () => {
    expect(themeToCssVars(getBuiltinTheme('light')!)['--lm-danger-fg']).toBe('#ffffff');
    expect(themeToCssVars(getBuiltinTheme('dark')!)['--lm-danger-fg']).toBe('#000000');
  });
  it('maps tokens and gradients safely', () => {
    const vars = themeToCssVars(getBuiltinTheme('sunrise')!);
    expect(vars['--lm-bg']).toBe('#fff8f2');
    expect(vars['--lm-app-bg']).toMatch(/^linear-gradient\(160deg/);
    expect(cssVarsToString({ '--a': '1' }, '.x')).toBe('.x{--a:1}');
  });
  it('only accepts safe background asset URLs', () => {
    const t = { ...getBuiltinTheme('dark')!, background: { type: 'image' as const, assetId: '00000000-0000-4000-8000-000000000000', dim: 0.4 } };
    expect(themeToCssVars(t, { backgroundAssetUrl: '/api/theme-assets/a.webp' })['--lm-app-bg']).toContain('url("/api/theme-assets/a.webp")');
    expect(themeToCssVars(t, { backgroundAssetUrl: 'javascript:alert(1)' })['--lm-app-bg']).toBe(t.colors.background);
    expect(themeToCssVars(t, { backgroundAssetUrl: '/x") ; } body { ' })['--lm-app-bg']).toBe(t.colors.background);
  });
});
