import { autoFixContrast } from './contrast.js';
import { themeSchema, type Theme, type ThemeColors, type ThemeInput } from './schema.js';

function t(id: string, input: Omit<ThemeInput, 'schemaVersion'>): BuiltinTheme {
  // Built-ins go through the same contrast repair as user and AI themes, so they always meet WCAG AA.
  return { id, builtin: true, theme: autoFixContrast(themeSchema.parse({ schemaVersion: 1, ...input })).theme };
}

export interface BuiltinTheme {
  id: string;
  builtin: true;
  theme: Theme;
}

const light: ThemeColors = {
  background: '#fbfbfd',
  surface: '#f3f3f7',
  elevated: '#ffffff',
  border: '#d4d4de',
  textPrimary: '#16161d',
  textSecondary: '#4a4a5a',
  textTertiary: '#767686',
  accent: '#5b4bdb',
  accentForeground: '#ffffff',
  success: '#17803d',
  warning: '#a35a00',
  danger: '#c62a2f',
  info: '#1d6fb8',
  code: '#24292f',
  codeBackground: '#f1f1f5',
  selection: '#5b4bdb33',
};

const dark: ThemeColors = {
  background: '#131318',
  surface: '#1b1b22',
  elevated: '#24242d',
  border: '#33333f',
  textPrimary: '#ececf1',
  textSecondary: '#b4b4c2',
  textTertiary: '#8c8c9c',
  accent: '#8b7dff',
  accentForeground: '#0f0f14',
  success: '#4ccb7a',
  warning: '#f0a541',
  danger: '#ff6b6b',
  info: '#5aaef5',
  code: '#e6edf3',
  codeBackground: '#1e1e26',
  selection: '#8b7dff40',
};

