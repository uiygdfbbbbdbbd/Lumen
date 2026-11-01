import { lazy, Suspense, useState } from 'react';
import { Button, Checkbox, Input, cn } from '@lumen/ui';
import { CheckCircle2, FileSearch, Globe, Loader2, MessageCircleQuestion, XCircle } from 'lucide-react';
import { useImages } from '../images/api.js';
import { ImageCard } from '../images/ImageCard.js';

const ChartView = lazy(() => import('../artifacts/renderers/ChartView.js').then((m) => ({ default: m.ChartView })));
const Mermaid = lazy(() => import('./Mermaid.js'));

export const INLINE_TOOLS = new Set(['ask_user', 'show_chart', 'show_diagram', 'web_search', 'web_fetch', 'generate_image']);

type Result = { content: string; isError: boolean } | undefined;

interface AskArgs {
  question?: string;
  options?: ({ label?: string; description?: string } | string)[];
  multiSelect?: boolean;
  allowOther?: boolean;
}

/** Clarifying question from the model: click an option (or several, or type) to answer. */
export function AskUserCard({ args, answerable, onAnswer }: { args: AskArgs; answerable: boolean; onAnswer?: (text: string) => void }) {
  const options = (args.options ?? []).map((o) => (typeof o === 'string' ? { label: o } : { label: String(o.label ?? ''), description: o.description })).filter((o) => o.label);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [sent, setSent] = useState(false);
  const enabled = answerable && !sent && Boolean(onAnswer);
  const send = (text: string) => {
    if (!enabled || !text.trim()) return;
    setSent(true);
    onAnswer!(text.trim());
  };
  return (
    <fieldset className="my-2 rounded-lg border border-border bg-elevated p-3" disabled={!enabled}>
      <legend className="flex items-center gap-2 px-1 text-sm font-medium text-fg"><MessageCircleQuestion size={16} aria-hidden="true" className="text-accent" /> {args.question}</legend>
      {args.multiSelect ? (
        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <label key={o.label} className="flex items-start gap-2 text-sm text-fg">
              <Checkbox checked={picked.includes(o.label)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, o.label] : p.filter((x) => x !== o.label)))} className="mt-0.5" />
              <span>{o.label}{o.description ? <span className="block text-xs text-fg-2">{o.description}</span> : null}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button key={o.label} size="sm" variant="secondary" onClick={() => send(o.label)} title={o.description} className="h-auto min-h-8 flex-col items-start py-1.5">
              <span>{o.label}</span>
              {o.description ? <span className="text-xs font-normal text-fg-2">{o.description}</span> : null}
            </Button>
          ))}
        </div>
      )}
      {args.allowOther !== false || args.multiSelect ? (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send([...picked, other.trim()].filter(Boolean).join(', ')); }}>
          {args.allowOther !== false ? <Input aria-label="Other answer" placeholder="Or type your own answer…" value={other} onChange={(e) => setOther(e.target.value)} className="h-8" /> : null}
          <Button type="submit" size="sm" disabled={!enabled || (!picked.length && !other.trim())}>Answer</Button>
        </form>
      ) : null}
      {!answerable || sent ? <p className="mt-2 text-xs text-fg-2">{sent ? 'Answer sent.' : 'Answered.'}</p> : null}
    </fieldset>
  );
}

export function InlineChart({ args, result }: { args: Record<string, unknown>; result: Result }) {
  if (result?.isError) return <WebRow icon="error" text={`Chart couldn’t be drawn: ${result.content.replace(/^Error:\s*/, '')}`} />;
  if (!result) return <WebRow icon="running" text="Drawing chart…" />;
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <Suspense fallback={<div className="h-64 animate-pulse bg-surface" />}>
        <ChartView content={JSON.stringify(args)} />
      </Suspense>
    </div>
  );
}

export function InlineDiagram({ args, result }: { args: Record<string, unknown>; result: Result }) {
  if (!result) return <WebRow icon="running" text="Drawing diagram…" />;
  if (result.isError) return <WebRow icon="error" text="Diagram couldn’t be drawn." />;
  return (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-surface" />}>
      <Mermaid code={String(args.code ?? '')} />
    </Suspense>
  );
}

function WebRow({ icon, text, detail }: { icon: 'running' | 'error' | 'search' | 'page' | 'done'; text: string; detail?: string }) {
  const Icon = icon === 'running' ? Loader2 : icon === 'error' ? XCircle : icon === 'search' ? Globe : icon === 'page' ? FileSearch : CheckCircle2;
  return (
    <div className="my-1.5 flex items-start gap-2 text-sm text-fg-2" role="status">
      <Icon size={14} aria-hidden="true" className={cn('mt-0.5 shrink-0', icon === 'running' && 'animate-spin', icon === 'error' ? 'text-danger' : 'text-accent')} />
      <span className="min-w-0">
        {text}
        {detail ? <span className="block truncate text-xs text-fg-3">{detail}</span> : null}
      </span>
    </div>
  );
}

export function WebToolRow({ name, args, result }: { name: string; args: Record<string, unknown>; result: Result }) {
  if (name === 'web_search') {
    if (!result) return <WebRow icon="running" text={`Searching the web for “${String(args.query ?? '')}”…`} />;
    if (result.isError) return <WebRow icon="error" text="Web search failed" detail={result.content.replace(/^Error:\s*/, '')} />;
    const count = (result.content.match(/^\[\d+\]/gm) ?? []).length;
    return <WebRow icon="search" text={`Searched the web for “${String(args.query ?? '')}”`} detail={count ? `${count} result${count === 1 ? '' : 's'}` : 'No results'} />;
  }
  let host = '';
  try {
    host = new URL(String(args.url ?? '')).hostname.replace(/^www\./, '');
  } catch {
    host = 'the page';
  }
  if (!result) return <WebRow icon="running" text={`Reading ${host}…`} />;
  if (result.isError) return <WebRow icon="error" text={`Couldn’t read ${host}`} detail={result.content.replace(/^Error:\s*/, '')} />;
  return <WebRow icon="page" text={`Read ${host}`} detail={result.content.split('\n')[0]?.replace(/^\[\d+\]\s*/, '')} />;
}

/** Images made by the generate_image tool, shown in the reply. */
export function GeneratedImages({ args, result }: { args: Record<string, unknown>; result: Result }) {
  const ids = result && !result.isError ? (/image ids: ([0-9a-f-, ]+)/.exec(result.content)?.[1] ?? '').split(/,\s*/).filter(Boolean) : [];
  const q = useImages(ids);
  if (!result) return <WebRow icon="running" text={`Creating ${Number(args.n) > 1 ? `${Number(args.n)} images` : 'an image'}…`} />;
  if (result.isError) return <WebRow icon="error" text="Couldn’t create the image" detail={result.content.replace(/^Error:\s*/, '')} />;
  return (
    <ul aria-label="Generated images" className="my-2 grid max-w-xl grid-cols-2 gap-2">
      {(q.data ?? []).map((img) => (
        <li key={img.id} className={(q.data?.length ?? 0) === 1 ? 'col-span-2' : ''}><ImageCard img={img} /></li>
      ))}
      {q.isLoading ? <li className="aspect-square animate-pulse rounded-lg bg-surface" /> : null}
    </ul>
  );
}
