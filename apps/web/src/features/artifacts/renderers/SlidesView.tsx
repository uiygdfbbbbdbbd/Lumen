import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSlides, type Slide } from '@lumen/shared';
import { Button, IconButton } from '@lumen/ui';
import { ChevronLeft, ChevronRight, Maximize, Presentation, RotateCcw, X } from 'lucide-react';
import { Markdown } from '../../chat/Markdown.js';
import { RenderError } from './RenderError.js';

function SlideFace({ slide, scale = 1 }: { slide: Slide; scale?: number }) {
  return (
    <div className="flex h-full w-full flex-col gap-[4%] overflow-hidden bg-elevated px-[7%] py-[6%] text-fg" style={{ fontSize: `${scale}em` }}>
      {slide.title ? <h2 className="text-[2em] font-semibold leading-tight tracking-tight">{slide.title}</h2> : null}
      {slide.body ? <div className="text-[1.15em] [&_.lm-prose]:text-[1em]"><Markdown text={slide.body} /></div> : null}
    </div>
  );
}

function useTimer(running: boolean) {
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const s = Math.max(0, Math.floor((now - start) / 1000));
  return { label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, reset: () => { setStart(Date.now()); setNow(Date.now()); } };
}

export function SlidesView({ content }: { content: string }) {
  const slides = useMemo(() => parseSlides(content), [content]);
  const [i, setI] = useState(0);
  const [presenter, setPresenter] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const timer = useTimer(presenter);
  const n = slides.length;
  const go = (d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d)));

  useEffect(() => setI((x) => Math.min(x, Math.max(0, n - 1))), [n]);
  useEffect(() => {
    if (!presenter) return;
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) go(1);
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) go(-1);
      else if (e.key === 'Escape') setPresenter(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter, n]);

  if (!n) return <RenderError title="No slides yet">Separate slides with a line containing only ---.</RenderError>;
  const slide = slides[i]!;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 print:hidden">
        <IconButton size="icon-sm" label="Previous slide" icon={<ChevronLeft size={16} />} disabled={i === 0} onClick={() => go(-1)} />
        <span className="min-w-14 text-center text-xs tabular-nums text-fg-2" aria-live="polite">{i + 1} / {n}</span>
        <IconButton size="icon-sm" label="Next slide" icon={<ChevronRight size={16} />} disabled={i === n - 1} onClick={() => go(1)} />
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void stage.current?.requestFullscreen?.()}><Maximize size={14} aria-hidden="true" /> Present</Button>
        <Button size="sm" variant="ghost" onClick={() => { timer.reset(); setPresenter(true); }}><Presentation size={14} aria-hidden="true" /> Presenter view</Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface p-4 print:hidden">
        <div
          ref={stage}
          tabIndex={0}
          role="region"
          aria-roledescription="slide"
          aria-label={`Slide ${i + 1} of ${n}: ${slide.title}`}
          onKeyDown={(e) => {
            if (['ArrowRight', 'PageDown', ' '].includes(e.key)) go(1);
            else if (['ArrowLeft', 'PageUp'].includes(e.key)) go(-1);
            else return;
            e.preventDefault();
          }}
          className="aspect-video w-full max-w-4xl overflow-hidden rounded-md border border-border shadow-md outline-none focus-visible:ring-2 focus-visible:ring-accent [&:fullscreen]:max-w-none [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:text-[2.2vw]"
        >
          <SlideFace slide={slide} />
        </div>
      </div>
      {slide.notes ? <details className="border-t border-border px-3 py-2 text-sm print:hidden"><summary className="cursor-pointer text-fg-2">Speaker notes</summary><p className="mt-1 whitespace-pre-wrap text-fg">{slide.notes}</p></details> : null}

      {/* Printed (Save as PDF): every slide on its own landscape page. */}
      <div className="hidden print:block" data-print-only>
        {slides.map((s, k) => <div key={k} className="aspect-video w-full break-after-page border border-border">{<SlideFace slide={s} />}</div>)}
      </div>

      {presenter ? (
        <div role="dialog" aria-modal="true" aria-label="Presenter view" className="fixed inset-0 z-50 grid grid-cols-[2fr_1fr] grid-rows-[auto_1fr_auto] gap-4 bg-bg p-4">
          <div className="col-span-2 flex items-center gap-3">
            <span className="font-mono text-lg tabular-nums text-fg" aria-label="Elapsed time">{timer.label}</span>
            <IconButton size="icon-sm" label="Reset timer" icon={<RotateCcw size={14} />} onClick={timer.reset} />
            <span className="text-sm text-fg-2">Slide {i + 1} of {n}</span>
            <span className="flex-1" />
            <IconButton label="Exit presenter view" icon={<X size={18} />} onClick={() => setPresenter(false)} />
          </div>
          <div className="aspect-video self-start overflow-hidden rounded-md border border-border text-[1.4vw]"><SlideFace slide={slide} /></div>
          <div className="flex min-h-0 flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-2">Next</p>
            {slides[i + 1] ? <div className="aspect-video overflow-hidden rounded-md border border-border text-[0.6vw] opacity-80"><SlideFace slide={slides[i + 1]!} /></div> : <p className="text-sm text-fg-2">End of deck</p>}
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-2">Notes</p>
            <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-lg text-fg">{slide.notes || <span className="text-fg-3">No notes for this slide.</span>}</div>
          </div>
          <div className="col-span-2 flex justify-center gap-2">
            <Button variant="secondary" disabled={i === 0} onClick={() => go(-1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</Button>
            <Button disabled={i === n - 1} onClick={() => go(1)}>Next <ChevronRight size={16} aria-hidden="true" /></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
