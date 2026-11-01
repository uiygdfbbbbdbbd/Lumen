import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { estimateTokens } from '@lumen/llm';
import { Badge, Button, cn, IconButton, Popover, PopoverContent, PopoverTrigger, toast } from '@lumen/ui';
import { ArrowUp, Columns2, Loader2, Lock, Mic, MicOff, Paperclip, RotateCw, Square, Telescope, X } from 'lucide-react';
import { FileIcon } from '../files/FileIcon.js';
import { useAttachments } from '../files/useAttachments.js';
import { formatBytes } from '../../lib/i18n.js';
import { ModelSelector } from '../models/ModelSelector.js';
import { useModels } from '../models/useModels.js';

export interface ComposerHandle {
  focus(): void;
  insert(text: string): void;
}

interface SlashCommand {
  name: string;
  description: string;
  run: () => void;
}

interface Props {
  conversationId: string | undefined;
  modelId: string | null;
  onModelChange: (id: string) => void;
  streaming: boolean;
  sendWithEnter: boolean;
  onSend: (text: string, opts: { compareModelIds?: string[]; attachments?: string[]; research?: { depth: ResearchDepth } }) => Promise<void>;
  /** Whether Deep Research is available to this user (and why not). */
  research?: { allowed: boolean; reason?: string };
  projectId?: string | null;
  onStop: () => void;
  slashCommands: SlashCommand[];
  disabledReason?: string | null;
  placeholder?: string;
}

type ResearchDepth = 'quick' | 'standard' | 'deep';
const DEPTHS: { id: ResearchDepth; label: string; hint: string }[] = [
  { id: 'quick', label: 'Quick', hint: '~4 sources, about a minute' },
  { id: 'standard', label: 'Standard', hint: '~8 sources, a few minutes' },
  { id: 'deep', label: 'Deep', hint: '~14 sources, longer report' },
];

const HISTORY_KEY = 'lumen.promptHistory';
const draftKey = (id: string | undefined) => `lumen.draft.${id ?? 'new'}`;

