import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { MEMORY_CATEGORY_LABELS } from '@lumen/shared';
import { Popover, PopoverContent, PopoverTrigger, Skeleton } from '@lumen/ui';
import { Brain, History, Loader2, XCircle } from 'lucide-react';
import { useMemoryLookup } from './api.js';

/** "Memory used" chip: which memories were given to the model for this response. */
export function MemoryUsed({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const q = useMemoryLookup(ids, open);
  if (!ids.length) return null;
  const found = new Set((q.data ?? []).map((m) => m.id));
  const missing = q.data ? ids.filter((id) => !found.has(id)).length : 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-fg-2 hover:bg-hover">
          <Brain size={12} aria-hidden="true" /> Memory used ({ids.length})
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="mb-2 text-xs font-semibold text-fg-2">Memories given to the AI for this response</p>
        {q.isLoading ? (
          <Skeleton className="h-12" />
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-auto">
            {(q.data ?? []).map((m) => (
              <li key={m.id} className="text-sm text-fg">
                {m.content}
                <span className="ml-1 text-xs text-fg-3">· {MEMORY_CATEGORY_LABELS[m.category]}</span>
              </li>
            ))}
            {missing ? <li className="text-xs text-fg-3">{missing} {missing === 1 ? 'memory has' : 'memories have'} since been deleted.</li> : null}
          </ul>
        )}
        <Link to="/settings/memory" className="mt-3 inline-block text-xs font-medium text-accent underline underline-offset-2">Manage memory</Link>
      </PopoverContent>
    </Popover>
  );
}

export const MEMORY_TOOL_NAMES = new Set(['memory_write', 'memory_update', 'memory_delete', 'memory_search', 'conversation_search']);

/** Compact rows for memory tool calls instead of the generic tool card. */
export function MemoryToolCard({ name, args, result }: { name: string; args: Record<string, unknown>; result?: { content: string; isError: boolean } }) {
  const running = !result;
  const failed = result?.isError;
  const text = (() => {
    if (name === 'conversation_search') return running ? 'Searching past chats…' : failed ? 'Couldn’t search past chats' : `Searched past chats for “${String(args.query ?? '')}”`;
    if (name === 'memory_search') return running ? 'Checking memory…' : failed ? 'Couldn’t check memory' : 'Checked memory';
    if (name === 'memory_delete') return running ? 'Forgetting…' : failed ? 'Couldn’t forget that' : result!.content.replace(/^Forgot:\s*/, 'Forgot: ');
    if (name === 'memory_update') return running ? 'Updating memory…' : failed ? 'Couldn’t update memory' : `Updated memory: ${String(args.content ?? '')}`;
    return running ? 'Saving to memory…' : failed ? 'Didn’t save to memory' : result!.content.startsWith('Already') ? `Already remembered: ${String(args.content ?? '')}` : `Saved to memory: ${String(args.content ?? '')}`;
  })();
  const Icon = running ? Loader2 : failed ? XCircle : name === 'conversation_search' ? History : Brain;
  return (
    <div className="my-1.5 flex items-start gap-2 text-sm text-fg-2" role="status">
      <Icon size={14} aria-hidden="true" className={`mt-0.5 shrink-0 ${running ? 'animate-spin' : failed ? 'text-danger' : 'text-accent'}`} />
      <span className="min-w-0 flex-1">
        {text}
        {failed ? <span className="block text-xs text-fg-3">{result!.content.replace(/^Error:\s*/, '').slice(0, 200)}</span> : null}
      </span>
      {name !== 'conversation_search' && !running ? <Link to="/settings/memory" className="shrink-0 text-xs underline underline-offset-2">Manage</Link> : null}
    </div>
  );
}
