import { useMemo, useRef, useState } from 'react';
import type { ModelSummary } from '@lumen/shared';
import { Badge, Popover, PopoverContent, PopoverTrigger, cn } from '@lumen/ui';
import { Brain, ChevronDown, Eye, Lock, Search, Sparkles, Star, Wrench, Zap } from 'lucide-react';
import { filterModels, formatContext, LOCK_TEXT, useModels, usePreferences, useUpdatePreferences } from './useModels.js';

function ModelIcon({ m, size = 20 }: { m: Pick<ModelSummary, 'iconUrl' | 'providerName'>; size?: number }) {
  return m.iconUrl ? (
    <img src={m.iconUrl} alt="" width={size} height={size} className="shrink-0 rounded-sm" />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-sm bg-accent-soft text-[10px] font-bold text-accent" style={{ width: size, height: size }} aria-hidden="true">
      {m.providerName.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Badges({ m }: { m: ModelSummary }) {
  return (
    <span className="flex flex-wrap gap-1">
      {m.recommended ? <Badge tone="accent"><Sparkles size={10} aria-hidden="true" />Recommended</Badge> : null}
      {m.capabilities.vision ? <Badge tone="info"><Eye size={10} aria-hidden="true" />Vision</Badge> : null}
      {m.capabilities.tools ? <Badge><Wrench size={10} aria-hidden="true" />Tools</Badge> : null}
      {m.capabilities.reasoning ? <Badge><Brain size={10} aria-hidden="true" />Reasoning</Badge> : null}
      {m.contextWindow >= 200_000 ? <Badge>Long context</Badge> : null}
      {m.tags.map((t) => (
        <Badge key={t} tone={t === 'fast' ? 'success' : t === 'new' ? 'warning' : 'neutral'}>
          {t === 'fast' ? <Zap size={10} aria-hidden="true" /> : null}
          {t}
        </Badge>
      ))}
      {m.deprecation ? <Badge tone="danger">Deprecated</Badge> : null}
    </span>
  );
}

export interface ModelSelectorProps {
  value: string | null;
  onChange: (id: string) => void;
  /** Show an "Auto" entry that lets the server choose. */
  allowAuto?: boolean;
  className?: string;
}

/** Searchable, keyboard-navigable model picker grouped by provider, with favorites and recents. */
export function ModelSelector({ value, onChange, allowAuto, className }: ModelSelectorProps) {
  const { data: models = [], isLoading } = useModels();
  const { data: prefs } = usePreferences();
  const update = useUpdatePreferences();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const favorites = prefs?.favoriteModels ?? [];
  const recents = prefs?.recentModels ?? [];

  const selected = models.find((m) => m.id === value);
  const filtered = useMemo(() => filterModels(models, q), [models, q]);
  const groups = useMemo(() => {
    const out: { label: string; items: ModelSummary[] }[] = [];
    if (!q) {
      const fav = favorites.map((id) => models.find((m) => m.id === id)).filter((m): m is ModelSummary => Boolean(m));
      if (fav.length) out.push({ label: 'Favorites', items: fav });
      const rec = recents.filter((id) => !favorites.includes(id)).map((id) => models.find((m) => m.id === id)).filter((m): m is ModelSummary => Boolean(m)).slice(0, 3);
      if (rec.length) out.push({ label: 'Recent', items: rec });
    }
    const byProvider = new Map<string, ModelSummary[]>();
    for (const m of filtered) byProvider.set(m.providerName, [...(byProvider.get(m.providerName) ?? []), m]);
    for (const [label, items] of byProvider) out.push({ label, items });
    return out;
  }, [filtered, favorites, recents, models, q]);
  const flat = useMemo(() => [...(allowAuto && !q ? [null] : []), ...groups.flatMap((g) => g.items)], [groups, allowAuto, q]);

  function choose(m: ModelSummary | null) {
    if (m && !m.available) return;
    const id = m?.id ?? 'auto';
    onChange(id);
    if (m) update.mutate({ recentModels: [id, ...recents.filter((r) => r !== id)].slice(0, 10) });
    setOpen(false);
    setQ('');
  }

  function toggleFavorite(id: string) {
    update.mutate({ favoriteModels: favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id] });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(flat.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'f' || e.key === 'F') && e.altKey) {
      e.preventDefault();
      const m = flat[active];
      if (m) toggleFavorite(m.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = flat[active];
      if (m !== undefined) choose(m);
    }
  }

  let index = allowAuto && !q ? 1 : 0;
  const optionId = (i: number) => `model-opt-${i}`;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); setActive(0); }}>
      <PopoverTrigger asChild>
        <button type="button" className={cn('flex h-9 items-center gap-2 rounded-md border border-border bg-elevated px-3 text-sm text-fg hover:bg-hover', className)} aria-label={`Model: ${selected?.displayName ?? (value === 'auto' || !value ? 'Auto' : 'Choose a model')}`}>
          {selected ? <ModelIcon m={selected} size={16} /> : <Sparkles size={16} aria-hidden="true" className="text-accent" />}
          <span className="max-w-48 truncate">{selected?.displayName ?? (value === 'auto' || !value ? 'Auto' : 'Choose a model')}</span>
          <ChevronDown size={14} aria-hidden="true" className="text-fg-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-1rem))] p-0" align="start">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} className="text-fg-3" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="model-listbox"
            aria-activedescendant={flat.length ? optionId(active) : undefined}
            aria-label="Search models"
            placeholder="Search models…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            className="h-11 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
          />
        </div>
        {isLoading ? <p className="p-3 text-sm text-fg-2">Loading models…</p> : null}
        {!isLoading && models.length === 0 ? <p className="p-3 text-sm text-fg-2">No models are configured yet. An admin can add providers in the admin console.</p> : null}
        {!isLoading && models.length > 0 && filtered.length === 0 ? <p className="p-3 text-sm text-fg-2">No models match “{q}”.</p> : null}
        <div ref={listRef} id="model-listbox" role="listbox" aria-label="Models" className="max-h-[60vh] overflow-y-auto p-1">
          {allowAuto && !q ? (
            <div id={optionId(0)} role="option" aria-selected={value === 'auto' || !value} data-index={0} onMouseEnter={() => setActive(0)} onClick={() => choose(null)} className={cn('flex cursor-pointer items-start gap-3 rounded-sm px-2 py-2', active === 0 && 'bg-hover')}>
              <Sparkles size={20} className="text-accent" aria-hidden="true" />
              <span className="flex flex-col"><span className="text-sm font-medium text-fg">Auto</span><span className="text-xs text-fg-2">Use the recommended model.</span></span>
            </div>
          ) : null}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <div role="presentation" aria-hidden="true" className="px-2 pb-1 pt-2 text-xs font-semibold text-fg-2">{g.label}</div>
              {g.items.map((m) => {
                const i = index++;
                return (
                  <div
                    key={`${g.label}-${m.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={m.id === value}
                    aria-disabled={!m.available}
                    aria-description={favorites.includes(m.id) ? 'Favorite' : undefined}
                    data-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(m)}
                    className={cn('group flex items-start gap-3 rounded-sm px-2 py-2', m.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-60', active === i && 'bg-hover')}
                  >
                    <ModelIcon m={m} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        {m.displayName}
                        <span className="text-xs font-normal text-fg-3">{formatContext(m.contextWindow)}</span>
                      </span>
                      {m.description ? <span className="text-xs text-fg-2">{m.description}</span> : null}
                      <Badges m={m} />
                      {!m.available && m.lockedReason ? <span className="flex items-center gap-1 text-xs text-fg-2"><Lock size={12} aria-hidden="true" />{LOCK_TEXT[m.lockedReason]}</span> : null}
                      {m.deprecation?.message ? <span className="text-xs text-warning">{m.deprecation.message}</span> : null}
                    </span>
                    {/* Mouse affordance only; keyboard users press F (see hint below the list). */}
                    <span
                      aria-hidden="true"
                      data-testid={`favorite-${m.displayName}`}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(m.id); }}
                      className={cn('rounded-sm p-1 hover:text-warning', favorites.includes(m.id) ? 'text-warning' : 'text-fg-3')}
                    >
                      <Star size={14} fill={favorites.includes(m.id) ? 'currentColor' : 'none'} />
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="border-t border-border px-3 py-2 text-xs text-fg-2">↑↓ to move · Enter to choose · Alt+F to favorite</p>
      </PopoverContent>
    </Popover>
  );
}
