import { Toast as RToast } from 'radix-ui';
import { X } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface ToastItem {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'default' | 'success' | 'danger';
  /** e.g. an Undo button for destructive actions. */
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const toast = Object.assign(
  (t: Omit<ToastItem, 'id'>) => {
    const id = nextId++;
    items = [...items, { id, ...t }];
    emit();
    return id;
  },
  {
    success: (title: ReactNode, description?: ReactNode) => toast({ title, description, tone: 'success' }),
    error: (title: ReactNode, description?: ReactNode) => toast({ title, description, tone: 'danger' }),
    dismiss: (id: number) => {
      items = items.filter((i) => i.id !== id);
      emit();
    },
  },
);

function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
}

export function Toaster() {
  const list = useToasts();
  return (
    <RToast.Provider swipeDirection="right">
      {list.map((t) => (
        <RToast.Root
          key={t.id}
          duration={t.durationMs ?? 5000}
          onOpenChange={(open) => !open && toast.dismiss(t.id)}
          className={cn(
            'flex items-start gap-3 rounded-md border border-border bg-elevated p-4 shadow-lg',
            t.tone === 'success' && 'border-l-4 border-l-success',
            t.tone === 'danger' && 'border-l-4 border-l-danger',
          )}
        >
          <div className="flex-1">
            <RToast.Title className="text-sm font-semibold text-fg">{t.title}</RToast.Title>
            {t.description ? <RToast.Description className="mt-0.5 text-sm text-fg-2">{t.description}</RToast.Description> : null}
          </div>
          {t.action ? (
            <RToast.Action altText={t.action.label} asChild>
              <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            </RToast.Action>
          ) : null}
          <RToast.Close aria-label="Close" className="text-fg-3 hover:text-fg">
            <X size={16} aria-hidden="true" />
          </RToast.Close>
        </RToast.Root>
      ))}
      <RToast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </RToast.Provider>
  );
}