export const BUILTIN_THEMES: BuiltinTheme[] = [
  t('light', { name: 'Light', description: 'Clean and bright.', mode: 'light', colors: light, codeTheme: 'github-light' }),
  t('dark', { name: 'Dark', description: 'Easy on the eyes at night.', mode: 'dark', colors: dark, codeTheme: 'github-dark' }),
  t('midnight', {
    name: 'Midnight',
    description: 'Deep blue-black with cool accents.',
    mode: 'dark',
    colors: { ...dark, background: '#0b0e17', surface: '#111626', elevated: '#182035', border: '#26304a', accent: '#6ea8ff', accentForeground: '#08101f', codeBackground: '#0f1424' },
    codeTheme: 'one-dark',
  }),
  t('paper', {
    name: 'Paper',
    description: 'Warm off-white, bookish serif.',
    mode: 'light',
    colors: { ...light, background: '#faf7f0', surface: '#f2ede1', elevated: '#fffdf8', border: '#ddd5c3', textPrimary: '#2b2620', textSecondary: '#574e43', textTertiary: '#7a6f61', accent: '#9a4a1e', codeBackground: '#f0eadb' },
    typography: { fontSans: 'Literata', fontMono: 'IBM Plex Mono', baseSize: 16, scale: 1.2, lineHeight: 1.7, weightNormal: 400, weightBold: 600 },
    chat: { width: 'narrow', messageStyle: 'flat' },
    codeTheme: 'min-light',
  }),
  t('high-contrast', {
    name: 'High contrast',
    description: 'Maximum legibility (WCAG AAA text).',
    mode: 'dark',
    colors: {
      background: '#000000', surface: '#0a0a0a', elevated: '#141414', border: '#ffffff', textPrimary: '#ffffff', textSecondary: '#f0f0f0',
      textTertiary: '#d0d0d0', accent: '#ffd400', accentForeground: '#000000', success: '#3dff7a', warning: '#ffb000', danger: '#ff5c5c',
      info: '#5cc8ff', code: '#ffffff', codeBackground: '#0a0a0a', selection: '#ffd40066',
    },
    shadow: 'none',
    typography: { fontSans: 'Atkinson Hyperlegible', fontMono: 'JetBrains Mono', baseSize: 16, scale: 1.2, lineHeight: 1.6, weightNormal: 400, weightBold: 700 },
    codeTheme: 'high-contrast',
  }),
  t('solarized-light', {
    name: 'Solarized Light',
    description: 'The classic precision palette, light.',
    mode: 'light',
    colors: { background: '#fdf6e3', surface: '#eee8d5', elevated: '#fffbef', border: '#d6cfb8', textPrimary: '#073642', textSecondary: '#3b5560', textTertiary: '#657b83', accent: '#1f6fa8', accentForeground: '#ffffff', success: '#5f7700', warning: '#9a5f00', danger: '#c0302c', info: '#1f6fa8', code: '#073642', codeBackground: '#eee8d5', selection: '#268bd233' },
    codeTheme: 'solarized-light',
  }),
  t('solarized-dark', {
    name: 'Solarized Dark',
    description: 'The classic precision palette, dark.',
    mode: 'dark',
    colors: { background: '#002b36', surface: '#073642', elevated: '#0b4250', border: '#245360', textPrimary: '#eee8d5', textSecondary: '#b5c0bd', textTertiary: '#93a1a1', accent: '#2aa198', accentForeground: '#002b36', success: '#859900', warning: '#d9a400', danger: '#ff6a5f', info: '#4aa3e8', code: '#eee8d5', codeBackground: '#073642', selection: '#2aa19840' },
    codeTheme: 'solarized-dark',
  }),
  t('nord', {
    name: 'Nord',
    description: 'Arctic, north-bluish calm.',
    mode: 'dark',
    colors: { background: '#2e3440', surface: '#3b4252', elevated: '#434c5e', border: '#4c566a', textPrimary: '#eceff4', textSecondary: '#d8dee9', textTertiary: '#b2bccb', accent: '#88c0d0', accentForeground: '#1f242d', success: '#a3be8c', warning: '#ebcb8b', danger: '#ef8f97', info: '#8fbcbb', code: '#eceff4', codeBackground: '#3b4252', selection: '#88c0d040' },
    codeTheme: 'nord',
  }),
  t('rose', {
    name: 'Rose',
    description: 'Soft pinks with a warm accent.',
    mode: 'light',
    colors: { ...light, background: '#fff7f9', surface: '#fbecf0', elevated: '#ffffff', border: '#f0d3db', textPrimary: '#2a1a20', textSecondary: '#5c4149', textTertiary: '#86666f', accent: '#b8326a', codeBackground: '#f9e7ec' },
    radius: { sm: 8, md: 14, lg: 22 },
    chat: { width: 'normal', messageStyle: 'bubbles' },
    codeTheme: 'min-light',
  }),
  t('forest', {
    name: 'Forest',
    description: 'Mossy greens and bark browns.',
    mode: 'dark',
    colors: { ...dark, background: '#121a15', surface: '#18231c', elevated: '#1f2d24', border: '#2c3e32', textPrimary: '#e6efe8', textSecondary: '#b5c7ba', textTertiary: '#8fa596', accent: '#7cc48f', accentForeground: '#0c140f', codeBackground: '#16201a' },
    codeTheme: 'one-dark',
  }),
  t('terminal', {
    name: 'Terminal',
    description: 'Green phosphor on black. Monospace everything.',
    mode: 'dark',
    colors: { background: '#050805', surface: '#0a100a', elevated: '#101810', border: '#1f3a1f', textPrimary: '#c8ffc8', textSecondary: '#8fe08f', textTertiary: '#66b366', accent: '#39ff14', accentForeground: '#021002', success: '#39ff14', warning: '#ffd23f', danger: '#ff5555', info: '#5fd7ff', code: '#c8ffc8', codeBackground: '#0a100a', selection: '#39ff1440' },
    typography: { fontSans: 'system-ui', fontMono: 'JetBrains Mono', baseSize: 14, scale: 1.15, lineHeight: 1.5, weightNormal: 400, weightBold: 700 },
    radius: { sm: 0, md: 2, lg: 4 },
    shadow: 'none',
    codeTheme: 'monokai',
  }),
  t('sepia', {
    name: 'Sepia',
    description: 'Low-glare reading mode.',
    mode: 'light',
    colors: { ...light, background: '#f4ecd8', surface: '#ebe1c8', elevated: '#f9f3e3', border: '#d3c6a6', textPrimary: '#3b2f1e', textSecondary: '#5e4d35', textTertiary: '#7d6a4f', accent: '#8a4b14', codeBackground: '#e9dfc4' },
    typography: { fontSans: 'Georgia', fontMono: 'IBM Plex Mono', baseSize: 16, scale: 1.2, lineHeight: 1.75, weightNormal: 400, weightBold: 600 },
    codeTheme: 'min-light',
  }),
  t('ocean', {
    name: 'Ocean',
    description: 'Teal depths and sea-glass highlights.',
    mode: 'dark',
    colors: { ...dark, background: '#0c1a20', surface: '#11242c', elevated: '#173039', border: '#22424d', textPrimary: '#e3f4f7', textSecondary: '#acd0d8', textTertiary: '#86adb6', accent: '#3fd0c9', accentForeground: '#06171a', codeBackground: '#0f2128' },
    codeTheme: 'one-dark',
  }),
  t('sunrise', {
    name: 'Sunrise',
    description: 'Peach and coral with a gentle gradient.',
    mode: 'light',
    colors: { ...light, background: '#fff8f2', surface: '#ffeee2', elevated: '#ffffff', border: '#f3d7c4', textPrimary: '#2c1b12', textSecondary: '#5f4334', textTertiary: '#8a6a59', accent: '#c2410c', codeBackground: '#fdeadf' },
    background: { type: 'gradient', from: '#fff8f2', to: '#ffe9dc', angle: 160 },
    codeTheme: 'min-light',
  }),
];

export const DEFAULT_LIGHT_THEME_ID = 'light';
export const DEFAULT_DARK_THEME_ID = 'dark';

export function getBuiltinTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.find((b) => b.id === id)?.theme;
}
