import sharp from 'sharp';
import { LumenError } from '@lumen/shared';
import { safeFetch, type SsrfOptions } from '../../lib/ssrf.js';
import { randomToken } from '../../lib/tokens.js';
import type { StorageDriver } from '../storage/storage.js';

const MAX_ICON_BYTES = 2 * 1024 * 1024;

/**
 * Normalize any supported image (PNG/JPEG/WebP/GIF/AVIF/SVG) to a 128x128 WebP. SVGs are rasterized,
 * so scripts or external references inside them can never reach a browser.
 */
export async function normalizeIcon(data: Buffer): Promise<Buffer> {
  if (data.length > MAX_ICON_BYTES) throw new LumenError('PAYLOAD_TOO_LARGE', 'Icons must be 2 MB or smaller.');
  try {
    const img = sharp(data, { limitInputPixels: 16_000_000, density: 144 });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'heif'].includes(meta.format)) throw new Error('format');
    return await img.resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90 }).toBuffer();
  } catch {
    throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'That file is not a supported image.');
  }
}

export async function fetchIcon(url: string, ssrf: SsrfOptions): Promise<Buffer> {
  const res = await safeFetch(url, { headers: { accept: 'image/*' } }, { ...ssrf, timeoutMs: 10_000, maxRedirects: 3 });
  if (!res.ok) throw new LumenError('BAD_REQUEST', `Could not download icon (HTTP ${res.status}).`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_ICON_BYTES) throw new LumenError('PAYLOAD_TOO_LARGE', 'Icons must be 2 MB or smaller.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > MAX_ICON_BYTES) throw new LumenError('PAYLOAD_TOO_LARGE', 'Icons must be 2 MB or smaller.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function storeIcon(storage: StorageDriver, data: Buffer): Promise<string> {
  const key = `icons/${randomToken(12)}.webp`;
  await storage.put(key, await normalizeIcon(data), 'image/webp');
  return key;
}

export function iconUrl(apiUrl: string, key: string | null | undefined): string | null {
  return key ? `${apiUrl}/api/assets/${key}` : null;
}
