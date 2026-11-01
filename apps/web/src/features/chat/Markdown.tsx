import { lazy, memo, Suspense, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { Check, ChevronDown, Copy, Download, ExternalLink, ImageOff } from 'lucide-react';
import { cn } from '@lumen/ui';

const Mermaid = lazy(() => import('./Mermaid.js'));

const EXT: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs', ruby: 'rb', bash: 'sh', shell: 'sh', markdown: 'md', yaml: 'yml', csharp: 'cs', kotlin: 'kt' };

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function CodeBlock({ lang, children }: { lang: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, '');
  const lines = code.split('\n').length;
  const [expanded, setExpanded] = useState(lines <= 40);
  if (lang === 'mermaid') {
    return (
      <Suspense fallback={<pre className="rounded-md bg-code-bg p-3 text-sm text-code">{code}</pre>}>
        <Mermaid code={code} />
      </Suspense>
    );
  }
  return (
    <div className="group/code my-3 overflow-hidden rounded-md border border-border bg-code-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-xs text-fg-2">
        <span>{lang || 'text'}</span>
        <span className="flex gap-1">
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-hover"
            onClick={() => {
              void navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label="Copy code"
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-hover"
            aria-label="Download code"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `snippet.${EXT[lang] ?? (lang || 'txt')}`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={12} aria-hidden="true" />
          </button>
        </span>
      </div>
      <pre className={cn('overflow-x-auto p-3 text-[13px] leading-relaxed text-code', !expanded && 'max-h-80 overflow-y-hidden')}>
        <code className={lang ? `hljs language-${lang}` : 'hljs'}>{children}</code>
      </pre>
      {!expanded ? (
        <button type="button" onClick={() => setExpanded(true)} className="flex w-full items-center justify-center gap-1 border-t border-border py-1 text-xs text-fg-2 hover:bg-hover">
          <ChevronDown size={12} aria-hidden="true" /> Show all {lines} lines
        </button>
      ) : null}
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1] ?? '';
    const inline = !className && !textOf(children).includes('\n');
    if (inline) return <code className="rounded-sm bg-code-bg px-1 py-0.5 text-[0.9em] text-code">{children}</code>;
    return <CodeBlock lang={lang}>{children}</CodeBlock>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
      {children}
    </a>
  ),
  // Remote images are not auto-loaded: model output can be steered into exfiltrating data via image URLs.
  img: ({ src, alt }) => {
    const s = typeof src === 'string' ? src : '';
    if (s.startsWith('data:image/') || s.startsWith('/api/') || s.startsWith('blob:')) return <img src={s} alt={alt ?? ''} loading="lazy" className="my-2 max-h-96 rounded-md" />;
    let host = '';
    try {
      host = new URL(s).host;
    } catch {
      return null;
    }
    return (
      <a href={s} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs text-fg-2 no-underline">
        <ImageOff size={12} aria-hidden="true" /> {alt || 'Image'} ({host}) <ExternalLink size={10} aria-hidden="true" />
      </a>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-surface px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

/** Safe by construction: raw HTML in model output is never rendered (no rehype-raw). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="lm-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }], [rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
