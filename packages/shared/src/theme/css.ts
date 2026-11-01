import { contrastRatio, mix } from './color.js';

/** Black or white, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000';
}
import type { Theme } from './schema.js';

const DENSITY = { compact: 0.85, comfortable: 1, spacious: 1.2 } as const;
const SHADOWS = {
  none: ['none', 'none', 'none'],
  subtle: ['0 1px 2px rgb(0 0 0 / 0.06)', '0 4px 12px rgb(0 0 0 / 0.08)', '0 12px 32px rgb(0 0 0 / 0.12)'],
  medium: ['0 1px 3px rgb(0 0 0 / 0.12)', '0 6px 16px rgb(0 0 0 / 0.14)', '0 16px 40px rgb(0 0 0 / 0.2)'],
  strong: ['0 2px 4px rgb(0 0 0 / 0.2)', '0 8px 24px rgb(0 0 0 / 0.25)', '0 24px 56px rgb(0 0 0 / 0.35)'],
} as const;
const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  linear: 'linear',
  gentle: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;
const CHAT_WIDTH = { narrow: '40rem', normal: '48rem', wide: '60rem', full: '100%' } as const;

const fontStack = (f: string, mono: boolean) =>
  mono ? `'${f}', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` : `'${f}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

/**
 * Map a validated theme to CSS custom properties. Every value comes from a validated enum, clamped
 * number or hex color, so the output can't contain injected CSS.
 */
export function themeToCssVars(theme: Theme, opts: { backgroundAssetUrl?: string } = {}): Record<string, string> {
  const c = theme.colors;
  const v: Record<string, string> = {
    '--lm-bg': c.background,
    '--lm-surface': c.surface,
    '--lm-elevated': c.elevated,
    '--lm-border': c.border,
    '--lm-text': c.textPrimary,
    '--lm-text-2': c.textSecondary,
    '--lm-text-3': c.textTertiary,
    '--lm-accent': c.accent,
    '--lm-accent-fg': c.accentForeground,
    '--lm-accent-hover': mix(c.accent, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.12),
    '--lm-accent-soft': mix(c.accent, c.background, 0.85),
    '--lm-hover': mix(c.surface, c.textPrimary, 0.06),
    '--lm-success': c.success,
    '--lm-warning': c.warning,
    '--lm-danger': c.danger,
    '--lm-danger-fg': readableOn(c.danger),
    '--lm-info': c.info,
    '--lm-code': c.code,
    '--lm-code-bg': c.codeBackground,
    '--lm-selection': c.selection,
    '--lm-font-sans': fontStack(theme.typography.fontSans, false),
    '--lm-font-mono': fontStack(theme.typography.fontMono, true),
    '--lm-font-size-base': `${theme.typography.baseSize}px`,
    '--lm-font-scale': String(theme.typography.scale),
    '--lm-line-height': String(theme.typography.lineHeight),
    '--lm-font-weight-normal': String(theme.typography.weightNormal),
    '--lm-font-weight-bold': String(theme.typography.weightBold),
    '--lm-radius-sm': `${theme.radius.sm}px`,
    '--lm-radius-md': `${theme.radius.md}px`,
    '--lm-radius-lg': `${theme.radius.lg}px`,
    '--lm-density': String(DENSITY[theme.density]),
    '--lm-shadow-sm': SHADOWS[theme.shadow][0],
    '--lm-shadow-md': SHADOWS[theme.shadow][1],
    '--lm-shadow-lg': SHADOWS[theme.shadow][2],
    '--lm-blur': `${theme.blur}px`,
    '--lm-motion': String(theme.motion.durationScale),
    '--lm-ease': EASING[theme.motion.easing],
    '--lm-chat-width': CHAT_WIDTH[theme.chat.width],
    '--lm-color-scheme': theme.mode,
  };
  const bg = theme.background;
  if (bg.type === 'gradient') v['--lm-app-bg'] = `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
  else if (bg.type === 'image' && opts.backgroundAssetUrl && /^(https?:\/\/|\/)[^\s"'()]+$/.test(opts.backgroundAssetUrl)) {
    v['--lm-app-bg'] = `linear-gradient(rgb(0 0 0 / ${bg.dim}), rgb(0 0 0 / ${bg.dim})), url("${opts.backgroundAssetUrl}") center / cover`;
  } else v['--lm-app-bg'] = c.background;
  return v;
}

export function cssVarsToString(vars: Record<string, string>, selector = ':root'): string {
  return `${selector}{${Object.entries(vars)
    .map(([k, val]) => `${k}:${val}`)
    .join(';')}}`;
}
