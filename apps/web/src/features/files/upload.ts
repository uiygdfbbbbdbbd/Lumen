import { CSRF_COOKIE, CSRF_HEADER, LumenError } from '@lumen/shared';
import { api, toLumenError } from '../../lib/api.js';
import type { FileInfo } from './types.js';

const SIMPLE_MAX = 8 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;

function csrf(): string {
  return decodeURIComponent(document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`))?.[1] ?? '');
}

export interface UploadOptions {
  projectId?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Small files: one multipart request with progress via XHR. */
function simpleUpload(file: File, o: UploadOptions): Promise<FileInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.withCredentials = true;
    xhr.setRequestHeader(CSRF_HEADER, csrf());
    xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress?.(e.loaded / e.total);
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as FileInfo);
      else reject(await toLumenError(new Response(xhr.responseText, { status: xhr.status })));
    };
    xhr.onerror = () => reject(new LumenError('PROVIDER_UNAVAILABLE', 'Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    o.signal?.addEventListener('abort', () => xhr.abort());
    const fd = new FormData();
    if (o.projectId) fd.append('projectId', o.projectId);
    fd.append('file', file);
    xhr.send(fd);
  });
}

/**
 * Large files: resumable upload in 4 MB chunks. On a network error it asks the server for the
 * committed offset and continues from there (up to 5 retries per chunk).
 */
async function resumableUpload(file: File, o: UploadOptions): Promise<FileInfo> {
  const session = await api<{ id: string; offset: number }>('/api/uploads', { method: 'POST', body: { name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', projectId: o.projectId ?? null } });
  let offset = session.offset;
  let failures = 0;
  while (offset < file.size) {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const chunk = file.slice(offset, offset + CHUNK);
    try {
      const res = await fetch(`/api/uploads/${session.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset), [CSRF_HEADER]: csrf() },
        body: chunk,
        signal: o.signal,
      });
      if (!res.ok) throw await toLumenError(res);
      const r = (await res.json()) as { offset: number; file: FileInfo | null };
      offset = r.offset;
      failures = 0;
      o.onProgress?.(offset / file.size);
      if (r.file) return r.file;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (e instanceof LumenError && e.status < 500 && e.code !== 'CONFLICT') throw e;
      if (++failures > 5) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** failures));
      offset = (await api<{ offset: number }>(`/api/uploads/${session.id}`)).offset;
    }
  }
  throw new LumenError('INTERNAL', 'Upload finished without a file.');
}

export function uploadFile(file: File, o: UploadOptions = {}): Promise<FileInfo> {
  return file.size <= SIMPLE_MAX ? simpleUpload(file, o) : resumableUpload(file, o);
}

export function fileUrl(id: string, download = false) {
  return `/api/files/${id}/content${download ? '?download=1' : ''}`;
}
