import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api.js';

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

export interface FrameHandle {
  print(): void;
}

interface Props {
  artifactId: string;
  type: 'html' | 'react';
  content: string;
  onConsole?: (e: ConsoleEntry) => void;
  onError?: (message: string) => void;
  /** Public viewers can't use the AI/storage bridge without signing in. */
  bridge?: boolean;
  className?: string;
}

const RUNTIME_URL = (import.meta.env.VITE_ARTIFACT_RUNTIME_URL as string | undefined) ?? '/artifact-runtime.html';

/**
 * Runs HTML/React artifacts in a sandboxed iframe WITHOUT allow-same-origin: the frame gets an opaque origin,
 * so it can't read app cookies, storage or DOM, and its CSP blocks all network access. The parent answers
 * bridge calls (AI, storage) with the signed-in user's own credentials and quotas.
 */
export const ArtifactFrame = forwardRef<FrameHandle, Props>(function ArtifactFrame({ artifactId, type, content, onConsole, onError, bridge = true, className }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [key, setKey] = useState(0);
  const handlers = useRef({ onConsole, onError });
  handlers.current = { onConsole, onError };

  useImperativeHandle(ref, () => ({ print: () => frame.current?.contentWindow?.postMessage({ __lumen: true, kind: 'print' }, '*') }));

  // Re-create the frame on every content change so no state leaks between versions.
  useEffect(() => setKey((k) => k + 1), [content, type]);

  useEffect(() => {
    const win = () => frame.current?.contentWindow;
    const reply = (id: number, result: unknown, error?: string) => win()?.postMessage({ __lumen: true, kind: 'reply', id, result, error }, '*');
    const onMessage = async (e: MessageEvent) => {
      if (e.source !== win() || !e.data || e.data.__lumen !== true) return;
      const d = e.data as { kind: string; id?: number; method?: string; args?: Record<string, unknown>; level?: ConsoleEntry['level']; text?: string; message?: string };
      if (d.kind === 'ready') win()?.postMessage({ __lumen: true, kind: 'render', type, content }, '*');
      else if (d.kind === 'console') handlers.current.onConsole?.({ level: d.level ?? 'log', text: String(d.text ?? '') });
      else if (d.kind === 'error') handlers.current.onError?.(String(d.message ?? 'Unknown error'));
      else if (d.kind === 'call' && typeof d.id === 'number') {
        if (!bridge) return reply(d.id, null, 'Sign in to use this app’s AI and storage features.');
        const a = d.args ?? {};
        const key = encodeURIComponent(String(a.key ?? ''));
        try {
          if (d.method === 'ai') reply(d.id, await api(`/api/artifacts/${artifactId}/ai`, { method: 'POST', body: { prompt: String(a.prompt ?? ''), ...(a.system ? { system: String(a.system) } : {}), ...(a.maxTokens ? { maxTokens: Number(a.maxTokens) } : {}) } }));
          else if (d.method === 'storage.get') reply(d.id, (await api<{ value: unknown }>(`/api/artifacts/${artifactId}/storage/${key}?shared=${a.shared ? 'true' : 'false'}`)).value);
          else if (d.method === 'storage.set') reply(d.id, await api(`/api/artifacts/${artifactId}/storage/${key}`, { method: 'PUT', body: { value: a.value ?? null, shared: Boolean(a.shared) } }));
          else if (d.method === 'storage.delete') reply(d.id, await api(`/api/artifacts/${artifactId}/storage/${key}`, { method: 'DELETE' }));
          else reply(d.id, null, `Unknown method ${d.method}`);
        } catch (err) {
          reply(d.id, null, errorMessage(err));
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [artifactId, type, content, bridge, key]);

  return (
    <iframe
      key={key}
      ref={frame}
      title="Artifact preview"
      src={RUNTIME_URL}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      referrerPolicy="no-referrer"
      className={className ?? 'h-full w-full border-0 bg-white'}
    />
  );
});
