import { useEffect, useRef, useState } from 'react';
import { useArtifact } from './api.js';
import { ArtifactFrame } from './ArtifactFrame.js';
import { ArtifactTypeIcon } from './ArtifactCard.js';
import { ChartView } from './renderers/ChartView.js';
import { svgDataUrl } from './renderers/SvgView.js';
import type { ArtifactSummary } from './types.js';

function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible] as const;
}

const LIVE = new Set(['html', 'react', 'svg', 'chart']);

/**
 * Gallery thumbnails are rendered live, at small scale, only once the card scrolls into view:
 * apps run in the same no-network sandbox as the full view (without the AI/storage bridge).
 */
export function Thumbnail({ a }: { a: ArtifactSummary }) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const live = LIVE.has(a.type);
  const full = useArtifact(visible && live ? a.id : null);
  const content = full.data?.content;
  return (
    <div ref={ref} inert className="relative h-36 overflow-hidden border-b border-border bg-surface" aria-hidden="true">
      {live && content !== undefined ? (
        a.type === 'svg' ? (
          <img src={svgDataUrl(content)} alt="" className="h-full w-full object-contain p-3" />
        ) : a.type === 'chart' ? (
          <div className="pointer-events-none w-[300%] origin-top-left scale-[0.3333]"><ChartView content={content} /></div>
        ) : (
          <ArtifactFrame artifactId={a.id} type={a.type as 'html' | 'react'} content={content} bridge={false} className="pointer-events-none h-[400%] w-[400%] origin-top-left scale-25 border-0 bg-white" />
        )
      ) : live ? (
        <div className="flex h-full items-center justify-center text-fg-3"><ArtifactTypeIcon type={a.type} size={28} /></div>
      ) : (
        <pre className={`m-0 h-full overflow-hidden whitespace-pre-wrap p-3 text-[10px] leading-4 text-fg-2 ${['code', 'table', 'spreadsheet', 'mermaid', 'latex'].includes(a.type) ? 'font-mono' : 'font-sans'}`}>{a.preview ?? ''}</pre>
      )}
      <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-elevated text-fg-2 shadow-sm"><ArtifactTypeIcon type={a.type} size={14} /></span>
    </div>
  );
}
