import { fileTypeFromBuffer } from 'file-type';
import { LumenError } from '@lumen/shared';

export type FileKind = 'image' | 'pdf' | 'document' | 'presentation' | 'spreadsheet' | 'text' | 'code' | 'html' | 'ebook' | 'data' | 'audio' | 'video' | 'archive' | 'other';

const BY_EXT: Record<string, { kind: FileKind; mime: string }> = {};
const add = (kind: FileKind, mime: string, ...exts: string[]) => exts.forEach((e) => (BY_EXT[e] = { kind, mime }));
add('image', 'image/png', 'png');
add('image', 'image/jpeg', 'jpg', 'jpeg');
add('image', 'image/gif', 'gif');
add('image', 'image/webp', 'webp');
add('image', 'image/avif', 'avif');
add('image', 'image/heic', 'heic');
add('image', 'image/bmp', 'bmp');
add('image', 'image/tiff', 'tif', 'tiff');
add('pdf', 'application/pdf', 'pdf');
add('document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx');
add('presentation', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx');
add('spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx');
add('spreadsheet', 'text/csv', 'csv');
add('spreadsheet', 'text/tab-separated-values', 'tsv');
add('text', 'text/plain', 'txt', 'log', 'rst', 'text');
add('text', 'text/markdown', 'md', 'markdown', 'mdx');
add('html', 'text/html', 'html', 'htm');
add('ebook', 'application/epub+zip', 'epub');
add('data', 'application/json', 'json', 'jsonl', 'ndjson');
add('data', 'application/xml', 'xml');
add('data', 'application/yaml', 'yaml', 'yml');
add('data', 'application/toml', 'toml');
add('audio', 'audio/mpeg', 'mp3');
add('audio', 'audio/wav', 'wav');
add('audio', 'audio/mp4', 'm4a');
add('audio', 'audio/ogg', 'ogg', 'oga');
add('audio', 'audio/flac', 'flac');
add('video', 'video/mp4', 'mp4', 'm4v');
add('video', 'video/quicktime', 'mov');
add('video', 'video/webm', 'webm');
add('archive', 'application/zip', 'zip');
for (const e of ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'r', 'lua', 'pl', 'dart', 'vue', 'svelte', 'css', 'scss', 'less', 'ini', 'cfg', 'conf', 'gradle', 'tf', 'proto', 'graphql', 'gql', 'dockerfile', 'makefile', 'ex', 'exs', 'erl', 'hs', 'clj', 'elm', 'ml', 'zig', 'nim', 'jl', 'm', 'tex', 'bib', 'ipynb'])
  add('code', 'text/plain', e);

export const ALLOWED_EXTENSIONS = Object.keys(BY_EXT);

export function extensionOf(name: string): string {
  const base = name.toLowerCase().split('/').pop() ?? '';
  if (base === 'dockerfile' || base === 'makefile') return base;
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1) : '';
}

/** Clean a user-supplied filename: no paths, no control chars, bounded length. */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- strip control characters
  const base = name.replace(/\\/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return (base || 'file').slice(0, 200);
}

export function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length < buf.length ? sample.subarray(0, sample.lastIndexOf(10) > 0 ? sample.lastIndexOf(10) : sample.length) : sample);
    return true;
  } catch {
    return false;
  }
}

export interface Classified {
  kind: FileKind;
  mime: string;
  ext: string;
}

const TEXT_KINDS = new Set<FileKind>(['text', 'code', 'html', 'data', 'spreadsheet']);

/**
 * Decide what a file really is from its bytes, and refuse files whose content contradicts their extension
 * (polyglots, renamed executables) or that aren't on the allowlist.
 */
export async function classify(name: string, data: Buffer): Promise<Classified> {
  const ext = extensionOf(name);
  const expected = BY_EXT[ext];
  if (!expected) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', `.${ext || '(no extension)'} files aren’t supported.`);
  const sniffed = await fileTypeFromBuffer(data);
  if (TEXT_KINDS.has(expected.kind) && expected.mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    if (sniffed && !['xml', 'html'].includes(sniffed.ext)) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', `This file looks like ${sniffed.ext.toUpperCase()}, not .${ext}.`);
    if (!looksLikeText(data)) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'This file is not valid UTF-8 text.');
    return { kind: expected.kind, mime: expected.mime, ext };
  }
  if (!sniffed) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', `This file doesn’t look like a real .${ext} file.`);
  const sniffedKind = BY_EXT[sniffed.ext]?.kind ?? (sniffed.mime.startsWith('audio/') ? 'audio' : sniffed.mime.startsWith('video/') ? 'video' : null);
  // Office/EPUB files are zips: accept zip-sniffed content for those extensions; content is validated on extraction.
  const zipFamily = sniffed.ext === 'zip' && ['document', 'presentation', 'spreadsheet', 'ebook', 'archive'].includes(expected.kind);
  if (sniffedKind !== expected.kind && !zipFamily && !(expected.kind === 'audio' && sniffed.mime.startsWith('video/')) && !(expected.kind === 'video' && sniffed.mime.startsWith('audio/'))) {
    throw new LumenError('UNSUPPORTED_MEDIA_TYPE', `This file looks like ${sniffed.ext.toUpperCase()}, not .${ext}.`);
  }
  return { kind: expected.kind, mime: expected.kind === 'image' || expected.kind === 'pdf' ? sniffed.mime : expected.mime, ext };
}
