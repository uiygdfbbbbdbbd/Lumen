import { unzipSync, strFromU8, type Unzipped } from 'fflate';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import sharp from 'sharp';
import { LumenError } from '@lumen/shared';
import { extensionOf, looksLikeText, type FileKind } from './validate.js';

export interface Section {
  text: string;
  location: { page?: number; section?: string };
}

export interface Extracted {
  sections: Section[];
  pageCount?: number;
  metadata?: Record<string, unknown>;
  /** Replacement bytes (e.g. image re-encoded without EXIF). */
  sanitized?: Buffer;
}

export interface ArchiveLimits {
  maxEntries: number;
  maxBytes: number;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function stripTags(xml: string): string {
  return decodeXml(xml.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

/**
 * Unzip with bomb protection: limits on entry count, total uncompressed size and compression ratio are
 * checked from the central directory *before* inflating anything.
 */
export function safeUnzip(data: Buffer, limits: ArchiveLimits, filter: (name: string) => boolean = () => true): Unzipped {
  let entries = 0;
  let total = 0;
  const out = unzipSync(new Uint8Array(data), {
    filter: (f) => {
      entries++;
      if (entries > limits.maxEntries) throw new LumenError('PAYLOAD_TOO_LARGE', `Archive has too many entries (limit ${limits.maxEntries}).`);
      if (f.name.includes('..') || f.name.startsWith('/')) return false; // path traversal entries are skipped
      total += f.originalSize;
      if (total > limits.maxBytes) throw new LumenError('PAYLOAD_TOO_LARGE', 'Archive expands beyond the allowed size.');
      if (f.size > 0 && f.originalSize / f.size > 200 && f.originalSize > 10 * 1024 * 1024) throw new LumenError('PAYLOAD_TOO_LARGE', 'Archive entry has a suspicious compression ratio.');
      return filter(f.name);
    },
  });
  return out;
}

function htmlToText(html: string, url?: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  try {
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.textContent && article.textContent.trim().length > 200) return { title: article.title ?? '', text: article.textContent.replace(/\n\s*\n+/g, '\n\n').trim() };
  } catch {
    /* fall back to tag stripping */
  }
  void url;
  return { title: (document.querySelector('title')?.textContent ?? '').trim(), text: stripTags(html) };
}

export { htmlToText };

async function extractPdf(data: Buffer): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ text: t.replace(/[ \t]+/g, ' ').trim(), location: { page: i + 1 } }));
  return { sections: pages.filter((p) => p.text), pageCount: totalPages, metadata: { pagesWithoutText: pages.filter((p) => !p.text).length } };
}

function extractPptx(data: Buffer, limits: ArchiveLimits): Extracted {
  const z = safeUnzip(data, limits, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = Object.keys(z)
    .map((n) => ({ n: Number(/slide(\d+)\.xml$/.exec(n)![1]), xml: strFromU8(z[n]!) }))
    .sort((a, b) => a.n - b.n);
  if (!slides.length) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'This presentation has no readable slides.');
  return {
    sections: slides.map((s) => ({ text: [...s.xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]!)).join(' ').trim(), location: { section: `Slide ${s.n}` } })).filter((s) => s.text),
    pageCount: slides.length,
  };
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

