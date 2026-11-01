import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import * as pptxModule from 'pptxgenjs';
import { parseSlides } from '@lumen/shared';

/** The subset of pptxgenjs we use (its CJS default export doesn't type-check cleanly under NodeNext). */
interface PptxSlide {
  addText(text: string | { text: string; options: Record<string, unknown> }[], opts: Record<string, unknown>): void;
  addNotes(notes: string): void;
}
interface Pptx {
  layout: string;
  title: string;
  addSlide(): PptxSlide;
  write(opts: { outputType: 'nodebuffer' }): Promise<unknown>;
}
const PptxGenJS = ((pptxModule as unknown as { default?: unknown }).default ?? pptxModule) as new () => Pptx;

/** Inline markdown (bold/italic/code) to docx runs. */
function runs(text: string): TextRun[] {
  const out: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(new TextRun(text.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas' }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true }));
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)));
  return out;
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

/** Markdown (headings, paragraphs, lists, code blocks, quotes) to a .docx file. */
export async function markdownToDocx(title: string, md: string): Promise<Buffer> {
  const paras: Paragraph[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      paras.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })] }));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) paras.push(new Paragraph({ heading: HEADINGS[h[1]!.length - 1], children: runs(h[2]!) }));
    else if (/^\s*[-*+]\s+/.test(line)) paras.push(new Paragraph({ bullet: { level: Math.min(3, Math.floor((line.length - line.trimStart().length) / 2)) }, children: runs(line.replace(/^\s*[-*+]\s+/, '')) }));
    else if (/^\s*\d+[.)]\s+/.test(line)) paras.push(new Paragraph({ children: runs(line.trim()) }));
    else if (line.startsWith('>')) paras.push(new Paragraph({ children: [new TextRun({ text: line.replace(/^>\s?/, ''), italics: true })], indent: { left: 400 } }));
    else if (line.trim()) paras.push(new Paragraph({ children: runs(line) }));
    else paras.push(new Paragraph({}));
  }
  const doc = new Document({ title, creator: 'Lumen', sections: [{ children: paras }] });
  return Packer.toBuffer(doc);
}

export async function slidesToPptx(title: string, md: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;
  for (const s of parseSlides(md)) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.5, y: 0.4, w: 12.3, h: 1, fontSize: 32, bold: true });
    if (s.bullets.length) slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: true } })), { x: 0.7, y: 1.6, w: 11.9, h: 5.2, fontSize: 20, valign: 'top' });
    if (s.notes) slide.addNotes(s.notes);
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
