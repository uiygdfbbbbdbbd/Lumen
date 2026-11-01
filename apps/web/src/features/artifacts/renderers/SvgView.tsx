import { useMemo, useState } from 'react';
import { Button } from '@lumen/ui';
import { Grid2x2 } from 'lucide-react';
import { RenderError } from './RenderError.js';

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** SVG is shown through <img>, where scripts, event handlers and external loads never run. */
export function SvgView({ content, title }: { content: string; title: string }) {
  const [checker, setChecker] = useState(false);
  const valid = useMemo(() => /<svg[\s>]/i.test(content), [content]);
  if (!valid) return <RenderError title="This isn’t an SVG image">The content doesn’t contain an &lt;svg&gt; element.</RenderError>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end p-2">
        <Button size="sm" variant="ghost" aria-pressed={checker} onClick={() => setChecker((c) => !c)}><Grid2x2 size={14} aria-hidden="true" /> Transparency grid</Button>
      </div>
      <div
        className="flex flex-1 items-center justify-center p-6"
        style={checker ? { backgroundImage: 'conic-gradient(var(--lm-hover) 25%, transparent 0 50%, var(--lm-hover) 0 75%, transparent 0)', backgroundSize: '16px 16px' } : undefined}
      >
        <img src={svgDataUrl(content)} alt={title} className="max-h-full max-w-full" />
      </div>
    </div>
  );
}
