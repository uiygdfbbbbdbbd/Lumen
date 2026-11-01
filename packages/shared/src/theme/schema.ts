import { z } from 'zod';
import { HEX_RE } from './color.js';

export const SAFE_SANS_FONTS = ['Inter', 'system-ui', 'Atkinson Hyperlegible', 'IBM Plex Sans', 'Source Sans 3', 'Nunito', 'Lexend', 'Georgia', 'Literata', 'Merriweather'] as const;
export const SAFE_MONO_FONTS = ['JetBrains Mono', 'ui-monospace', 'IBM Plex Mono', 'Fira Code', 'Source Code Pro', 'Cascadia Code'] as const;
export const CODE_THEMES = ['github-light', 'github-dark', 'one-dark', 'solarized-light', 'solarized-dark', 'nord', 'dracula', 'monokai', 'min-light', 'high-contrast'] as const;
export const EASINGS = ['standard', 'emphasized', 'linear', 'gentle'] as const;

const hex = z.string().regex(HEX_RE, 'Use a hex color like #1a2b3c');
const clampNum = (min: number, max: number, def: number) =>
  z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : v), z.number()).default(def);

export const themeColorsSchema = z.object({
  background: hex,
  surface: hex,
  elevated: hex,
  border: hex,
  textPrimary: hex,
  textSecondary: hex,
  textTertiary: hex,
  accent: hex,
  accentForeground: hex,
  success: hex,
  warning: hex,
  danger: hex,
  info: hex,
  code: hex,
  codeBackground: hex,
  selection: hex,
});
export type ThemeColors = z.infer<typeof themeColorsSchema>;
export const COLOR_KEYS = Object.keys(themeColorsSchema.shape) as (keyof ThemeColors)[];

/**
 * Themes are data only: tokens plus at most one referenced, server-hosted background asset.
 * No CSS, no URLs, no scripts. Numeric values are clamped instead of rejected so AI output is repairable.
 */
export const themeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  mode: z.enum(['light', 'dark']),
  colors: themeColorsSchema,
  typography: z
    .object({
      fontSans: z.enum(SAFE_SANS_FONTS).default('Inter'),
      fontMono: z.enum(SAFE_MONO_FONTS).default('JetBrains Mono'),
      baseSize: clampNum(13, 20, 15),
      scale: clampNum(1.1, 1.4, 1.2),
      lineHeight: clampNum(1.2, 2, 1.6),
      weightNormal: clampNum(300, 500, 400),
      weightBold: clampNum(500, 800, 600),
    })
    .default({ fontSans: 'Inter', fontMono: 'JetBrains Mono', baseSize: 15, scale: 1.2, lineHeight: 1.6, weightNormal: 400, weightBold: 600 }),
  radius: z.object({ sm: clampNum(0, 12, 6), md: clampNum(0, 20, 10), lg: clampNum(0, 32, 16) }).default({ sm: 6, md: 10, lg: 16 }),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  shadow: z.enum(['none', 'subtle', 'medium', 'strong']).default('subtle'),
  blur: clampNum(0, 24, 8),
  motion: z.object({ durationScale: clampNum(0, 2, 1), easing: z.enum(EASINGS).default('standard') }).default({ durationScale: 1, easing: 'standard' }),
  chat: z
    .object({ width: z.enum(['narrow', 'normal', 'wide', 'full']).default('normal'), messageStyle: z.enum(['bubbles', 'flat']).default('flat') })
    .default({ width: 'normal', messageStyle: 'flat' }),
  codeTheme: z.enum(CODE_THEMES).default('github-dark'),
  background: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('solid') }),
      z.object({ type: z.literal('gradient'), from: hex, to: hex, angle: clampNum(0, 360, 180) }),
      /** References an asset uploaded to and re-encoded by the server; never a URL. */
      z.object({ type: z.literal('image'), assetId: z.string().uuid(), dim: clampNum(0, 0.9, 0.4) }),
    ])
    .default({ type: 'solid' }),
});

export type Theme = z.infer<typeof themeSchema>;
export type ThemeInput = z.input<typeof themeSchema>;

/** Max serialized size of a theme document (prevents abuse via giant payloads). */
export const MAX_THEME_BYTES = 16 * 1024;