function extractXlsx(data: Buffer, limits: ArchiveLimits): Extracted {
  const z = safeUnzip(data, limits, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = z['xl/sharedStrings.xml'] ? [...strFromU8(z['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];
  const names = z['xl/workbook.xml'] ? [...strFromU8(z['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]!)) : [];
  const sheets = Object.keys(z)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .map((n) => ({ i: Number(/sheet(\d+)\.xml$/.exec(n)![1]), xml: strFromU8(z[n]!) }))
    .sort((a, b) => a.i - b.i);
  const sections: Section[] = [];
  for (const s of sheets) {
    const rows: string[] = [];
    for (const row of s.xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const idx = colIndex(c[1]!);
        const attrs = c[2] ?? '';
        const inner = c[3] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (/t="s"/.test(attrs) && v !== undefined) value = shared[Number(v)] ?? '';
        else if (/t="inlineStr"/.test(attrs)) value = decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (v !== undefined) value = decodeXml(v);
        cells[idx] = value.replace(/[\t\n]/g, ' ');
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, (x) => x ?? '').join('\t'));
    }
    if (rows.length) sections.push({ text: rows.join('\n'), location: { section: names[s.i - 1] ?? `Sheet ${s.i}` } });
  }
  return { sections, pageCount: sheets.length };
}

function extractEpub(data: Buffer, limits: ArchiveLimits): Extracted {
  const z = safeUnzip(data, limits, (n) => /\.(x?html?|opf)$/i.test(n));
  const opfName = Object.keys(z).find((n) => n.endsWith('.opf'));
  let order = Object.keys(z).filter((n) => /\.x?html?$/i.test(n)).sort();
  if (opfName) {
    const opf = strFromU8(z[opfName]!);
    const base = opfName.includes('/') ? opfName.slice(0, opfName.lastIndexOf('/') + 1) : '';
    const manifest = new Map([...opf.matchAll(/<item [^>]*id="([^"]+)"[^>]*href="([^"]+)"/g)].map((m) => [m[1]!, base + decodeURIComponent(m[2]!)]));
    const spine = [...opf.matchAll(/<itemref [^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1]!)).filter((x): x is string => Boolean(x && z[x]));
    if (spine.length) order = spine;
  }
  return { sections: order.map((n, i) => ({ text: stripTags(strFromU8(z[n]!)), location: { section: `Chapter ${i + 1}` } })).filter((s) => s.text) };
}

const TEXT_EXTRACTABLE = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|js|ts|tsx|jsx|py|go|rs|java|c|h|cpp|cs|rb|php|sql|sh|css|toml|ini)$/i;

function extractZip(data: Buffer, limits: ArchiveLimits): Extracted {
  const z = safeUnzip(data, limits, (n) => TEXT_EXTRACTABLE.test(n) && !n.startsWith('__MACOSX/'));
  const sections: Section[] = [];
  for (const [name, bytes] of Object.entries(z)) {
    const buf = Buffer.from(bytes);
    if (!buf.length || !looksLikeText(buf)) continue;
    const raw = buf.toString('utf8');
    const text = /\.html?$/i.test(name) ? htmlToText(raw).text : raw;
    sections.push({ text: text.slice(0, 2_000_000), location: { section: name } });
  }
  return { sections, metadata: { extractedEntries: sections.length } };
}

export async function extract(kind: FileKind, name: string, data: Buffer, limits: ArchiveLimits, opts: { stripImageMetadata: boolean }): Promise<Extracted> {
  switch (kind) {
    case 'pdf':
      return extractPdf(data);
    case 'document': {
      const r = await mammoth.extractRawText({ buffer: data });
      return { sections: [{ text: r.value.trim(), location: {} }] };
    }
    case 'presentation':
      return extractPptx(data, limits);
    case 'spreadsheet':
      return extensionOf(name) === 'xlsx' ? extractXlsx(data, limits) : { sections: [{ text: data.toString('utf8').replace(/^\uFEFF/, ''), location: {} }] };
    case 'ebook':
      return extractEpub(data, limits);
    case 'archive':
      return extractZip(data, limits);
    case 'html': {
      const r = htmlToText(data.toString('utf8'));
      return { sections: [{ text: r.text, location: { section: r.title || undefined } }], metadata: { title: r.title } };
    }
    case 'text':
    case 'code':
    case 'data':
      return { sections: [{ text: data.toString('utf8').replace(/^\uFEFF/, ''), location: {} }] };
    case 'image': {
      const meta = await sharp(data, { limitInputPixels: 100_000_000 }).metadata();
      // Re-encoding drops EXIF/GPS and anything appended after the image data.
      const sanitized = opts.stripImageMetadata && ['jpeg', 'png', 'webp'].includes(meta.format ?? '') ? await sharp(data).rotate().toFormat(meta.format as 'jpeg').toBuffer() : undefined;
      return { sections: [], metadata: { width: meta.width, height: meta.height, format: meta.format, exifStripped: Boolean(sanitized) }, sanitized };
    }
    default:
      return { sections: [], metadata: { note: 'Stored without text extraction.' } };
  }
}
