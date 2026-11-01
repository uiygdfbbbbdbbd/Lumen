import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, cn } from '@lumen/ui';
import { ArrowDown } from 'lucide-react';
import { MessageItem, type MessageActions } from './MessageItem.js';
import { useStreams } from './store.js';
import { compareGroupOf, siblingsOf, type TreeIndex } from './tree.js';
import type { ChatMessage } from './types.js';

type Row = { kind: 'message'; message: ChatMessage } | { kind: 'compare'; group: ChatMessage[]; activeId: string } | { kind: 'compaction'; text: string };

interface Props extends MessageActions {
  path: ChatMessage[];
  idx: TreeIndex;
  compactedThrough: Set<string>;
  user: { name: string; avatarUrl: string | null; id: string };
}

/** Virtualized so very long conversations (thousands of messages) stay smooth. */
export function MessageList({ path, idx, compactedThrough, user, ...actions }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const streams = useStreams((s) => s.streams);

  const rows: Row[] = [];
  for (const m of path) {
    if (m.role === 'assistant' && m.compareGroup) {
      const group = compareGroupOf(idx, m);
      rows.push(group.length > 1 ? { kind: 'compare', group, activeId: m.id } : { kind: 'message', message: m });
    } else rows.push({ kind: 'message', message: m });
    if (compactedThrough.has(m.id)) rows.push({ kind: 'compaction', text: 'Messages above were summarized to fit the context window. The model sees the summary instead.' });
  }

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 140, overscan: 6, getItemKey: (i) => (rows[i]!.kind === 'message' ? (rows[i] as { message: ChatMessage }).message.id : rows[i]!.kind === 'compare' ? `cmp-${(rows[i] as { activeId: string }).activeId}` : `c-${i}`) });

  const lastText = path.length ? (streams[path[path.length - 1]!.id]?.text.length ?? 0) : 0;
  useLayoutEffect(() => {
    if (pinned && rows.length) v.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [rows.length, lastText, pinned, v]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto" role="log" aria-label="Conversation" aria-live="off">
        <div className="relative mx-auto w-full max-w-[var(--lm-chat-width)] px-4" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <div key={item.key} data-index={item.index} ref={v.measureElement} className="absolute left-0 right-0 px-4" style={{ transform: `translateY(${item.start}px)` }}>
                {row.kind === 'message' ? (
                  <MessageItem message={row.message} live={streams[row.message.id]} siblings={siblingsOf(idx, row.message)} user={user} {...actions} />
                ) : row.kind === 'compaction' ? (
                  <div className="my-2 flex items-center gap-2 text-xs text-fg-2" role="note">
                    <span className="h-px flex-1 bg-border" />
                    {row.text}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : (
                  <section aria-label="Model comparison" className="py-3">
                    <div className={cn('grid gap-3', row.group.length === 2 ? 'md:grid-cols-2' : row.group.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-4')}>
                      {row.group.map((m) => (
                        <div key={m.id} className={cn('rounded-lg border p-3', m.id === row.activeId ? 'border-accent' : 'border-border')}>
                          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-fg-2">
                            {m.modelName}
                            {m.id === row.activeId ? <span className="text-accent">Continuing with this</span> : <Button size="sm" variant="secondary" onClick={() => actions.onSwitch(m.id)}>Use this response</Button>}
                          </div>
                          <MessageItem message={m} live={streams[m.id]} siblings={{ list: [m], position: 1 }} user={user} {...actions} />
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!pinned ? (
        <Button size="sm" variant="secondary" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md" onClick={() => { setPinned(true); v.scrollToIndex(rows.length - 1, { align: 'end' }); }}>
          <ArrowDown size={14} aria-hidden="true" /> Jump to latest
        </Button>
      ) : null}
    </div>
  );
}
