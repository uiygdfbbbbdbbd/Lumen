/** Small, dependency-free color utilities (sRGB hex) for contrast checks and theme generation. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseHex(hex: string): Rgb {
  if (!HEX_RE.test(hex)) throw new Error(`invalid hex color: ${hex}`);
  const h = hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

const to2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

export function toHex({ r, g, b, a }: Rgb): string {
  return `#${to2(r)}${to2(g)}${to2(b)}${a < 1 ? to2(a * 255) : ''}`;
}

/** Composite a (possibly translucent) color over an opaque background. */
export function flatten(fg: Rgb, bg: Rgb): Rgb {
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.x contrast ratio (1..21). Translucent foregrounds are composited over the background first. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const bg = flatten(parseHex(bgHex), { r: 255, g: 255, b: 255, a: 1 });
  const fg = flatten(parseHex(fgHex), bg);
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function mix(aHex: string, bHex: string, t: number): string {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t });
}

/**
 * Move `fg` toward black or white (whichever direction increases contrast against `bg`) in small steps
 * until `target` is met. Keeps hue as much as possible; returns the original if already compliant.
 */
export function ensureContrast(fgHex: string, bgHex: string, target: number): string {
  if (contrastRatio(fgHex, bgHex) >= target) return fgHex;
  const bgLum = luminance(flatten(parseHex(bgHex), { r: 255, g: 255, b: 255, a: 1 }));
  const toward = bgLum > 0.18 ? '#000000' : '#ffffff';
  const opaque = toHex({ ...parseHex(fgHex), a: 1 });
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = mix(opaque, toward, t);
    if (contrastRatio(candidate, bgHex) >= target) return candidate;
  }
  // Fall back to the other extreme if the background sits in the middle of the luminance range.
  const other = toward === '#000000' ? '#ffffff' : '#000000';
  return contrastRatio(toward, bgHex) >= contrastRatio(other, bgHex) ? toward : other;
}

export function isDark(hex: string): boolean {
  return luminance(parseHex(hex)) < 0.18;
}
