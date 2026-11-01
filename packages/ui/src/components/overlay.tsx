import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tabs as RTabs, Tooltip as RTooltip } from 'radix-ui';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

export const Dialog = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;
export const DialogClose = RDialog.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  size = 'md',
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const width = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[var(--lm-blur)]" />
      <RDialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-elevated p-6 shadow-lg focus:outline-none',
          width,
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <RDialog.Title className="text-lg font-semibold text-fg">{title}</RDialog.Title>
            {description ? <RDialog.Description className="mt-1 text-sm text-fg-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
          </div>
          <RDialog.Close className="rounded-sm p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </RDialog.Close>
        </div>
        {children}
      </RDialog.Content>
    </RDialog.Portal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** If set, the user must type this text to enable the confirm button. */
  confirmText?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, confirmText, onConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !confirmText || typed === confirmText;
  return (
    <Dialog open={open} onOpenChange={(o) => { setTyped(''); onOpenChange(o); }}>
      <DialogContent title={title} description={description} size="sm">
        {confirmText ? (
          <label className="mb-4 flex flex-col gap-1 text-sm text-fg-2">
            Type <strong className="text-fg">{confirmText}</strong> to confirm
            <input className="h-10 rounded-md border border-border bg-elevated px-3 text-fg" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={!ok}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const DropdownMenu = RMenu.Root;
export const DropdownMenuTrigger = RMenu.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentProps<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-48 rounded-md border border-border bg-elevated p-1 shadow-md', className)}
        {...props}
      />
    </RMenu.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof RMenu.Item> & { destructive?: boolean }) {
  return (
    <RMenu.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50',
        destructive && 'text-danger',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className }: { className?: string }) => <RMenu.Separator className={cn('my-1 h-px bg-border', className)} />;
export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => <RMenu.Label className="px-2 py-1 text-xs text-fg-3">{children}</RMenu.Label>;

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export function PopoverContent({ className, ...props }: React.ComponentProps<typeof RPopover.Content>) {
  return (
    <RPopover.Portal>
      <RPopover.Content sideOffset={6} className={cn('z-50 rounded-md border border-border bg-elevated p-3 shadow-md focus:outline-none', className)} {...props} />
    </RPopover.Portal>
  );
}

export const TooltipProvider = RTooltip.Provider;
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <RTooltip.Root delayDuration={300}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 rounded-sm bg-fg px-2 py-1 text-xs text-bg shadow-md">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const Tabs = RTabs.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof RTabs.List>) {
  return <RTabs.List className={cn('flex gap-1 border-b border-border', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-fg-2 hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof RTabs.Content>) => <RTabs.Content className={cn('pt-4 focus:outline-none', className)} {...props} />;
