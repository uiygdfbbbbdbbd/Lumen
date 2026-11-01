import { useState } from 'react';
import { CheckCircle2, ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react';
import { cn } from '@lumen/ui';

export function ToolCard({ name, args, result }: { name: string; args: Record<string, unknown>; result?: { content: string; isError: boolean } }) {
  const [open, setOpen] = useState(false);
  const state = !result ? 'running' : result.isError ? 'error' : 'done';
  return (
    <div className="my-2 rounded-md border border-border bg-surface text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight size={14} aria-hidden="true" className={cn('lm-transition transition-transform', open && 'rotate-90')} />
        <Wrench size={14} aria-hidden="true" className="text-fg-3" />
        <span className="font-medium text-fg">{name}</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-fg-2">
          {state === 'running' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : state === 'error' ? <XCircle size={12} className="text-danger" aria-hidden="true" /> : <CheckCircle2 size={12} className="text-success" aria-hidden="true" />}
          {state === 'running' ? 'Running' : state === 'error' ? 'Failed' : 'Done'}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-3 py-2">
          <div className="text-xs font-semibold text-fg-2">Input</div>
          <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-code-bg p-2 text-xs text-code">{JSON.stringify(args, null, 2)}</pre>
          {result ? (
            <>
              <div className="mt-2 text-xs font-semibold text-fg-2">Output</div>
              <pre className={cn('mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-code-bg p-2 text-xs', result.isError ? 'text-danger' : 'text-code')}>{result.content}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
