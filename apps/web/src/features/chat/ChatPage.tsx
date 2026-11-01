import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { BUILTIN_STYLES } from '@lumen/shared';
import { Badge, Banner, Button, Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Field, IconButton, Select, Skeleton, Textarea, Tooltip, toast } from '@lumen/ui';
import { Archive, Brain, Copy, EyeOff, Layers, MoreHorizontal, NotebookPen, Star, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { useMe } from '../../lib/auth.js';
import { greetingKey, t } from '../../lib/i18n.js';
import { usePreferences } from '../models/useModels.js';
import { startersFor } from '../shell/starters.js';
import { usePatchConversation } from './api.js';
import { Composer, type ComposerHandle } from './Composer.js';
import { MessageList } from './MessageList.js';
import { useStreams } from './store.js';
import { useChat } from './useChat.js';
import { ArtifactWorkspace } from '../artifacts/ArtifactWorkspace.js';
import { ArtifactTypeIcon } from '../artifacts/ArtifactCard.js';
import { useConversationArtifacts } from '../artifacts/api.js';
import { useArtifactPanel } from '../artifacts/panel.js';

function ContextMeter({ used, total }: { used: number; total: number }) {
  const ratio = Math.min(1, used / Math.max(1, total));
  const color = ratio > 0.9 ? 'var(--lm-danger)' : ratio > 0.7 ? 'var(--lm-warning)' : 'var(--lm-accent)';
  return (
    <Tooltip content={`Context: ~${used.toLocaleString()} of ${total.toLocaleString()} tokens. Older messages are summarized automatically when it fills up.`}>
      <span tabIndex={0} role="meter" aria-label="Context window used" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} className="flex items-center gap-1.5 text-xs text-fg-2">
        <svg width="16" height="16" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--lm-border)" strokeWidth="5" />
          <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${ratio * 94.2} 94.2`} transform="rotate(-90 18 18)" />
        </svg>
        {Math.round(ratio * 100)}%
      </span>
    </Tooltip>
  );
}

export function ChatPage({ incognitoDefault = false }: { incognitoDefault?: boolean }) {
  const params = useParams({ strict: false }) as { conversationId?: string };
  const conversationId = params.conversationId;
  const search = useSearch({ strict: false }) as { project?: string; prompt?: string };
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  const chat = useChat(conversationId);
  const patch = usePatchConversation();
  const composer = useRef<ComposerHandle>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [incognito, setIncognito] = useState(incognitoDefault);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const streams = useStreams((s) => s.streams);
  const styles = useQuery({ queryKey: ['styles'], queryFn: () => api<{ builtin: { id: string; name: string }[]; custom: { id: string; name: string }[] }>('/api/styles') });

  const conv = chat.tree.data?.conversation;
  const qc = useQueryClient();
  const panel = useArtifactPanel();
  const convArtifacts = useConversationArtifacts(conversationId);
  const seenArtifactEvents = useRef(new Set<string>());

  // Each chat has its own artifacts: close the panel when switching chats.
  const closePanel = panel.close;
  useEffect(() => closePanel, [conversationId, closePanel]);

  // When the model creates or edits an artifact, refresh it and show it.
  const openPanel = panel.open;
  useEffect(() => {
    for (const m of chat.path) {
      for (const ev of streams[m.id]?.artifacts ?? []) {
        const key = `${m.id}:${ev.id}:${ev.version}`;
        if (seenArtifactEvents.current.has(key)) continue;
        seenArtifactEvents.current.add(key);
        void qc.invalidateQueries({ queryKey: ['artifacts'] });
        openPanel(ev.id);
      }
    }
  }, [chat.path, streams, qc, openPanel]);
  const projectId = conv?.projectId ?? (!conversationId ? (search.project ?? null) : null);
  const project = useQuery({ queryKey: ['project-name', projectId], queryFn: () => api<{ project: { id: string; name: string; color: string } }>(`/api/projects/${projectId}`).then((r) => r.project), enabled: Boolean(projectId), staleTime: 60_000 });
  useEffect(() => {
    if (search.prompt && !conversationId) composer.current?.insert(search.prompt);
  }, [search.prompt, conversationId]);
  const modelId = modelOverride ?? conv?.modelId ?? prefs?.defaultModel ?? 'auto';
  const streamingIds = chat.path.filter((m) => m.status === 'streaming' && streams[m.id]?.status !== 'done').map((m) => m.id);
  const compactedThrough = useMemo(() => new Set((chat.tree.data?.compactions ?? []).map((c) => c.throughMessageId)), [chat.tree.data?.compactions]);
  const lastUsage = useMemo(() => {
    for (const id of streamingIds) if (streams[id]?.usage) return streams[id]!.usage;
    const last = [...chat.path].reverse().find((m) => m.usage);
    return last?.usage ? { contextTokens: last.usage.inputTokens + last.usage.outputTokens, contextWindow: 0 } : null;
  }, [chat.path, streams, streamingIds]);

  if (!me) return null;
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error('Something went wrong', errorMessage(e));
    }
  };

  const slashCommands = [
    { name: 'new', description: 'Start a new chat', run: () => void navigate({ to: '/' }) },
    { name: 'temp', description: 'Start a temporary chat', run: () => void navigate({ to: '/temporary' }) },
    { name: 'instructions', description: 'Edit instructions for this chat', run: () => { setInstructions(conv?.instructions ?? ''); setInstructionsOpen(true); } },
    { name: 'settings', description: 'Open chat settings', run: () => void navigate({ to: '/settings/chat' }) },
  ];

  const empty = !conversationId;
  const hour = new Date().getHours();
  const starters = startersFor(me.user.onboarding.useCases);
  const usageNumbers = lastUsage && lastUsage.contextWindow ? lastUsage : null;

  const sendText = async (text: string) => {
    try {
      await chat.send(text, { ...(modelId !== 'auto' ? { modelId } : {}), incognito, projectId });
    } catch (e) {
      toast.error('Message not sent', errorMessage(e));
    }
  };

  return (
    <ArtifactWorkspace onAsk={conversationId ? (t) => void sendText(t) : undefined}>
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        {conv && titleEditing ? (
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('title') as string; setTitleEditing(false); if (v.trim()) patch.mutate({ id: conv.id, title: v.trim() }); }}>
            <input name="title" defaultValue={conv.title} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Chat title" className="w-full rounded-sm bg-surface px-2 py-1 text-sm font-medium text-fg outline-none" />
          </form>
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
            {conv ? <button type="button" onClick={() => setTitleEditing(true)} className="max-w-full truncate rounded-sm px-1 hover:bg-hover" title="Rename">{conv.title}</button> : incognito ? 'Temporary chat' : 'New chat'}
          </h1>
        )}
        {project.data ? <Link to="/projects/$projectId" params={{ projectId: project.data.id }} className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-fg-2 hover:bg-hover"><span className="h-2 w-2 rounded-full" style={{ background: project.data.color }} aria-hidden="true" />{project.data.name}</Link> : null}
        {conv?.incognito || (!conv && incognito) ? <Badge tone="warning"><EyeOff size={10} aria-hidden="true" /> Temporary — not saved to history</Badge> : null}
        {convArtifacts.data?.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={`Artifacts in this chat (${convArtifacts.data.length})`}><Layers size={14} aria-hidden="true" /> {convArtifacts.data.length}</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {convArtifacts.data.map((a) => <DropdownMenuItem key={a.id} onSelect={() => panel.open(a.id)}><ArtifactTypeIcon type={a.type} /> <span className="max-w-64 truncate">{a.title}</span></DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {usageNumbers ? <ContextMeter used={usageNumbers.contextTokens} total={usageNumbers.contextWindow} /> : null}
        {conv ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><IconButton label="Chat options" icon={<MoreHorizontal size={18} />} /></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => { setInstructions(conv.instructions); setInstructionsOpen(true); }}><NotebookPen size={16} aria-hidden="true" /> Instructions & style</DropdownMenuItem>
              {!conv.incognito ? (
                <DropdownMenuItem onSelect={() => patch.mutate({ id: conv.id, settings: { useMemory: conv.settings.useMemory === false } })}>
                  <Brain size={16} aria-hidden="true" /> {conv.settings.useMemory === false ? 'Use memory in this chat' : 'Don’t use memory in this chat'}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => patch.mutate({ id: conv.id, starred: !conv.starred })}><Star size={16} aria-hidden="true" /> {conv.starred ? 'Unstar' : 'Star'}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(async () => { const c = await api<{ id: string }>(`/api/conversations/${conv.id}/duplicate`, { method: 'POST' }); await navigate({ to: '/c/$conversationId', params: { conversationId: c.id } }); })}><Copy size={16} aria-hidden="true" /> Duplicate</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => patch.mutate({ id: conv.id, archived: !conv.archived })}><Archive size={16} aria-hidden="true" /> {conv.archived ? 'Unarchive' : 'Archive'}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => run(async () => {
                await api(`/api/conversations/${conv.id}`, { method: 'DELETE' });
                await navigate({ to: '/' });
                toast({ title: 'Chat deleted', action: { label: 'Undo', onClick: () => void api(`/api/conversations/${conv.id}/restore`, { method: 'POST' }).then(() => navigate({ to: '/c/$conversationId', params: { conversationId: conv.id } })) } });
              })}><Trash2 size={16} aria-hidden="true" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      {conv?.incognito && conv.expiresAt ? <Banner tone="warning" className="rounded-none border-x-0 border-t-0">This temporary chat doesn’t use memory and is deleted {new Date(conv.expiresAt).toLocaleString()}.</Banner> : null}

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4">
          <h2 className="text-center text-3xl font-semibold tracking-tight">{incognito ? 'Temporary chat' : t(greetingKey(hour), { name: me.user.displayName.split(' ')[0] ?? '' })}</h2>
          {incognito ? <p className="max-w-md text-center text-sm text-fg-2">Nothing from this chat is saved to your history or memory. It’s deleted within 24 hours.</p> : null}
          {prefs?.showSuggestions !== false && !incognito ? (
            <section aria-label="Suggested prompts" className="grid w-full max-w-[var(--lm-chat-width)] gap-3 sm:grid-cols-2">
              {starters.map((s) => (
                <button key={s.title} type="button" onClick={() => composer.current?.insert(s.prompt)} className="rounded-lg border border-border bg-elevated p-4 text-left hover:bg-hover">
                  <span className="block text-sm font-medium text-fg">{s.title}</span>
                  <span className="mt-1 line-clamp-2 block text-xs text-fg-2">{s.prompt}</span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      ) : chat.tree.isLoading ? (
        <div className="mx-auto flex w-full max-w-[var(--lm-chat-width)] flex-1 flex-col gap-4 p-4"><Skeleton className="h-16" /><Skeleton className="h-32" /></div>
      ) : chat.tree.isError ? (
        <div className="flex flex-1 items-center justify-center p-4"><Banner tone="critical" title="Couldn’t load this chat">{errorMessage(chat.tree.error)}</Banner></div>
      ) : (
        <MessageList
          path={chat.path}
          idx={chat.idx}
          compactedThrough={compactedThrough}
          user={{ name: me.user.displayName, avatarUrl: me.user.avatarUrl, id: me.user.id }}
          onEdit={(id, c) => run(() => chat.edit(id, c))}
          onRegenerate={(id, m) => run(() => chat.regenerate(id, m))}
          onCancel={(id) => chat.cancel(id)}
          onSwitch={(id) => run(() => chat.switchTo(id))}
          onDelete={(id) => run(() => chat.remove(id))}
          onRate={(id, r) => run(() => chat.rate(id, r))}
          onQuote={(text) => composer.current?.insert(text.split('\n').map((l) => `> ${l}`).join('\n'))}
          onTryAnotherModel={() => document.querySelector<HTMLButtonElement>('[aria-label^="Model:"]')?.click()}
        />
      )}

      <div className="mx-auto w-full max-w-[var(--lm-chat-width)] px-4 pb-4 pt-2">
        <Composer
          ref={composer}
          conversationId={conversationId}
          projectId={projectId}
          modelId={modelId}
          onModelChange={(id) => {
            setModelOverride(id);
            if (conv) patch.mutate({ id: conv.id, modelId: id === 'auto' ? null : id });
          }}
          streaming={streamingIds.length > 0}
          sendWithEnter={prefs?.sendWithEnter ?? true}
          slashCommands={slashCommands}
          onStop={() => streamingIds.forEach((id) => void chat.cancel(id))}
          onSend={async (text, opts) => {
            try {
              await chat.send(text, { ...(modelId !== 'auto' ? { modelId } : {}), ...opts, incognito, projectId });
            } catch (e) {
              toast.error('Message not sent', errorMessage(e));
              throw e;
            }
          }}
        />
        <p className="mt-1.5 text-center text-[11px] text-fg-3">AI can make mistakes. Check important information.</p>
        {empty ? (
          <div className="mt-1 flex justify-center">
            <Button size="sm" variant="ghost" aria-pressed={incognito} onClick={() => setIncognito((v) => !v)}><EyeOff size={14} aria-hidden="true" /> {incognito ? 'Temporary chat on' : 'Temporary chat'}</Button>
          </div>
        ) : null}
      </div>

      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent title="Instructions for this chat" description="These apply only here and take precedence over your general custom instructions.">
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (conv) patch.mutate({ id: conv.id, instructions }); setInstructionsOpen(false); }}>
            <Field label="Instructions" hint={`${instructions.length}/8000`}><Textarea value={instructions} maxLength={8000} onChange={(e) => setInstructions(e.target.value)} className="min-h-32" /></Field>
            <Field label="Response style">
              <Select value={conv?.settings.styleId ?? 'normal'} onChange={(e) => conv && patch.mutate({ id: conv.id, settings: { styleId: e.target.value } })}>
                {(styles.data?.builtin ?? Object.entries(BUILTIN_STYLES).map(([id, s]) => ({ id, name: s.name }))).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {styles.data?.custom.length ? <optgroup label="Your styles">{styles.data.custom.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null}
              </Select>
            </Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setInstructionsOpen(false)}>Cancel</Button><Button type="submit">Save</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </ArtifactWorkspace>
  );
}
