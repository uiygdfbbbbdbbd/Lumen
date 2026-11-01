import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { cn } from '@lumen/ui';

const SECTIONS = [
  { to: '/settings/account', label: 'Profile' },
  { to: '/settings/security', label: 'Security' },
  { to: '/settings/appearance', label: 'Appearance' },
  { to: '/settings/chat', label: 'Chat' },
  { to: '/settings/memory', label: 'Memory' },
  { to: '/settings/shortcuts', label: 'Shortcuts' },
  { to: '/settings/usage', label: 'Usage & limits' },
  { to: '/settings/privacy', label: 'Privacy & data' },
] as const;

export function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:flex-row">
      <nav aria-label="Settings" className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col">
        <h1 className="mb-2 hidden px-3 text-lg font-semibold md:block">Settings</h1>
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} aria-current={path === s.to ? 'page' : undefined} className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm', path === s.to ? 'bg-accent-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover')}>
            {s.label}
          </Link>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Outlet />
      </div>
    </div>
  );
}
