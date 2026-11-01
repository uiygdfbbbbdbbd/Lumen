import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Skeleton, cn, toast } from '@lumen/ui';
import { Archive, MoreHorizontal, Pencil, Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { usePatchConversation, useConversationList, useInvalidateChat } from './api.js';
import { dateGroup } from './tree.js';
import type { ConversationSummary } from './types.js';

function Item({ c, active, onNavigate }: { c: ConversationSummary; active: boolean; onNavigate?: () => void }) {
  const patch = usePatchConversation();
  const invalidate = useInvalidateChat();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  return (
    <li className={cn('group relative flex items-center rounded-md', active ? 'bg-accent-soft' : 'hover:bg-hover')}>
      {renaming ? (
        <form className="flex-1 px-2 py-1" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('t') ?? '').trim(); setRenaming(false); if (v) patch.mutate({ id: c.id, title: v }); }}>
          <input name="t" defaultValue={c.title} autoFocus aria-label="Rename chat" onBlur={(e) => e.currentTarget.form?.requestSubmit()} className="w-full rounded-sm bg-elevated px-2 py-1 text-sm outline-none" />
        </form>
      ) : (
        <Link to="/c/$conversationId" params={{ conversationId: c.id }} onClick={onNavigate} aria-current={active ? 'page' : undefined} className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-fg">
          {c.starred ? <Star size={12} className="mr-1 inline text-warning" fill="currentColor" aria-label="Starred" /> : null}
          {c.title}
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Options for ${c.title}`} className="mr-1 rounded-sm p-1 text-fg-3 opacity-0 hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil size={16} aria-hidden="true" /> Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => patch.mutate({ id: c.id, pinned: !c.pinned })}>{c.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />} {c.pinned ? 'Unpin' : 'Pin'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => patch.mutate({ id: c.id, starred: !c.starred })}><Star size={16} aria-hidden="true" /> {c.starred ? 'Unstar' : 'Star'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => patch.mutate({ id: c.id, archived: !c.archived })}><Archive size={16} aria-hidden="true" /> {c.archived ? 'Unarchive' : 'Archive'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={async () => {
              try {
                await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
                await invalidate(c.id);
                if (active) await navigate({ to: '/' });
                toast({ title: 'Chat deleted', action: { label: 'Undo', onClick: () => void api(`/api/conversations/${c.id}/restore`, { method: 'POST' }).then(() => invalidate(c.id)) } });
              } catch (e) {
                toast.error('Delete failed', errorMessage(e));
              }
            }}
          >
            <Trash2 size={16} aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ConversationList({ archived = false, onNavigate }: { archived?: boolean; onNavigate?: () => void }) {
  const q = useConversationList(archived);
  const params = useParams({ strict: false }) as { conversationId?: string };
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const groups = useMemo(() => {
    const out = new Map<string, ConversationSummary[]>();
    const pinned = all.filter((c) => c.pinned);
    if (pinned.length) out.set('Pinned', pinned);
    for (const c of all.filter((x) => !x.pinned)) {
      const g = dateGroup(c.lastMessageAt);
      out.set(g, [...(out.get(g) ?? []), c]);
    }
    return [...out];
  }, [all]);

  if (q.isLoading) return <div className="flex flex-col gap-2 px-2"><Skeleton className="h-7" /><Skeleton className="h-7" /><Skeleton className="h-7" /></div>;
  if (!all.length) return <p className="px-3 text-xs text-fg-2">{archived ? 'No archived chats.' : 'Your chats will appear here.'}</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map(([label, items]) => (
        <section key={label} aria-label={label}>
          <h2 className="px-3 pb-1 text-xs font-semibold text-fg-2">{label}</h2>
          <ul className="flex flex-col">{items.map((c) => <Item key={c.id} c={c} active={params.conversationId === c.id} onNavigate={onNavigate} />)}</ul>
        </section>
      ))}
      {q.hasNextPage ? <button type="button" onClick={() => void q.fetchNextPage()} className="px-3 text-left text-xs text-accent underline">Load more</button> : null}
    </div>
  );
}
