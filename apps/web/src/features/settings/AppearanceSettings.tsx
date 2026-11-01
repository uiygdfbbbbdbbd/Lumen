import { Card, CardHeader, Field, Input, cn } from '@lumen/ui';
import { ALL_BUILTIN_THEMES, useThemeStore, type ThemeMode } from '../../lib/theme.js';
import { ThemeSwatch } from './ThemeSwatch.js';

const MODES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Follow your device' },
  { id: 'light', label: 'Light', hint: 'Always light' },
  { id: 'dark', label: 'Dark', hint: 'Always dark' },
  { id: 'time', label: 'Time of day', hint: 'Light by day, dark at night' },
];

export function AppearanceSettings() {
  const s = useThemeStore();
  const custom = Object.entries(s.custom);
  const pick = (mode: 'light' | 'dark') => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {[...ALL_BUILTIN_THEMES.filter((b) => b.theme.mode === mode).map((b) => ({ id: b.id, theme: b.theme })), ...custom.filter(([, t]) => t.mode === mode).map(([id, theme]) => ({ id, theme }))].map(({ id, theme }) => (
        <ThemeSwatch key={id} theme={theme} selected={(mode === 'light' ? s.lightThemeId : s.darkThemeId) === id} onSelect={() => s.set(mode === 'light' ? { lightThemeId: id } : { darkThemeId: id })} />
      ))}
    </div>
  );
  return (
    <>
      <Card>
        <CardHeader title="Color mode" />
        <div role="radiogroup" aria-label="Color mode" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={s.mode === m.id} onClick={() => s.set({ mode: m.id })} className={cn('flex flex-col rounded-md border px-3 py-2 text-left', s.mode === m.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-hover')}>
              <span className="text-sm font-medium text-fg">{m.label}</span>
              <span className="text-xs text-fg-2">{m.hint}</span>
            </button>
          ))}
        </div>
        {s.mode === 'time' ? (
          <div className="mt-4 grid max-w-sm grid-cols-2 gap-3">
            <Field label="Light from (hour)"><Input type="number" min={0} max={23} value={s.dayStartHour} onChange={(e) => s.set({ dayStartHour: Math.max(0, Math.min(23, Number(e.target.value))) })} /></Field>
            <Field label="Dark from (hour)"><Input type="number" min={0} max={23} value={s.nightStartHour} onChange={(e) => s.set({ nightStartHour: Math.max(0, Math.min(23, Number(e.target.value))) })} /></Field>
          </div>
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Light theme" description="Used when the color mode is light." />
        {pick('light')}
      </Card>
      <Card>
        <CardHeader title="Dark theme" description="Used when the color mode is dark." />
        {pick('dark')}
      </Card>
    </>
  );
}
