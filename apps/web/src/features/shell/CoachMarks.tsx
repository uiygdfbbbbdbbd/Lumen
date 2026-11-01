import { useEffect, useLayoutEffect, useState } from 'react';
import { Button } from '@lumen/ui';

export interface CoachStep {
  target: string;
  title: string;
  body: string;
}

/** Lightweight coach-mark tour anchored to [data-tour="..."] elements. Keyboard: Esc skips, Enter advances. */
export function CoachMarks({ steps, onDone }: { steps: CoachStep[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  if (!step) return null;
  const top = rect ? Math.min(window.innerHeight - 180, rect.bottom + 12) : window.innerHeight / 2 - 80;
  const left = rect ? Math.min(window.innerWidth - 320, Math.max(12, rect.left)) : window.innerWidth / 2 - 150;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="coach-title">
      <div className="absolute inset-0 bg-black/40" onClick={onDone} />
      {rect ? <div className="pointer-events-none absolute rounded-md ring-4 ring-accent" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} /> : null}
      <div className="absolute w-[300px] rounded-lg border border-border bg-elevated p-4 shadow-lg" style={{ top, left }}>
        <p className="text-xs text-fg-3">
          {i + 1} of {steps.length}
        </p>
        <h2 id="coach-title" className="mt-1 font-semibold text-fg">{step.title}</h2>
        <p className="mt-1 text-sm text-fg-2">{step.body}</p>
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" size="sm" onClick={onDone}>Skip tour</Button>
          <Button size="sm" autoFocus onClick={() => (i + 1 < steps.length ? setI(i + 1) : onDone())}>{i + 1 < steps.length ? 'Next' : 'Done'}</Button>
        </div>
      </div>
    </div>
  );
}
