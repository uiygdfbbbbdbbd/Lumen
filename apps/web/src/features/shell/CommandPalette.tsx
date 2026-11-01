import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog as RDialog } from 'radix-ui';
import { cn } from '@lumen/ui';
import { Bot, EyeOff, MessageSquare, Moon, Search, Settings, Shield, Sparkles } from 'lucide-react';
import { hasPermission, useMe } from '../../lib/auth.js';
import { useThemeStore } from '../../lib/theme.js';
import { formatCombo, resolveBindings } from '../../lib/shortcuts.js';
import { searchConversations, useConversationList, type SearchHit } from '../chat/api.js';
import { useModels, usePreferences, useUpdatePreferences } from '../models/useModels.js';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

function Snippet({ text }: { text: string }) {
  // Server marks matches with << >>; render them as <mark> without using innerHTML.
  const parts = text.split(/(<<.*?>>)/g);
  return <>{parts.map((p, i) => (p.startsWith('<<') ? <mark key={i} className="rounded-sm bg-accent-soft text-fg">{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>))}</>;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: models = [] } = useModels();
  const { data: prefs } = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const conversations = useConversationList(false);
  const theme = useThemeStore();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const bindings = resolveBindings(prefs?.shortcuts);

  useEffect(() => {
    if (!open) {
      setQ('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => void searchConversations(q.trim(), ctrl.signal).then(setHits).catch(() => undefined), 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { id: 'new', group: 'Actions', label: 'New chat', hint: formatCombo(bindings.newChat), icon: <MessageSquare size={16} />, run: go(() => void navigate({ to: '/' })) },
      { id: 'temp', group: 'Actions', label: 'New temporary chat', hint: formatCombo(bindings.temporaryChat), icon: <EyeOff size={16} />, run: go(() => void navigate({ to: '/temporary' })) },
      { id: 'theme', group: 'Actions', label: 'Toggle light / dark', hint: formatCombo(bindings.toggleTheme), icon: <Moon size={16} />, run: go(() => theme.set({ mode: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })) },
      ...(['account', 'security', 'appearance', 'chat', 'shortcuts', 'usage', 'privacy'] as const).map((s) => ({ id: `settings-${s}`, group: 'Settings', label: `Settings: ${s[0]!.toUpperCase()}${s.slice(1)}`, icon: <Settings size={16} />, run: go(() => void navigate({ to: `/settings/${s}` })) })),
      ...(hasPermission(me, 'admin:access') ? [{ id: 'admin', group: 'Admin', label: 'Admin console', icon: <Shield size={16} />, run: go(() => void navigate({ to: '/admin' })) }] : []),
      ...models.filter((m) => m.available).map((m) => ({ id: `model-${m.id}`, group: 'Default model', label: `Use ${m.displayName}`, hint: m.providerName, icon: <Bot size={16} />, run: go(() => updatePrefs.mutate({ defaultModel: m.id })) })),
      ...(conversations.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 30).map((c) => ({ id: `conv-${c.id}`, group: 'Recent chats', label: c.title, icon: <MessageSquare size={16} />, run: go(() => void navigate({ to: '/c/$conversationId', params: { conversationId: c.id } })) })),
    ];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length ? base.filter((i) => terms.every((t) => `${i.label} ${i.group}`.toLowerCase().includes(t))) : base.filter((i) => i.group !== 'Default model');
    const found = hits.map((h) => ({ id: `hit-${h.conversationId}`, group: 'Search results', label: h.title, hint: h.snippet, icon: <Search size={16} />, run: go(() => void navigate({ to: '/c/$conversationId', params: { conversationId: h.conversationId } })) }));
    return [...filtered.slice(0, 40), ...found.filter((f) => !filtered.some((x) => x.id === `conv-${f.id.slice(4)}`))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits, models, conversations.data, me, bindings]);

  useEffect(() => setActive(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(n);
      listRef.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-elevated shadow-lg" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Sparkles size={16} className="text-accent" aria-hidden="true" />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `pal-${active}` : undefined}
              aria-label="Search commands and chats"
              placeholder="Type a command or search your chats…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              className="h-12 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-3"
            />
          </div>
          <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-1">
            {items.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <div key={it.id} role="none">
                  {header ? <div role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold text-fg-2">{header}</div> : null}
                  <div id={`pal-${i}`} role="option" aria-selected={i === active} data-i={i} onMouseEnter={() => setActive(i)} onClick={it.run} className={cn('flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm', i === active && 'bg-hover')}>
                    <span className="text-fg-2" aria-hidden="true">{it.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg">{it.label}</span>
                      {it.group === 'Search results' && it.hint ? <span className="block truncate text-xs text-fg-2"><Snippet text={it.hint} /></span> : null}
                    </span>
                    {it.hint && it.group !== 'Search results' ? <span className="text-xs text-fg-2">{it.hint}</span> : null}
                  </div>
                </div>
              );
            })}
            {!items.length ? <p className="p-4 text-sm text-fg-2">No results.</p> : null}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
