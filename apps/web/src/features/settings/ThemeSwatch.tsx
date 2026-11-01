import type { Theme } from '@lumen/shared';
import { cn } from '@lumen/ui';
import { Check } from 'lucide-react';

/** Miniature chat UI rendered in the theme's own colors, so users preview before applying. */
export function ThemeSwatch({ theme, selected, onSelect, label }: { theme: Theme; selected?: boolean; onSelect?: () => void; label?: string }) {
  const c = theme.colors;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn('group flex flex-col overflow-hidden rounded-md border text-left', selected ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-fg-3')}
    >
      <div className="flex h-20 gap-1.5 p-2" style={{ background: c.background }}>
        <div className="w-1/4 rounded-sm" style={{ background: c.surface }} />
        <div className="flex flex-1 flex-col justify-end gap-1">
          <div className="h-2 w-3/4 rounded-full" style={{ background: c.textSecondary, opacity: 0.6 }} />
          <div className="h-2 w-1/2 rounded-full" style={{ background: c.textPrimary }} />
          <div className="mt-1 h-3 w-1/3 self-end rounded-sm" style={{ background: c.accent }} />
        </div>
      </div>
      <div className="flex items-center justify-between bg-elevated px-2 py-1.5 text-xs text-fg">
        <span>
          {label ?? theme.name}
          <span className="sr-only"> theme</span>
        </span>
        {selected ? <Check size={14} className="text-accent" aria-hidden="true" /> : <span className="text-fg-2">{theme.mode}</span>}
      </div>
    </button>
  );
}
