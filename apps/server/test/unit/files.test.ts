import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { chunkSections, splitUnits } from '../../src/services/files/chunker.js';
import { extract, htmlToText, safeUnzip } from '../../src/services/files/extract.js';
import { rrf } from '../../src/services/files/retrieval.service.js';
import { classify, extensionOf, looksLikeText, sanitizeFilename } from '../../src/services/files/validate.js';
import { evaluate } from '../../src/services/tools/calculator.js';
import { makeDocx, makeEpub, makePdf, makePptx, makeXlsx, makeZip } from '../helpers/fixtures.js';

const limits = { maxEntries: 100, maxBytes: 5 * 1024 * 1024 };
const opts = { stripImageMetadata: true };

describe('filename + type validation', () => {
  it('sanitizes names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\report<1>.pdf')).toBe('report1.pdf');
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename('a\u0000b.txt')).toBe('ab.txt');
    expect(extensionOf('Dockerfile')).toBe('dockerfile');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });
  it('detects text', () => {
    expect(looksLikeText(Buffer.from('héllo\nworld'))).toBe(true);
    expect(looksLikeText(Buffer.from([0x00, 0x01, 0x02]))).toBe(false);
    expect(looksLikeText(Buffer.from([0xc3, 0x28]))).toBe(false);
  });
  it('classifies real files and rejects spoofed/polyglot ones', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer();
    expect(await classify('a.png', png)).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(await classify('doc.pdf', makePdf(['x']))).toMatchObject({ kind: 'pdf' });
    expect(await classify('d.docx', makeDocx(['x']))).toMatchObject({ kind: 'document' });
    expect(await classify('notes.md', Buffer.from('# hi'))).toMatchObject({ kind: 'text' });
    expect(await classify('main.py', Buffer.from('print(1)'))).toMatchObject({ kind: 'code' });
    await expect(classify('evil.exe', Buffer.from('MZ'))).rejects.toThrow(/aren’t supported/);
    await expect(classify('photo.png', makePdf(['x']))).rejects.toThrow(/looks like PDF/);
    await expect(classify('notes.txt', png)).rejects.toThrow(/looks like PNG/);
    await expect(classify('fake.pdf', Buffer.from('just text'))).rejects.toThrow(/real \.pdf/);
    await expect(classify('bin.txt', Buffer.from([0, 1, 2, 3]))).rejects.toThrow(/UTF-8/);
  });
});

describe('extraction', () => {
  it('PDF text per page', async () => {
    const r = await extract('pdf', 'a.pdf', makePdf(['Apples are red', 'Bananas are yellow']), limits, opts);
    expect(r.pageCount).toBe(2);
    expect(r.sections.map((s) => [s.location.page, s.text])).toEqual([
      [1, 'Apples are red'],
      [2, 'Bananas are yellow'],
    ]);
  });
  it('DOCX, PPTX, XLSX, EPUB', async () => {
    expect((await extract('document', 'a.docx', makeDocx(['Hello world', 'Second para']), limits, opts)).sections[0]!.text).toContain('Second para');
    const pptx = await extract('presentation', 'a.pptx', makePptx(['Intro slide', 'Results slide']), limits, opts);
    expect(pptx.sections).toEqual([
      { text: 'Intro slide & more', location: { section: 'Slide 1' } },
      { text: 'Results slide & more', location: { section: 'Slide 2' } },
    ]);
    const xlsx = await extract('spreadsheet', 'a.xlsx', makeXlsx([['Region', 'Revenue'], ['North', 1200], ['South', 900]]), limits, opts);
    expect(xlsx.sections[0]).toEqual({ text: 'Region\tRevenue\nNorth\t1200\nSouth\t900', location: { section: 'Sales' } });
    const epub = await extract('ebook', 'a.epub', makeEpub(['Once upon a time', 'The end']), limits, opts);
    expect(epub.sections.map((s) => s.location.section)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(epub.sections[1]!.text).toContain('The end');
  });
  it('HTML via readability, plain text, CSV', async () => {
    const html = `<html><head><title>T</title><script>alert(1)</script></head><body><nav>menu</nav><article><h1>Big news</h1>${'<p>The quick brown fox jumps over the lazy dog repeatedly. </p>'.repeat(20)}</article></body></html>`;
    const r = htmlToText(html);
    expect(r.text).toContain('quick brown fox');
    expect(r.text).not.toContain('alert(1)');
    expect((await extract('text', 'a.txt', Buffer.from('\uFEFFhello'), limits, opts)).sections[0]!.text).toBe('hello');
    expect((await extract('spreadsheet', 'a.csv', Buffer.from('a,b\n1,2'), limits, opts)).sections[0]!.text).toBe('a,b\n1,2');
  });
  it('re-encodes images to strip EXIF', async () => {
    const jpg = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#0f0' } }).withMetadata({ exif: { IFD0: { Copyright: 'gps-secret' } } }).jpeg().toBuffer();
    const r = await extract('image', 'a.jpg', jpg, limits, opts);
    expect(r.metadata).toMatchObject({ width: 10, height: 10, exifStripped: true });
    expect(r.sanitized!.includes(Buffer.from('gps-secret'))).toBe(false);
  });
  it('zip: extracts text entries, skips traversal, enforces bomb limits', async () => {
    const z = makeZip({ 'readme.md': '# Hello zip', 'src/app.py': 'print("hi")', '../evil.txt': 'nope', 'image.bin': new Uint8Array([0, 1]) });
    const r = await extract('archive', 'a.zip', z, limits, opts);
    expect(r.sections.map((s) => s.location.section).sort()).toEqual(['readme.md', 'src/app.py']);
    const big = makeZip({ 'zeros.txt': new Uint8Array(6 * 1024 * 1024) });
    expect(() => safeUnzip(big, limits)).toThrow(/expands beyond/);
    const ratio = makeZip({ 'zeros.txt': new Uint8Array(20 * 1024 * 1024) });
    expect(() => safeUnzip(ratio, { maxEntries: 10, maxBytes: 100 * 1024 * 1024 })).toThrow(/compression ratio/);
    const many = makeZip(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`f${i}.txt`, 'x'])));
    expect(() => safeUnzip(many, limits)).toThrow(/too many entries/);
  });
  it('audio/video stored without text', async () => {
    expect((await extract('audio', 'a.mp3', Buffer.from('x'), limits, opts)).sections).toEqual([]);
  });
});

