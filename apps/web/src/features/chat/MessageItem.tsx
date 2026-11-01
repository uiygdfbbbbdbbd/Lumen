import { memo, useState } from 'react';
import { Avatar, Banner, Button, IconButton, Textarea, Tooltip, cn, toast } from '@lumen/ui';
import { Brain, ChevronDown, ChevronLeft, ChevronRight, Copy, Pencil, Quote, RefreshCw, Square, ThumbsDown, ThumbsUp, Trash2, Volume2 } from 'lucide-react';
import { Markdown } from './Markdown.js';
import { SourcesList } from './Citations.js';
import { FileIcon } from '../files/FileIcon.js';
import { fileUrl } from '../files/upload.js';
import type { Citation } from './store.js';
import { ToolCard } from './ToolCard.js';
import { ArtifactCard, ARTIFACT_TOOLS } from '../artifacts/ArtifactCard.js';
import { MEMORY_TOOL_NAMES, MemoryToolCard, MemoryUsed } from '../memory/MemoryUsed.js';
import { AskUserCard, InlineChart, InlineDiagram, WebToolRow } from './ToolViews.js';
import { ResearchCard } from '../research/ResearchCard.js';
import type { LiveStream } from './store.js';
import type { ChatMessage } from './types.js';

export interface MessageActions {
  onEdit: (id: string, content: string) => Promise<void>;
  onRegenerate: (id: string, modelId?: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onSwitch: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRate: (id: string, rating: -1 | 0 | 1) => Promise<void>;
  onQuote: (text: string) => void;
  onTryAnotherModel: (id: string) => void;
  /** Answer a clarifying question card (sent as the next user message). */
  onAnswer?: (text: string) => void;
}

interface Props extends MessageActions {
  message: ChatMessage;
  live: LiveStream | undefined;
  siblings: { list: ChatMessage[]; position: number };
  user: { name: string; avatarUrl: string | null; id: string };
  /** Last message in the active branch (question cards can still be answered). */
  isLast?: boolean;
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return toast.error('Read aloud is not supported in this browser.');
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[#*_`>]/g, ''));
  window.speechSynthesis.speak(u);
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-md border border-border bg-surface text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg-2">
        <Brain size={14} aria-hidden="true" />
        {streaming ? 'Thinking…' : 'Thought process'}
        <ChevronDown size={14} aria-hidden="true" className={cn('ml-auto lm-transition transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-xs text-fg-2">{text}</div> : null}
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ message: m, live, siblings, user, isLast = false, ...a }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const streaming = m.status === 'streaming' && (!live || live.status === 'streaming');
  const text = live && m.status === 'streaming' ? live.text : m.content;
  const reasoning = live && m.status === 'streaming' ? live.reasoning : String((m.parts.find((p) => p.type === 'reasoning') as { text?: string } | undefined)?.text ?? '');
  const tools =
    live && m.status === 'streaming'
      ? live.tools
      : m.parts
          .filter((p) => p.type === 'tool_call')
          .map((p) => {
            const r = m.parts.find((x) => x.type === 'tool_result' && x.id === p.id) as { content: string; isError: boolean } | undefined;
            return { id: String(p.id), name: String(p.name), arguments: p.arguments as Record<string, unknown>, result: r ? { content: r.content, isError: r.isError } : undefined };
          });
  const error = live?.error ?? (m.status === 'error' ? m.error : null);
  const citations = (live && m.status === 'streaming' ? live.citations : (m.parts.filter((p) => p.type === 'citation') as unknown as Citation[])) ?? [];
  const memoryIds = (live && m.status === 'streaming' ? live.memoryIds : ((m.parts.find((p) => p.type === 'memory') as { ids?: string[] } | undefined)?.ids ?? [])) ?? [];
  const researchRunId = (m.parts.find((p) => p.type === 'research') as { runId?: string } | undefined)?.runId;
  const attachments = m.parts.filter((p) => p.type === 'attachment') as unknown as { fileId: string; name: string; kind: string }[];

  if (m.role === 'user') {
    return (
      <article aria-label="Your message" className="group flex justify-end gap-3 py-3" data-message-id={m.id}>
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
          {editing ? (
            <form
              className="flex w-[min(40rem,80vw)] flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setEditing(false);
                await a.onEdit(m.id, draft);
              }}
            >
              <Textarea aria-label="Edit message" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus className="min-h-24" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" type="submit" disabled={!draft.trim()}>Save & resend</Button>
              </div>
            </form>
          ) : (
            <>
              {attachments.length ? (
                <ul aria-label="Attachments" className="flex flex-wrap justify-end gap-2">
                  {attachments.map((a) => (
                    <li key={a.fileId}>
                      {a.kind === 'image' ? (
                        <a href={fileUrl(a.fileId)} target="_blank" rel="noreferrer"><img src={fileUrl(a.fileId)} alt={a.name} className="max-h-40 max-w-60 rounded-md border border-border object-cover" loading="lazy" /></a>
                      ) : (
                        <a href={fileUrl(a.fileId, true)} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg hover:bg-hover"><FileIcon kind={a.kind} /> {a.name}</a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {m.content ? <div className="max-w-full whitespace-pre-wrap rounded-lg bg-accent-soft px-4 py-2.5 text-fg [overflow-wrap:anywhere]">{m.content}</div> : null}
            </>
          )}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <BranchNav siblings={siblings} onSwitch={a.onSwitch} />
            <IconButton size="icon-sm" label="Copy message" icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(m.content).then(() => toast.success('Copied'))} />
            <IconButton size="icon-sm" label="Edit message" icon={<Pencil size={14} />} onClick={() => { setDraft(m.content); setEditing(true); }} />
          </div>
        </div>
        <Avatar src={user.avatarUrl} name={user.name} seed={user.id} size={28} className="mt-1" />
      </article>
    );
  }

  return (
    <article aria-label={`Response${m.modelName ? ` from ${m.modelName}` : ''}`} aria-busy={streaming} className="group py-3" data-message-id={m.id}>
      {live?.fallback ? <p className="mb-2 text-xs text-warning">{live.fallback}</p> : null}
      {live?.compacted ? <p className="mb-2 text-xs text-fg-2">Earlier messages were summarized to fit the model’s context window.</p> : null}
      {researchRunId ? <ResearchCard runId={researchRunId} live={live?.research ?? null} onStop={streaming ? () => void a.onCancel(m.id) : undefined} /> : null}
      {reasoning ? <Reasoning text={reasoning} streaming={streaming && !text} /> : null}
      {tools.map((t) =>
        ARTIFACT_TOOLS.has(t.name) ? (
          <ArtifactCard key={t.id} name={t.name} args={t.arguments} result={t.result} live={live?.artifacts} />
        ) : t.name === 'ask_user' ? (
          <AskUserCard key={t.id} args={t.arguments} answerable={isLast && !streaming} onAnswer={a.onAnswer} />
        ) : t.name === 'show_chart' ? (
          <InlineChart key={t.id} args={t.arguments} result={t.result} />
        ) : t.name === 'show_diagram' ? (
          <InlineDiagram key={t.id} args={t.arguments} result={t.result} />
        ) : t.name === 'web_search' || t.name === 'web_fetch' ? (
          <WebToolRow key={t.id} name={t.name} args={t.arguments} result={t.result} />
        ) : MEMORY_TOOL_NAMES.has(t.name) ? (
          <MemoryToolCard key={t.id} name={t.name} args={t.arguments} result={t.result} />
        ) : (
          <ToolCard key={t.id} name={t.name} args={t.arguments} result={t.result} />
        ),
      )}
      {text ? <Markdown text={text} citations={citations} /> : streaming ? <span className="inline-flex gap-1 py-2" aria-label="Generating"><span className="h-2 w-2 animate-pulse rounded-full bg-fg-3" /><span className="h-2 w-2 animate-pulse rounded-full bg-fg-3 [animation-delay:150ms]" /><span className="h-2 w-2 animate-pulse rounded-full bg-fg-3 [animation-delay:300ms]" /></span> : null}
      {!streaming ? <SourcesList citations={citations} /> : null}
      {live?.reconnecting ? <p className="mt-1 text-xs text-fg-2" role="status">Reconnecting… your response is still being generated.</p> : null}
      {m.status === 'cancelled' || live?.status === 'cancelled' ? <p className="mt-1 text-xs text-fg-2">Stopped.</p> : null}
      {error ? (
        <Banner
          tone="critical"
          className="mt-2"
          title={error.code === 'QUOTA_EXCEEDED' ? 'Daily limit reached' : error.code === 'RATE_LIMITED' ? 'Rate limited' : error.code === 'CONTENT_BLOCKED' ? 'Blocked by the provider' : 'The response failed'}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => a.onRegenerate(m.id)}><RefreshCw size={14} aria-hidden="true" /> Retry</Button>
              <Button size="sm" variant="secondary" onClick={() => a.onTryAnotherModel(m.id)}>Try another model</Button>
            </div>
          }
        >
          {error.message}
          {error.resetAt ? ` Resets ${new Date(error.resetAt).toLocaleString()}.` : ''}
        </Banner>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-fg-2">
        <BranchNav siblings={siblings} onSwitch={a.onSwitch} />
        {streaming ? (
          <Button size="sm" variant="secondary" onClick={() => a.onCancel(m.id)}><Square size={12} aria-hidden="true" /> Stop</Button>
        ) : (
          <>
            <IconButton size="icon-sm" label="Copy response" icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(m.content).then(() => toast.success('Copied'))} />
            <IconButton size="icon-sm" label="Regenerate" icon={<RefreshCw size={14} />} onClick={() => a.onRegenerate(m.id)} />
            <IconButton size="icon-sm" label="Good response" aria-pressed={m.rating === 1} icon={<ThumbsUp size={14} fill={m.rating === 1 ? 'currentColor' : 'none'} />} onClick={() => a.onRate(m.id, m.rating === 1 ? 0 : 1)} />
            <IconButton size="icon-sm" label="Bad response" aria-pressed={m.rating === -1} icon={<ThumbsDown size={14} fill={m.rating === -1 ? 'currentColor' : 'none'} />} onClick={() => a.onRate(m.id, m.rating === -1 ? 0 : -1)} />
            <IconButton size="icon-sm" label="Quote in reply" icon={<Quote size={14} />} onClick={() => a.onQuote(window.getSelection()?.toString() || m.content)} />
            <IconButton size="icon-sm" label="Read aloud" icon={<Volume2 size={14} />} onClick={() => speak(m.content)} />
            <IconButton size="icon-sm" label="Delete response" icon={<Trash2 size={14} />} onClick={() => a.onDelete(m.id)} />
            <MemoryUsed ids={memoryIds} />
            {m.modelName ? (
              <Tooltip content={m.usage ? `${m.usage.inputTokens} in · ${m.usage.outputTokens} out${m.usage.latencyMs ? ` · ${(m.usage.latencyMs / 1000).toFixed(1)}s` : ''}` : m.modelName}>
                <span tabIndex={0} className="ml-1 text-xs">{m.modelName}</span>
              </Tooltip>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
});

function BranchNav({ siblings, onSwitch }: { siblings: { list: ChatMessage[]; position: number }; onSwitch: (id: string) => Promise<void> }) {
  if (siblings.list.length < 2) return null;
  const { list, position } = siblings;
  return (
    <span className="flex items-center text-xs text-fg-2" role="group" aria-label="Versions">
      <IconButton size="icon-sm" label="Previous version" icon={<ChevronLeft size={14} />} disabled={position <= 1} onClick={() => onSwitch(list[position - 2]!.id)} />
      <span aria-live="polite">{position} / {list.length}</span>
      <IconButton size="icon-sm" label="Next version" icon={<ChevronRight size={14} />} disabled={position >= list.length} onClick={() => onSwitch(list[position]!.id)} />
    </span>
  );
}
