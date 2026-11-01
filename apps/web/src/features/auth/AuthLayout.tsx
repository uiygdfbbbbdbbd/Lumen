import { Link, Outlet } from '@tanstack/react-router';
import { usePublicConfig } from '../../lib/auth.js';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--lm-accent)" />
      <path d="M32 12 L36.5 27.5 L52 32 L36.5 36.5 L32 52 L27.5 36.5 L12 32 L27.5 27.5 Z" fill="var(--lm-accent-fg)" />
    </svg>
  );
}

export function AuthLayout() {
  const { data: cfg } = usePublicConfig();
  const name = cfg?.branding.productName ?? 'Lumen';
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2 text-lg font-semibold text-fg">
        <Logo />
        {name}
      </Link>
      <main id="main" className="w-full max-w-md rounded-lg border border-border bg-elevated p-6 shadow-md sm:p-8">
        {cfg?.maintenance.enabled ? (
          <p role="status" className="mb-4 rounded-md bg-surface p-3 text-sm text-fg-2">
            {cfg.maintenance.message || 'Maintenance in progress. Some actions are unavailable.'}
          </p>
        ) : null}
        <Outlet />
      </main>
      <p className="mt-6 max-w-md text-center text-xs text-fg-3">
        {cfg?.branding.loginCopy} {name} uses AI models; responses may be inaccurate.{' '}
        <a className="underline" href={cfg?.branding.tosUrl ?? '/legal/terms'}>Terms</a> ·{' '}
        <a className="underline" href={cfg?.branding.privacyUrl ?? '/legal/privacy'}>Privacy</a>
      </p>
    </div>
  );
}
