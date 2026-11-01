import { contrastRatio, ensureContrast } from './color.js';
import type { Theme, ThemeColors } from './schema.js';

export interface ContrastRule {
  fg: keyof ThemeColors;
  bg: keyof ThemeColors;
  min: number;
  label: string;
}

/** WCAG 2.2 AA: 4.5 for body text, 3 for large text / UI components. */
export const CONTRAST_RULES: ContrastRule[] = [
  { fg: 'textPrimary', bg: 'background', min: 4.5, label: 'Body text on background' },
  { fg: 'textPrimary', bg: 'surface', min: 4.5, label: 'Body text on surfaces' },
  { fg: 'textPrimary', bg: 'elevated', min: 4.5, label: 'Body text on menus and dialogs' },
  { fg: 'textSecondary', bg: 'background', min: 4.5, label: 'Secondary text on background' },
  { fg: 'textSecondary', bg: 'surface', min: 4.5, label: 'Secondary text on surfaces' },
  { fg: 'textTertiary', bg: 'background', min: 4.5, label: 'Hints and small print' },
  { fg: 'textTertiary', bg: 'surface', min: 4.5, label: 'Hints on surfaces' },
  { fg: 'textTertiary', bg: 'elevated', min: 4.5, label: 'Hints in menus and dialogs' },
  { fg: 'textSecondary', bg: 'elevated', min: 4.5, label: 'Secondary text in menus and dialogs' },
  { fg: 'accent', bg: 'elevated', min: 3, label: 'Accent in menus and dialogs' },
  { fg: 'accentForeground', bg: 'accent', min: 4.5, label: 'Text on accent buttons' },
  { fg: 'accent', bg: 'background', min: 3, label: 'Accent (links, focus rings) on background' },
  { fg: 'danger', bg: 'background', min: 3, label: 'Error color on background' },
  { fg: 'success', bg: 'background', min: 3, label: 'Success color on background' },
  { fg: 'warning', bg: 'background', min: 3, label: 'Warning color on background' },
  { fg: 'info', bg: 'background', min: 3, label: 'Info color on background' },
  { fg: 'code', bg: 'codeBackground', min: 4.5, label: 'Code text' },
  { fg: 'border', bg: 'background', min: 1.3, label: 'Borders are visible' },
];

export interface ContrastIssue extends ContrastRule {
  ratio: number;
}

export function checkContrast(colors: ThemeColors): ContrastIssue[] {
  return CONTRAST_RULES.map((r) => ({ ...r, ratio: contrastRatio(colors[r.fg], colors[r.bg]) })).filter((r) => r.ratio < r.min);
}

/**
 * Repair contrast failures by nudging the foreground color. Runs to a fixed point because one fix
 * (e.g. textPrimary vs surface) can interact with another rule using the same foreground.
 */
export function autoFixContrast(theme: Theme): { theme: Theme; fixed: (keyof ThemeColors)[] } {
  const colors = { ...theme.colors };
  const fixed = new Set<keyof ThemeColors>();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const rule of CONTRAST_RULES) {
      if (contrastRatio(colors[rule.fg], colors[rule.bg]) >= rule.min) continue;
      // For backgrounds that are tested against several foregrounds, prefer moving the foreground.
      colors[rule.fg] = ensureContrast(colors[rule.fg], colors[rule.bg], rule.min + 0.05);
      fixed.add(rule.fg);
      changed = true;
    }
    if (!changed) break;
  }
  return { theme: { ...theme, colors }, fixed: [...fixed] };
}
