import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api.js';
import type { FileInfo } from './types.js';
import { uploadFile } from './upload.js';

export interface Attachment {
  localId: string;
  name: string;
  size: number;
  kind: string;
  progress: number;
  status: 'uploading' | FileInfo['status'] | 'error';
  error: string | null;
  fileId: string | null;
  previewUrl: string | null;
  file: File;
}

const kindOf = (f: File) => (f.type.startsWith('image/') ? 'image' : f.type === 'application/pdf' ? 'pdf' : 'document');

/** Upload-as-you-attach with progress, then poll until processing finishes. */
export function useAttachments(projectId: string | null | undefined) {
  const [items, setItems] = useState<Attachment[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const update = (id: string, patch: Partial<Attachment>) => setItems((list) => list.map((a) => (a.localId === id ? { ...a, ...patch } : a)));

  const start = useCallback(
    (a: Attachment) => {
      const ctrl = new AbortController();
      controllers.current.set(a.localId, ctrl);
      uploadFile(a.file, { projectId: null, signal: ctrl.signal, onProgress: (p) => update(a.localId, { progress: p }) })
        .then((f) => update(a.localId, { fileId: f.id, status: f.status, kind: f.kind, progress: 1, error: f.error }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') update(a.localId, { status: 'error', error: errorMessage(e) });
        });
    },
    [],
  );
  void projectId;

  const add = useCallback(
    (files: File[]) => {
      const next = files.map((file) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name || 'pasted-image.png',
        size: file.size,
        kind: kindOf(file),
        progress: 0,
        status: 'uploading' as const,
        error: null,
        fileId: null,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        file: file.name ? file : new File([file], 'pasted-image.png', { type: file.type }),
      }));
      setItems((list) => [...list, ...next].slice(0, 20));
      next.forEach(start);
    },
    [start],
  );

  const remove = useCallback((localId: string) => {
    controllers.current.get(localId)?.abort();
    setItems((list) => {
      const a = list.find((x) => x.localId === localId);
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return list.filter((x) => x.localId !== localId);
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const a = items.find((x) => x.localId === localId);
      if (!a) return;
      update(localId, { status: 'uploading', progress: 0, error: null });
      if (a.fileId) void api(`/api/files/${a.fileId}/retry`, { method: 'POST' }).then(() => update(localId, { status: 'queued' }));
      else start(a);
    },
    [items, start],
  );

  // Poll server-side processing.
  useEffect(() => {
    const pending = items.filter((a) => a.fileId && (a.status === 'queued' || a.status === 'processing'));
    if (!pending.length) return;
    const t = setTimeout(async () => {
      for (const a of pending) {
        const f = await api<FileInfo>(`/api/files/${a.fileId}`).catch(() => null);
        if (f) update(a.localId, { status: f.status, error: f.error });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [items]);

  const clear = useCallback(() => {
    setItems((list) => {
      list.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }, []);

  return {
    items,
    add,
    remove,
    retry,
    clear,
    readyIds: items.filter((a) => a.status === 'ready' && a.fileId).map((a) => a.fileId!),
    busy: items.some((a) => ['uploading', 'queued', 'processing'].includes(a.status)),
    hasErrors: items.some((a) => ['error', 'failed', 'quarantined'].includes(a.status)),
  };
}
