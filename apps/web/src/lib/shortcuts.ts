import { useEffect, useRef } from 'react';

export const SHORTCUT_ACTIONS = {
  palette: { label: 'Open command palette', combo: 'mod+k' },
  newChat: { label: 'New chat', combo: 'mod+shift+o' },
  temporaryChat: { label: 'New temporary chat', combo: 'mod+alt+n' },
  toggleSidebar: { label: 'Toggle sidebar', combo: 'mod+shift+s' },
  focusComposer: { label: 'Focus the message box', combo: 'shift+escape' },
  settings: { label: 'Open settings', combo: 'mod+,' },
  toggleTheme: { label: 'Toggle light / dark', combo: 'mod+shift+l' },
  help: { label: 'Show keyboard shortcuts', combo: '?' },
} as const;
export type ShortcutAction = keyof typeof SHORTCUT_ACTIONS;

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Normalize a KeyboardEvent into "mod+shift+k" form (mod = Cmd on macOS, Ctrl elsewhere). */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  // "?" already implies shift on most layouts; don't require it explicitly.
  if (e.shiftKey && key !== '?') parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'shift' ? (isMac ? '⇧' : 'Shift') : p === 'alt' ? (isMac ? '⌥' : 'Alt') : p === 'escape' ? 'Esc' : p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
    .join(isMac ? '' : '+');
}

export function resolveBindings(overrides: Record<string, string> | undefined): Record<ShortcutAction, string> {
  const out = {} as Record<ShortcutAction, string>;
  for (const [k, v] of Object.entries(SHORTCUT_ACTIONS)) out[k as ShortcutAction] = overrides?.[k] ?? v.combo;
  return out;
}

function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
}

/** Global shortcut dispatcher. Single-key shortcuts (like "?") are ignored while typing. */
export function useShortcuts(bindings: Record<ShortcutAction, string>, handlers: Partial<Record<ShortcutAction, () => void>>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      for (const [action, b] of Object.entries(bindings) as [ShortcutAction, string][]) {
        if (b !== combo) continue;
        if (!b.includes('+') && inEditable(e.target)) continue;
        const h = ref.current[action];
        if (h) {
          e.preventDefault();
          h();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings]);
}