type SpeechCtor = new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; start(): void; stop(): void };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(p, ref) {
  const [text, setText] = useState(() => localStorage.getItem(draftKey(p.conversationId)) ?? '');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [compare, setCompare] = useState<string[]>([]);
  const [research, setResearch] = useState<ResearchDepth | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<InstanceType<SpeechCtor> | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const att = useAttachments(p.projectId);
  const [sendWhenReady, setSendWhenReady] = useState(false);
  const { data: models = [] } = useModels();

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    insert: (t) => {
      setText((cur) => (cur ? `${cur}\n\n${t}` : t));
      setTimeout(() => ta.current?.focus(), 0);
    },
  }));

  // Drafts are saved per conversation and restored when switching back.
  useEffect(() => {
    setText(localStorage.getItem(draftKey(p.conversationId)) ?? '');
  }, [p.conversationId]);
  useEffect(() => {
    const t = setTimeout(() => (text ? localStorage.setItem(draftKey(p.conversationId), text) : localStorage.removeItem(draftKey(p.conversationId))), 300);
    return () => clearTimeout(t);
  }, [text, p.conversationId]);

  // Autosize.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  // Send a queued message once the current response finishes.
  useEffect(() => {
    if (!p.streaming && queued) {
      const q = queued;
      setQueued(null);
      void p.onSend(q, {});
    }
  }, [p.streaming, queued, p]);

  useEffect(() => {
    if (sendWhenReady && !att.busy) {
      setSendWhenReady(false);
      if (!att.hasErrors) void submit().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendWhenReady, att.busy]);

  const slashMatches = useMemo(() => (text.startsWith('/') && !text.includes(' ') ? p.slashCommands.filter((c) => c.name.startsWith(text.slice(1).toLowerCase())) : []), [text, p.slashCommands]);
  const tokens = useMemo(() => estimateTokens(text), [text]);

  async function submit() {
    const content = text.trim();
    if ((!content && !att.items.length) || p.disabledReason) return;
    if (att.busy) {
      // Send automatically as soon as the attachments finish processing.
      setSendWhenReady(true);
      return;
    }
    setSendWhenReady(false);
    if (slashMatches.length === 1 && content === `/${slashMatches[0]!.name}`) {
      slashMatches[0]!.run();
      setText('');
      return;
    }
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[];
    localStorage.setItem(HISTORY_KEY, JSON.stringify([content, ...history.filter((h) => h !== content)].slice(0, 50)));
    setHistoryIdx(-1);
    if (p.streaming) {
      setQueued(content);
      setText('');
      toast({ title: 'Queued', description: 'Your message will be sent when the current response finishes.' });
      return;
    }
    setText('');
    localStorage.removeItem(draftKey(p.conversationId));
    const attachments = att.readyIds;
    if (research) {
      try {
        await p.onSend(content, { research: { depth: research } });
        setResearch(null);
      } catch (e) {
        setText(content);
        throw e;
      }
      return;
    }
    try {
      await p.onSend(content, {
        ...(compare.length >= 1 ? { compareModelIds: [...new Set([p.modelId, ...compare].filter((x): x is string => Boolean(x) && x !== 'auto'))] } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      setCompare([]);
      att.clear();
    } catch (e) {
      setText(content);
      throw e;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const sendCombo = p.sendWithEnter ? e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing : e.key === 'Enter' && (e.metaKey || e.ctrlKey);
    if (sendCombo) {
      e.preventDefault();
      void submit().catch(() => undefined);
      return;
    }
    if (e.key === 'ArrowUp' && (!text || historyIdx >= 0) && ta.current?.selectionStart === 0) {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[];
      const next = Math.min(history.length - 1, historyIdx + 1);
      if (next >= 0 && history[next]) {
        e.preventDefault();
        setHistoryIdx(next);
        setText(history[next]!);
      }
    } else if (e.key === 'ArrowDown' && historyIdx >= 0) {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[];
      e.preventDefault();
      const next = historyIdx - 1;
      setHistoryIdx(next);
      setText(next >= 0 ? (history[next] ?? '') : '');
    } else if (e.key === 'Escape' && p.streaming) p.onStop();
  }

  function toggleDictation() {
    const Ctor = (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;
    if (!Ctor) return toast.error('Voice dictation is not supported in this browser.');
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = document.documentElement.lang || 'en';
    r.interimResults = false;
    r.continuous = true;
    const base = text;
    let said = '';
    r.onresult = (e) => {
      said = Array.from(e.results).map((x) => x[0]!.transcript).join(' ');
      setText(base ? `${base} ${said}` : said);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  }

  return (
    <div
      className={cn('relative rounded-lg border bg-elevated shadow-sm focus-within:border-accent', dragging ? 'border-accent ring-2 ring-accent' : 'border-border')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) att.add([...e.dataTransfer.files]);
      }}
    >
      {dragging ? <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-accent-soft/80 text-sm font-medium text-fg">Drop files to attach</div> : null}
      {att.items.length ? (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
          {att.items.map((a) => (
            <li key={a.localId} className="flex max-w-64 items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs">
              {a.previewUrl ? <img src={a.previewUrl} alt="" className="h-8 w-8 rounded-sm object-cover" /> : <FileIcon kind={a.kind} />}
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg">{a.name}</span>
                <span className={cn('block', ['error', 'failed', 'quarantined'].includes(a.status) ? 'text-danger' : 'text-fg-2')} title={a.error ?? undefined}>
                  {a.status === 'uploading' ? `Uploading ${Math.round(a.progress * 100)}%` : a.status === 'ready' ? formatBytes(a.size) : a.status === 'queued' || a.status === 'processing' ? 'Processing…' : (a.error ?? 'Failed')}
                </span>
              </span>
              {a.status === 'uploading' || a.status === 'queued' || a.status === 'processing' ? <Loader2 size={12} className="animate-spin text-fg-2" aria-hidden="true" /> : null}
              {a.status === 'error' || a.status === 'failed' ? <button type="button" aria-label={`Retry ${a.name}`} onClick={() => att.retry(a.localId)}><RotateCw size={12} aria-hidden="true" /></button> : null}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => att.remove(a.localId)}><X size={12} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {slashMatches.length ? (
        <ul role="listbox" aria-label="Commands" className="absolute bottom-full left-0 mb-2 w-72 rounded-md border border-border bg-elevated p-1 shadow-md">
          {slashMatches.map((c) => (
            <li key={c.name} role="option" aria-selected={false} className="cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-hover" onMouseDown={(e) => { e.preventDefault(); c.run(); setText(''); }}>
              <span className="font-medium">/{c.name}</span> <span className="text-fg-2">{c.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {compare.length ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 text-xs text-fg-2">
          Comparing with:
          {compare.map((id) => (
            <Badge key={id} tone="accent">
              {models.find((m) => m.id === id)?.displayName ?? id}
              <button type="button" aria-label="Remove from comparison" onClick={() => setCompare(compare.filter((c) => c !== id))}><X size={10} aria-hidden="true" /></button>
            </Badge>
          ))}
        </div>
      ) : null}
      {queued ? <div className="border-b border-border px-3 py-1.5 text-xs text-fg-2">Queued: “{queued.slice(0, 80)}”</div> : null}
      {sendWhenReady ? <div role="status" className="border-b border-border px-3 py-1.5 text-xs text-fg-2">Will send when your files finish processing…</div> : null}
      <textarea
        ref={ta}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setHistoryIdx(-1);
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            att.add(files);
          }
        }}
        rows={1}
        disabled={Boolean(p.disabledReason)}
        placeholder={p.disabledReason ?? p.placeholder ?? 'Message Lumen…  (type / for commands)'}
        aria-label="Message"
        className="block max-h-[40vh] min-h-12 w-full resize-none bg-transparent px-4 pt-3 text-fg outline-none placeholder:text-fg-3 disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <IconButton size="icon" label="Attach files" icon={<Paperclip size={18} />} onClick={() => fileInput.current?.click()} />
        <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Choose files to attach" onChange={(e) => { if (e.target.files?.length) att.add([...e.target.files]); e.target.value = ''; }} />
        <ModelSelector value={p.modelId} onChange={p.onModelChange} allowAuto className="h-8 border-0 bg-transparent" />
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn('flex h-8 items-center gap-1 rounded-md px-2 text-xs text-fg-2 hover:bg-hover', compare.length && 'text-accent')} aria-label="Compare models">
              <Columns2 size={14} aria-hidden="true" /> Compare
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <p className="mb-2 text-xs text-fg-2">Send to up to 3 more models and see answers side by side.</p>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {models.filter((m) => m.available && m.id !== p.modelId).map((m) => (
                <li key={m.id}>
                  <label className="flex items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-hover">
                    <input type="checkbox" checked={compare.includes(m.id)} disabled={!compare.includes(m.id) && compare.length >= 3} onChange={(e) => setCompare(e.target.checked ? [...compare, m.id] : compare.filter((c) => c !== m.id))} />
                    {m.displayName}
                  </label>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn('flex h-8 items-center gap-1 rounded-md px-2 text-xs text-fg-2 hover:bg-hover', research && 'bg-accent-soft text-accent')} aria-label={research ? `Deep research: ${research}` : 'Deep research'} aria-pressed={Boolean(research)}>
              <Telescope size={14} aria-hidden="true" /> Research
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <p className="text-sm font-medium text-fg">Deep research</p>
            <p className="mb-2 text-xs text-fg-2">Searches the web from several angles, reads the best sources and writes a cited report. It keeps running if you close the page.</p>
            {p.research && !p.research.allowed ? (
              <p className="flex items-center gap-1.5 text-xs text-warning"><Lock size={12} aria-hidden="true" /> {p.research.reason === 'EMAIL_UNVERIFIED' ? 'Verify your email to use Deep Research.' : 'Deep Research isn’t available on your plan.'}</p>
            ) : (
              <div role="radiogroup" aria-label="Research depth" className="flex flex-col gap-1">
                {DEPTHS.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 text-sm hover:bg-hover">
                    <input type="radio" name="research-depth" checked={research === d.id} onChange={() => setResearch(d.id)} className="mt-1" />
                    <span>{d.label}<span className="block text-xs text-fg-2">{d.hint}</span></span>
                  </label>
                ))}
                {research ? <Button size="sm" variant="ghost" onClick={() => setResearch(null)}>Turn off</Button> : null}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <span className="ml-auto text-xs text-fg-3" aria-live="off">{text ? `~${tokens.toLocaleString()} tokens` : ''}</span>
        <IconButton size="icon" label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={listening} icon={listening ? <MicOff size={18} /> : <Mic size={18} />} onClick={toggleDictation} />
        {p.streaming && !text ? (
          <IconButton size="icon" variant="secondary" label="Stop generating" icon={<Square size={16} />} onClick={p.onStop} />
        ) : (
          <IconButton size="icon" variant="primary" label={p.streaming ? 'Queue message' : 'Send message'} icon={<ArrowUp size={18} />} disabled={(!text.trim() && !att.items.length) || Boolean(p.disabledReason)} onClick={() => void submit().catch(() => undefined)} />
        )}
      </div>
    </div>
  );
});
