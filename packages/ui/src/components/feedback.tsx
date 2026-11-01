import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, Lock, OctagonAlert, X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export function Spinner({ size = 16, label = 'Loading', className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ animation: 'lm-spin 0.8s linear infinite' }}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('lm-skeleton rounded-md', className)} {...props} />;
}

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    tone: {
      neutral: 'bg-surface text-fg-2 border border-border',
      accent: 'bg-accent-soft text-accent',
      success: 'bg-surface text-success border border-border',
      warning: 'bg-surface text-warning border border-border',
      danger: 'bg-surface text-danger border border-border',
      info: 'bg-surface text-info border border-border',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: OctagonAlert } as const;
const TONE = {
  info: 'border-info/40 text-fg [&_svg]:text-info',
  success: 'border-success/40 text-fg [&_svg]:text-success',
  warning: 'border-warning/50 text-fg [&_svg]:text-warning',
  critical: 'border-danger/60 text-fg [&_svg]:text-danger',
} as const;

export interface BannerProps {
  tone?: keyof typeof ICONS;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Banner({ tone = 'info', title, children, action, onDismiss, className }: BannerProps) {
  const Icon = ICONS[tone];
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-md border bg-surface px-4 py-3 text-sm', TONE[tone], className)}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <strong className="font-semibold">{title}</strong> : null}
        {children ? <div className="text-fg-2">{children}</div> : null}
      </div>
      {action}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-sm p-0.5 text-fg-3 hover:bg-hover hover:text-fg">
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-elevated p-5 shadow-sm', className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-fg-2">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export interface MeterProps {
  value: number;
  max: number;
  label: string;
  /** Format the visible value text (e.g. bytes). */
  format?: (n: number) => string;
  className?: string;
}

/** Usage meter with 80/95/100% warning colors. */
export function Meter({ value, max, label, format = String, className }: MeterProps) {
  const ratio = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  const color = ratio >= 1 ? 'bg-danger' : ratio >= 0.95 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warning' : 'bg-accent';
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex justify-between text-xs text-fg-2">
        <span>{label}</span>
        <span>
          {format(value)} / {format(max)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${format(value)} of ${format(max)}`}
        className="h-2 overflow-hidden rounded-full bg-surface"
      >
        <div className={cn('h-full rounded-full', color)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-fg-3" aria-hidden="true">{icon}</div> : null}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-fg-2">{description}</p> : null}
      {action}
    </div>
  );
}

/** Shown in place of a feature the user can't use yet, with the reason and an optional CTA. */
export function LockedFeature({ title, reason, action }: { title: ReactNode; reason: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-surface px-4 py-3 text-sm">
      <Lock size={16} className="shrink-0 text-fg-3" aria-hidden="true" />
      <div className="flex-1">
        <div className="font-medium text-fg">{title}</div>
        <div className="text-fg-2">{reason}</div>
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface px-1 text-[11px] text-fg-2', className)}>{children}</kbd>;
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-border', className)} />;
}
