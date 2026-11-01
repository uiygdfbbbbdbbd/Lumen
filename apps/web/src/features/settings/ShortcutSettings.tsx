import { useState } from 'react';
import { Button, Card, CardHeader, Kbd, toast } from '@lumen/ui';
import { comboFromEvent, formatCombo, resolveBindings, SHORTCUT_ACTIONS, type ShortcutAction } from '../../lib/shortcuts.js';
import { usePreferences, useUpdatePreferences } from '../models/useModels.js';

export function ShortcutSettings() {
  const { data: prefs } = usePreferences();
  const update = useUpdatePreferences();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const bindings = resolveBindings(prefs?.shortcuts);
  const save = (next: Record<string, string>) => update.mutate({ shortcuts: next }, { onSuccess: () => toast.success('Shortcuts saved') });
  return (
    <Card>
      <CardHeader title="Keyboard shortcuts" description="Click “Change”, then press the new key combination. Esc cancels." action={<Button size="sm" variant="secondary" onClick={() => save({})}>Reset all</Button>} />
      <ul className="divide-y divide-border">
        {(Object.keys(SHORTCUT_ACTIONS) as ShortcutAction[]).map((a) => (
          <li key={a} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{SHORTCUT_ACTIONS[a].label}</span>
            <span className="flex items-center gap-2">
              <Kbd>{recording === a ? 'Press keys…' : formatCombo(bindings[a])}</Kbd>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRecording(a)}
                onKeyDown={(e) => {
                  if (recording !== a) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === 'Escape') return setRecording(null);
                  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
                  const combo = comboFromEvent(e.nativeEvent);
                  const clash = (Object.keys(bindings) as ShortcutAction[]).find((x) => x !== a && bindings[x] === combo);
                  if (clash) toast.error('Already used', `${formatCombo(combo)} is assigned to “${SHORTCUT_ACTIONS[clash].label}”.`);
                  else save({ ...(prefs?.shortcuts ?? {}), [a]: combo });
                  setRecording(null);
                }}
                aria-label={`Change shortcut for ${SHORTCUT_ACTIONS[a].label}`}
              >
                {recording === a ? 'Listening…' : 'Change'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