describe('chunking', () => {
  it('splits long text into bounded units and chunks with overlap, never crossing pages', () => {
    const para = (n: number) => `Paragraph ${n}. ${'Lorem ipsum dolor sit amet consectetur. '.repeat(20)}`;
    const sections = [
      { text: Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n'), location: { page: 1 } },
      { text: 'Short page two text.', location: { page: 2 } },
    ];
    const chunks = chunkSections(sections, 300, 60);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((c) => c.tokenCount <= 450)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ content: 'Short page two text.', location: { page: 2 } });
    // Overlap: each chunk on the same page starts with the tail of the previous one.
    const [a, b] = chunks;
    const tail = a!.content.split(/\s+/).slice(-5).join(' ');
    expect(b!.content.split('\n\n')[0]!.endsWith(tail)).toBe(true);
    expect(b!.content.split('\n\n')[0]!.length).toBeLessThan(a!.content.length);
  });
  it('handles giant single words/sentences', () => {
    expect(splitUnits('x'.repeat(10_000), 100).length).toBeGreaterThanOrEqual(1);
    expect(splitUnits(Array.from({ length: 1000 }, () => 'word').join(' '), 50).length).toBeGreaterThan(10);
    expect(chunkSections([{ text: '', location: {} }])).toEqual([]);
  });
});

describe('reciprocal rank fusion', () => {
  it('rewards items ranked well in several lists', () => {
    const s = rrf([['a', 'b', 'c'], ['b', 'a'], ['b']]);
    expect([...s].sort((x, y) => y[1] - x[1]).map(([k]) => k)).toEqual(['b', 'a', 'c']);
  });
});

describe('calculator', () => {
  it('evaluates safely with precedence, functions and errors', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2+3)^2')).toBe(25);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-4 + sqrt(16) * pi / pi')).toBe(0);
    expect(evaluate('max(1, 7, 3) % 4')).toBe(3);
    expect(evaluate('1.5e3 / 3')).toBe(500);
    expect(() => evaluate('process.exit()')).toThrow();
    expect(() => evaluate('1 / 0')).toThrow(/finite/);
    expect(() => evaluate('(1 + 2')).toThrow(/Expected/);
    expect(() => evaluate('foo(1)')).toThrow(/Unknown name/);
    expect(() => evaluate('2 2')).toThrow(/Unexpected/);
    expect(() => evaluate('('.repeat(200) + '1' + ')'.repeat(200))).toThrow(/nested/);
  });
});

describe('citation snippets', () => {
  it('centers on the first matching term', async () => {
    const { bestSnippet } = await import('../../src/services/files/context.js');
    const text = `${'filler '.repeat(100)}the saffron harvest is labor intensive ${'filler '.repeat(100)}`;
    expect(bestSnippet(text, 'saffron economics')).toContain('saffron harvest');
    expect(bestSnippet(text, 'saffron').startsWith('…')).toBe(true);
    expect(bestSnippet('short text', 'zzz')).toBe('short text');
  });
});
