import { Dialog, DialogContent, Kbd } from '@lumen/ui';
import { formatCombo, SHORTCUT_ACTIONS, type ShortcutAction } from '../../lib/shortcuts.js';

export function ShortcutsHelp({ open, onOpenChange, bindings }: { open: boolean; onOpenChange: (o: boolean) => void; bindings: Record<ShortcutAction, string> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="Change them in Settings → Shortcuts.">
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
          {(Object.keys(SHORTCUT_ACTIONS) as ShortcutAction[]).map((a) => (
            <div key={a} className="contents">
              <dt className="text-fg-2">{SHORTCUT_ACTIONS[a].label}</dt>
              <dd><Kbd>{formatCombo(bindings[a])}</Kbd></dd>
            </div>
          ))}
          <div className="contents"><dt className="text-fg-2">Send message</dt><dd><Kbd>Enter</Kbd></dd></div>
          <div className="contents"><dt className="text-fg-2">New line</dt><dd><Kbd>Shift+Enter</Kbd></dd></div>
          <div className="contents"><dt className="text-fg-2">Previous prompt</dt><dd><Kbd>↑</Kbd></dd></div>
          <div className="contents"><dt className="text-fg-2">Stop generating</dt><dd><Kbd>Esc</Kbd></dd></div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
