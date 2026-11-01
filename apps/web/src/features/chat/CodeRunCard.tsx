import { useEffect, useRef, useState } from 'react';
import { Badge, Button, cn } from '@lumen/ui';
import { Play, Send, ShieldCheck, Square } from 'lucide-react';
import { CodeView } from '../artifacts/renderers/CodeView.js';

const RUNNER_URL = (import.meta.env.VITE_CODE_RUNNER_URL as string | undefined) ?? '/code-runner.html';
const MAX_SHARE = 8000;

type Line = { stream: 'stdout' | 'stderr' | 'status' | 'result' | 'error'; text: string };

/**
 * Code the model asked to run. It runs only when the user clicks Run, inside a sandboxed frame (opaque
 * origin, no network) in a fresh worker with a time limit. The output can be shared back to the chat.
 */
export function CodeRunCard({ args, onShare, canShare }: { args: { language?: string; code?: string }; onShare?: (text: string) => void; canShare: boolean }) {
  const language = args.language === 'javascript' ? 'javascript' : 'python';
  const code = String(args.code ?? '');
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [shared, setShared] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || e.data.__lumen !== true) return;
      const d = e.data as { kind: string; id?: number; stream?: 'stdout' | 'stderr'; text?: string; ok?: boolean; result?: string | null; error?: string; ms?: number };
      if (d.kind === 'ready') return setReady(true);
      if (d.id !== runId.current) return;
      if (d.kind === 'output') setLines((l) => [...l, { stream: d.stream ?? 'stdout', text: d.text ?? '' }].slice(-500));
      else if (d.kind === 'status') setLines((l) => [...l.filter((x) => x.stream !== 'status'), { stream: 'status', text: d.text ?? '' }]);
      else if (d.kind === 'done') {
        setLines((l) => [...l.filter((x) => x.stream !== 'status'), ...(d.ok ? (d.result ? [{ stream: 'result' as const, text: d.result }] : []) : [{ stream: 'error' as const, text: d.error ?? 'Failed' }]), { stream: 'status', text: `${d.ok ? 'Finished' : 'Stopped'} in ${((d.ms ?? 0) / 1000).toFixed(1)}s` }]);
        setState('done');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const run = () => {
    runId.current += 1;
    setLines([]);
    setShared(false);
    setState('running');
    frame.current?.contentWindow?.postMessage({ __lumen: true, kind: 'run', id: runId.current, language, code, timeoutMs: language === 'python' ? 60_000 : 15_000 }, '*');
  };
  const output = lines.filter((l) => l.stream !== 'status').map((l) => (l.stream === 'error' ? `Error: ${l.text}` : l.text)).join('\n');

  return (
    <section aria-label={`${language === 'python' ? 'Python' : 'JavaScript'} code to run`} className="my-2 overflow-hidden rounded-lg border border-border bg-elevated">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Badge>{language === 'python' ? 'Python' : 'JavaScript'}</Badge>
        <span className="flex items-center gap-1 text-xs text-fg-2"><ShieldCheck size={12} aria-hidden="true" /> Runs in your browser · sandboxed · no network</span>
        <span className="flex-1" />
        {state === 'running' ? (
          <Button size="sm" variant="secondary" onClick={() => frame.current?.contentWindow?.postMessage({ __lumen: true, kind: 'stop' }, '*')}><Square size={12} aria-hidden="true" /> Stop</Button>
        ) : (
          <Button size="sm" onClick={run} disabled={!ready} loading={!ready}><Play size={12} aria-hidden="true" /> {state === 'done' ? 'Run again' : 'Run'}</Button>
        )}
      </div>
      <div className="max-h-72 overflow-auto"><CodeView code={code} language={language} /></div>
      {lines.length ? (
        <div className="border-t border-border">
          <pre aria-label="Output" aria-live="polite" className="m-0 max-h-60 overflow-auto whitespace-pre-wrap bg-code-bg px-3 py-2 font-mono text-xs">
            {lines.map((l, i) => (
              <div key={i} className={cn(l.stream === 'stderr' || l.stream === 'error' ? 'text-danger' : l.stream === 'status' ? 'text-fg-2 italic' : l.stream === 'result' ? 'font-semibold text-fg' : 'text-code')}>{l.stream === 'result' ? `→ ${l.text}` : l.text}</div>
            ))}
          </pre>
          {state === 'done' && onShare && canShare ? (
            <div className="flex justify-end border-t border-border px-3 py-1.5">
              <Button size="sm" variant="secondary" disabled={shared} onClick={() => { setShared(true); onShare(`Here’s the output of the ${language} code:\n\n\`\`\`\n${(output || '(no output)').slice(0, MAX_SHARE)}\n\`\`\``); }}>
                <Send size={12} aria-hidden="true" /> {shared ? 'Shared' : 'Share output with AI'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <iframe ref={frame} title="Code runner" src={RUNNER_URL} sandbox="allow-scripts" className="hidden" aria-hidden="true" tabIndex={-1} />
    </section>
  );
}
