import { useMemo } from 'react';
import hljs from 'highlight.js/lib/common';

/** Read-only, highlighted source with line numbers. hljs escapes its input, so its HTML output is safe to insert. */
export function CodeView({ code, language }: { code: string; language?: string | null }) {
  const html = useMemo(() => {
    const lang = language && hljs.getLanguage(language) ? language : null;
    try {
      return lang ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : code.length < 200_000 ? hljs.highlightAuto(code).value : escapeHtml(code);
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);
  const lines = code.split('\n').length;
  return (
    <div className="flex min-h-full bg-code-bg font-mono text-[13px] leading-6">
      <div aria-hidden="true" className="select-none border-r border-border px-3 py-3 text-right text-fg-3">
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <pre className="m-0 flex-1 overflow-x-auto p-3 text-code"><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
