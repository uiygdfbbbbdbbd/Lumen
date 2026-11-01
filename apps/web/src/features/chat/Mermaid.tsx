import { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';

/** Renders Mermaid in strict security mode, then sanitizes the SVG before inserting it. */
export default function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const dark = document.documentElement.dataset.theme === 'dark';
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'inherit' });
        const { svg: out } = await mermaid.render(`m${id}`, code);
        if (!cancelled) setSvg(DOMPurify.sanitize(out, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] }));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);
  if (error) return <pre className="my-3 overflow-x-auto rounded-md bg-code-bg p-3 text-sm text-code" title={error}>{code}</pre>;
  if (!svg) return <div className="my-3 h-24 animate-pulse rounded-md bg-surface" aria-label="Rendering diagram" />;
  return <figure className="my-3 overflow-x-auto rounded-md border border-border bg-elevated p-3" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
