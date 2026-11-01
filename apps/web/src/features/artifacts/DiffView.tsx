import { cn } from '@lumen/ui';

/** Unified diff with +/− markers in the text (never color alone). */
export function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n').filter((l) => !/^(={3,}|Index:|-{3} |\+{3} |\\ No newline)/.test(l));
  const changes = lines.filter((l) => /^[+-]/.test(l)).length;
  if (!changes) return <p className="p-4 text-sm text-fg-2">These versions are identical.</p>;
  return (
    <pre className="m-0 overflow-auto bg-code-bg py-2 font-mono text-[12.5px] leading-5" aria-label="Changes between versions">
      {lines.map((l, i) => {
        const kind = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx';
        return (
          <div
            key={i}
            className={cn(
              'whitespace-pre-wrap px-3',
              kind === 'hunk' && 'mt-2 bg-surface text-fg-2',
              kind === 'add' && 'bg-[color-mix(in_srgb,var(--lm-success)_14%,transparent)] text-fg',
              kind === 'del' && 'bg-[color-mix(in_srgb,var(--lm-danger)_14%,transparent)] text-fg',
              kind === 'ctx' && 'text-fg-2',
            )}
          >
            {kind === 'add' ? <span className="sr-only">Added: </span> : kind === 'del' ? <span className="sr-only">Removed: </span> : null}
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}
