import { strToU8, zipSync } from 'fflate';

/** Minimal valid multi-page PDF with real text objects (correct xref offsets). */
export function makePdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  const fontId = 3 + pages.length * 2;
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((text, i) => {
    const stream = `BT /F1 18 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const CT = (extra: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${extra}</Types>`;

export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>')),
      '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
    }),
  );
}

export function makePptx(slides: string[]): Buffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CT('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>')),
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
  };
  slides.forEach((s, i) => (files[`ppt/slides/slide${i + 1}.xml`] = strToU8(`<p:sld xmlns:a="a" xmlns:p="p"><a:t>${s}</a:t><a:t>&amp; more</a:t></p:sld>`)));
  return Buffer.from(zipSync(files));
}

export function makeXlsx(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const cell = (v: string | number, r: number, c: number) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(CT('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>')),
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Sales" sheetId="1"/></sheets></workbook>'),
      'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
    }),
  );
}

export function makeEpub(chapters: string[]): Buffer {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(
      `<package><manifest>${chapters.map((_, i) => `<item id="c${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters
        .map((_, i) => `<itemref idref="c${i}"/>`)
        .reverse()
        .reverse()
        .join('')}</spine></package>`,
    ),
  };
  chapters.forEach((c, i) => (files[`OEBPS/ch${i}.xhtml`] = strToU8(`<html><body><h1>Chapter ${i + 1}</h1><p>${c}</p></body></html>`)));
  return Buffer.from(zipSync(files as never));
}

export function makeZip(entries: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));
}
