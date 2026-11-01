import type { ArtifactType } from '@lumen/shared';

const CODE_EXT: Record<string, string> = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php',
  swift: 'swift', kotlin: 'kt', scala: 'scala', bash: 'sh', shell: 'sh', sh: 'sh', powershell: 'ps1', sql: 'sql', html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yml', toml: 'toml',
  xml: 'xml', markdown: 'md', r: 'r', lua: 'lua', dart: 'dart', haskell: 'hs', elixir: 'ex', perl: 'pl', dockerfile: 'Dockerfile', makefile: 'mk',
};

export function extensionFor(type: ArtifactType, language?: string | null): string {
  switch (type) {
    case 'code':
      return CODE_EXT[(language ?? '').toLowerCase()] ?? 'txt';
    case 'markdown':
    case 'slides':
      return 'md';
    case 'html':
      return 'html';
    case 'react':
      return 'jsx';
    case 'svg':
      return 'svg';
    case 'mermaid':
      return 'mmd';
    case 'chart':
      return 'json';
    case 'table':
    case 'spreadsheet':
      return 'csv';
    case 'latex':
      return 'tex';
  }
}

export function mimeFor(type: ArtifactType): string {
  return { html: 'text/html', svg: 'image/svg+xml', chart: 'application/json', table: 'text/csv', spreadsheet: 'text/csv', markdown: 'text/markdown', slides: 'text/markdown' }[type as string] ?? 'text/plain';
}

/** Monaco language id for an artifact. */
export function editorLanguage(type: ArtifactType, language?: string | null): string {
  if (type === 'code') {
    const l = (language ?? '').toLowerCase();
    return ({ py: 'python', js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', sh: 'shell', bash: 'shell', 'c++': 'cpp', 'c#': 'csharp', yml: 'yaml' } as Record<string, string>)[l] ?? (l || 'plaintext');
  }
  return ({ markdown: 'markdown', slides: 'markdown', html: 'html', react: 'javascript', svg: 'xml', chart: 'json', latex: 'latex', mermaid: 'plaintext', table: 'plaintext', spreadsheet: 'plaintext' } as Record<string, string>)[type] ?? 'plaintext';
}

export function safeFileName(title: string): string {
  // Control characters are invalid in file names on every OS.
  // eslint-disable-next-line no-control-regex
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'artifact';
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const COLOR_PROPS = ['fill', 'stroke', 'color', 'stop-color', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight'] as const;

/** Clone an in-page SVG with theme variables resolved, so it renders the same outside the app. */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const out = dst[i] as SVGElement;
    for (const prop of COLOR_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) out.style.setProperty(prop, v);
    }
  });
  const box = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(box.width)));
  if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(box.height)));
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--lm-bg').trim() || '#ffffff';
  clone.insertAdjacentHTML('afterbegin', `<rect width="100%" height="100%" fill="${/^#[0-9a-f]{3,8}$/i.test(bg) ? bg : '#ffffff'}"/>`);
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterize SVG markup to PNG at 2× for crisp exports. */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 800;
    const h = img.naturalHeight || 600;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Print just one element (used for "Save as PDF"): the rest of the page is hidden by print CSS. */
export function printElement(el: HTMLElement) {
  el.setAttribute('data-print-root', '');
  document.body.classList.add('lm-printing');
  const done = () => {
    el.removeAttribute('data-print-root');
    document.body.classList.remove('lm-printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Some browsers don't fire afterprint for print-to-PDF; clean up on the next frame either way.
  setTimeout(done, 1000);
}

export function publicUrl(slug: string): string {
  return `${window.location.origin}/a/${slug}`;
}

export function embedSnippet(slug: string, title: string): string {
  const safeTitle = title.replace(/[<>"&]/g, '');
  return `<iframe src="${publicUrl(slug)}?embed=1" title="${safeTitle}" width="100%" height="600" style="border:0;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}
