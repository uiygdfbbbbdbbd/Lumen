import { Checkbox as RCheckbox, Label as RLabel, Switch as RSwitch } from 'radix-ui';
import { Check } from 'lucide-react';
import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const fieldBase =
  'lm-transition w-full rounded-md border border-border bg-elevated px-3 text-fg placeholder:text-fg-3 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-0 disabled:opacity-60 aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'h-10 text-sm', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2 text-sm', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-10 text-sm pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export function Label({ className, ...props }: React.ComponentProps<typeof RLabel.Root>) {
  return <RLabel.Root className={cn('text-sm font-medium text-fg', className)} {...props} />;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
  optional?: boolean;
}

/** Wires label, hint and error to the control via id / aria-describedby / aria-invalid. */
export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: (children.props.id as string | undefined) ?? id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={(children.props.id as string | undefined) ?? id}>
        {label}
        {optional ? <span className="ml-1 font-normal text-fg-3">(optional)</span> : null}
      </Label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-fg-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof RCheckbox.Root>) {
  return (
    <RCheckbox.Root
      className={cn(
        'lm-transition flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm border border-border bg-elevated data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg',
        className,
      )}
      {...props}
    >
      <RCheckbox.Indicator>
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      className={cn(
        'lm-transition relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RSwitch.Thumb className="lm-transition block h-4.5 w-4.5 translate-x-0.5 rounded-full bg-fg-3 shadow-sm transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-fg" />
    </RSwitch.Root>
  );
}

export function SwitchRow({ label, description, ...props }: { label: ReactNode; description?: ReactNode } & React.ComponentProps<typeof RSwitch.Root>) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex flex-col">
        <Label htmlFor={id}>{label}</Label>
        {description ? <span className="text-xs text-fg-3">{description}</span> : null}
      </div>
      <Switch id={id} {...props} />
    </div>
  );
}

export function PasswordStrength({ score, warning }: { score: 0 | 1 | 2 | 3 | 4 | null; warning?: string | null }) {
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  const colors = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];
  if (score === null) return null;
  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i < Math.max(1, score) ? colors[score] : 'bg-border')} />
        ))}
      </div>
      <span className="text-xs text-fg-3">
        Password strength: <strong className="text-fg-2">{labels[score]}</strong>
        {warning ? ` — ${warning}` : ''}
      </span>
    </div>
  );
}
