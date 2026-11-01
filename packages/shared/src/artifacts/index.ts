import { z } from 'zod';

export const ARTIFACT_TYPES = ['markdown', 'code', 'html', 'react', 'svg', 'mermaid', 'chart', 'table', 'slides', 'spreadsheet', 'latex'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  markdown: 'Document',
  code: 'Code',
  html: 'Web page',
  react: 'React app',
  svg: 'SVG image',
  mermaid: 'Diagram',
  chart: 'Chart',
  table: 'Table',
  slides: 'Slides',
  spreadsheet: 'Spreadsheet',
  latex: 'LaTeX',
};

/** Chart artifacts are data, never code: the app renders them with its own accessible SVG renderer. */
export const chartSpecSchema = z
  .object({
    type: z.enum(['bar', 'line', 'area', 'pie', 'scatter']),
    title: z.string().max(200).optional(),
    data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(5000),
    x: z.string().min(1).max(100),
    y: z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(8)]),
    xLabel: z.string().max(100).optional(),
    yLabel: z.string().max(100).optional(),
    stacked: z.boolean().optional(),
  })
  .transform((s) => ({ ...s, y: Array.isArray(s.y) ? s.y : [s.y] }));
export type ChartSpec = z.output<typeof chartSpecSchema>;

export function parseChartSpec(json: string): { ok: true; spec: ChartSpec } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `The chart isn’t valid JSON: ${(e as Error).message}` };
  }
  const r = chartSpecSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'chart'}: ${i.message}`).join('; ') };
  return { ok: true, spec: r.data };
}

export interface Slide {
  title: string;
  /** Markdown body without the title line or speaker notes. */
  body: string;
  /** Plain-text body lines (for PPTX bullets). */
  bullets: string[];
  notes: string;
}

/** Slides markdown: slides separated by a line with `---`; the first heading is the title; "Note:" starts speaker notes. */
export function parseSlides(md: string): Slide[] {
  return md
    .replace(/\r\n/g, '\n')
    .split(/\n-{3,}[ \t]*\n/)
    .map((block) => {
      const [body = '', ...noteParts] = block.split(/\n(?:Notes?|Speaker notes):\s*/i);
      const lines = body.split('\n');
      const nonEmpty = lines.map((l, i) => ({ l, i })).filter((x) => x.l.trim());
      const heading = nonEmpty.find((x) => /^#{1,3}\s/.test(x.l)) ?? nonEmpty[0];
      const title = heading ? heading.l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim() : '';
      const rest = lines.filter((_, i) => i !== heading?.i).join('\n').trim();
      const bullets = rest
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/[*_`]/g, '').trim());
      return { title, body: rest, bullets, notes: noteParts.join('\n').trim() };
    })
    .filter((s) => s.title || s.body);
}

/** RFC 4180 CSV parsing with delimiter detection (comma, tab, semicolon). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.indexOf('\n') >= 0 ? src.indexOf('\n') : src.length);
  const d = delimiter ?? ([',', '\t', ';'] as const).reduce((best, c) => (firstLine.split(c).length > firstLine.split(best).length ? c : best), ',' as string);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map((v) => (v === null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');
}

export { evaluateSheet, columnName, type CellValue, type SheetResult } from './formula.js';
