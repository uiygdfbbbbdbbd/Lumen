import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Skeleton } from '@lumen/ui';
import { useArtifactPanel } from './panel.js';

const ArtifactPanel = lazy(() => import('./ArtifactPanel.js').then((m) => ({ default: m.ArtifactPanel })));

const WIDTH_KEY = 'lumen.artifactPanelWidth';
const MIN = 320;

function initialWidth() {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(saved) && saved >= MIN ? saved : Math.round(Math.min(760, window.innerWidth * 0.48));
}

/** Content on the left, the open artifact on the right with a draggable (and keyboard-resizable) divider. */
export function ArtifactWorkspace({ children, onAsk }: { children: ReactNode; onAsk?: (text: string) => void }) {
  const { openId, version, fullscreen, setVersion, close, toggleFullscreen } = useArtifactPanel();
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const max = () => Math.max(MIN, window.innerWidth - 360);
  const clamp = (w: number) => Math.round(Math.min(max(), Math.max(MIN, w)));

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, fullscreen, toggleFullscreen]);

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') setWidth((w) => clamp(w + step));
    else if (e.key === 'ArrowRight') setWidth((w) => clamp(w - step));
    else if (e.key === 'Home') setWidth(max());
    else if (e.key === 'End') setWidth(MIN);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {openId ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize artifact panel"
            aria-valuenow={width}
            aria-valuemin={MIN}
            aria-valuemax={max()}
            tabIndex={0}
            onKeyDown={onKey}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragging.current && setWidth(clamp(window.innerWidth - e.clientX))}
            onPointerUp={() => (dragging.current = false)}
            className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent outline-none hover:bg-accent/30 focus-visible:bg-accent/50 md:block"
          />
          <div className="max-md:fixed max-md:inset-0 max-md:z-40 md:w-[var(--lm-panel-w)] md:shrink-0" style={{ '--lm-panel-w': `${width}px` } as CSSProperties}>
            <Suspense fallback={<div className="flex h-full flex-col gap-3 border-l border-border bg-bg p-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64" /></div>}>
              <ArtifactPanel artifactId={openId} version={version} onVersionChange={setVersion} onClose={close} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} onAsk={onAsk} />
            </Suspense>
          </div>
        </>
      ) : null}
    </div>
  );
}
